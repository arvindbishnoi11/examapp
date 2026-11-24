// =============================================================================
// Cron jobs (every 15 minutes)
// =============================================================================
// 1. Incremental Google Sheets synchronisation (only when credentials exist and
//    the feature flag is on).
// 2. Close exam attempts whose server deadline has passed (no student should be
//    left in limbo if their browser never came back).
// 3. Deliver scheduled notifications whose time has come.
// 4. Purge expired cache + rate-limit rows.
// All jobs are idempotent and fail independently.
// =============================================================================

import type { Env } from '../env';
import { runSync } from './sheets-sync';
import { submitAttempt } from './exams';
import { sendPush } from './fcm';
import { invalidateCatalogueCache } from '../lib/cache';
import { nowIso } from '../lib/util';

async function getSetting(env: Env, key: string, fallback: string): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM platform_settings WHERE key = ?1').bind(key).first<{ value: string }>();
  return row?.value ?? fallback;
}

async function syncSheets(env: Env): Promise<void> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) return;
  const enabled = (await getSetting(env, 'sheets.sync_enabled', 'true')) === 'true';
  if (!enabled) return;

  // Skip if a sync already ran recently (protects quota when the cron fires
  // more often than the configured interval).
  const intervalMinutes = Number(await getSetting(env, 'sheets.sync_interval_minutes', '15')) || 15;
  const last = await env.DB.prepare('SELECT started_at AS startedAt, status FROM sync_logs ORDER BY started_at DESC LIMIT 1').first<{
    startedAt: string;
    status: string;
  }>();
  if (last?.startedAt) {
    const ageMinutes = (Date.now() - Date.parse(last.startedAt)) / 60000;
    if (ageMinutes < Math.max(5, intervalMinutes - 2)) return;
  }

  const outcome = await runSync(env, { mode: 'scheduled' });
  if (outcome.report.status !== 'failed') await invalidateCatalogueCache(env);
  console.log('scheduled_sync', {
    status: outcome.report.status,
    sheets: outcome.report.sheets.length,
    error: outcome.report.errorMessage ?? null,
  });
}

async function closeExpiredAttempts(env: Env): Promise<void> {
  const now = Date.now();
  const rows = await env.DB.prepare(
    "SELECT id FROM exam_attempts WHERE status = 'in_progress' AND expires_at_ms + 45000 < ?1 ORDER BY expires_at_ms ASC LIMIT 50",
  )
    .bind(now)
    .all<{ id: string }>();

  for (const row of rows.results ?? []) {
    try {
      await submitAttempt(env, row.id, { channel: 'cron', reason: 'deadline_passed' });
    } catch (err) {
      console.error('cron_submit_failed', { attemptId: row.id, message: (err as Error)?.message });
    }
  }
  if (rows.results?.length) console.log('cron_closed_attempts', { count: rows.results.length });
}

async function deliverScheduledNotifications(env: Env): Promise<void> {
  const now = nowIso();
  const rows = await env.DB.prepare(
    "SELECT id, title, body, image_url AS imageUrl, deep_link AS deepLink, target_type AS targetType, target_value AS targetValue FROM notifications WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?1 LIMIT 10",
  )
    .bind(now)
    .all<{
      id: string;
      title: string;
      body: string;
      imageUrl: string | null;
      deepLink: string | null;
      targetType: string;
      targetValue: string | null;
    }>();

  for (const row of rows.results ?? []) {
    try {
      await env.DB.prepare("UPDATE notifications SET status = 'sending' WHERE id = ?1").bind(row.id).run();
      const result = await sendPush(env, {
        title: row.title,
        body: row.body,
        imageUrl: row.imageUrl,
        deepLink: row.deepLink,
        audience: { targetType: row.targetType as never, targetValue: row.targetValue },
      });
      await env.DB.prepare(
        `UPDATE notifications SET status = ?2, sent_at = ?3, success_count = ?4, failed_count = ?5,
           delivered_count = ?4, error_message = ?6 WHERE id = ?1`,
      )
        .bind(row.id, result.success > 0 || result.tokens === 0 ? 'sent' : 'failed', nowIso(), result.success, result.failed, result.error ?? null)
        .run();
    } catch (err) {
      await env.DB.prepare("UPDATE notifications SET status = 'failed', error_message = ?2 WHERE id = ?1")
        .bind(row.id, (err as Error).message.slice(0, 400))
        .run()
        .catch(() => undefined);
    }
  }
  if (rows.results?.length) console.log('cron_scheduled_notifications', { count: rows.results.length });
}

async function purgeTransient(env: Env): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM api_cache WHERE expires_at < ?1').bind(now),
    env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?1').bind(now),
    env.DB.prepare('DELETE FROM sync_locks WHERE expires_at < ?1').bind(now),
  ]);
}

export async function runScheduledJobs(env: Env): Promise<void> {
  const jobs: [string, () => Promise<void>][] = [
    ['close_expired_attempts', () => closeExpiredAttempts(env)],
    ['scheduled_notifications', () => deliverScheduledNotifications(env)],
    ['sheets_sync', () => syncSheets(env)],
    ['purge_transient', () => purgeTransient(env)],
  ];

  for (const [name, job] of jobs) {
    try {
      await job();
    } catch (err) {
      console.error('scheduled_job_error', { job: name, message: (err as Error)?.message });
    }
  }
}
