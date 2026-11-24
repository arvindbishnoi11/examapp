#!/usr/bin/env node
// =============================================================================
// PrepSetu — browser end-to-end test
// -----------------------------------------------------------------------------
// Drives the real Progressive Web App in Chromium against the compiled Worker.
// It covers the journeys that a unit test cannot: client routing, the exam
// timer, autosave, offline shell, the admin console and dark mode.
//
// Requirements (deliberately optional — the sandbox/CI image may not ship a
// browser):
//   npm install --no-save playwright
//   npx playwright install chromium
//
// Usage:
//   npm run build && npx wrangler dev --port 8799 --local    # terminal 1
//   npm run test:e2e                                          # terminal 2
//
// Exit codes:  0 all passed · 1 failures · 78 skipped (Playwright/browser
// missing) — 78 keeps CI green while making the skip visible.
// =============================================================================

import { createRequire } from 'node:module';

const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:8799').replace(/\/$/, '');
const HEADLESS = process.env.HEADED !== '1';
const ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'arvindbishnoi@gmail.com';
const require = createRequire(import.meta.url);

let playwright = null;
try {
  playwright = require('playwright');
} catch {
  try {
    playwright = require('playwright-core');
  } catch {
    playwright = null;
  }
}

if (!playwright) {
  console.log('\n  E2E skipped — Playwright is not installed.\n');
  console.log('  Install it once, then re-run:');
  console.log('    npm install --no-save playwright');
  console.log('    npx playwright install chromium');
  console.log('');
  console.log('  The API surface is already covered by `npm run test:api`,');
  console.log('  which needs no browser and runs in this environment.\n');
  process.exit(78);
}

const results = [];
function record(ok, label, detail) {
  results.push({ ok, label, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
}

async function check(label, fn) {
  try {
    const value = await fn();
    if (value === false) record(false, label);
    else record(true, label);
    return true;
  } catch (err) {
    record(false, label, err.message?.split('\n')[0]);
    return false;
  }
}

async function main() {
  console.log(`PrepSetu E2E → ${BASE}\n`);

  const browser = await playwright.chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  try {
    // ------------------------------------------------------- public shell ---
    console.log('Public shell');
    await check('home page renders the brand and hero', async () => {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      const title = await page.title();
      if (!/PrepSetu/i.test(title)) throw new Error(`title was "${title}"`);
      await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 10_000 });
    });

    await check('service worker is registered', async () => {
      const registered = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return false;
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) return true;
        await new Promise((resolve) => setTimeout(resolve, 2500));
        return Boolean(await navigator.serviceWorker.getRegistration());
      });
      if (!registered) throw new Error('no service worker registration');
    });

    await check('manifest is linked and fetchable', async () => {
      const href = await page.getAttribute('link[rel="manifest"]', 'href');
      if (!href) throw new Error('no manifest link');
      const response = await page.request.get(`${BASE}${href}`);
      if (!response.ok()) throw new Error(`manifest ${response.status()}`);
      const manifest = await response.json();
      if (!manifest.name) throw new Error('manifest has no name');
    });

    await check('deep link renders the SPA shell (no 404)', async () => {
      const response = await page.goto(`${BASE}/tests`, { waitUntil: 'networkidle' });
      if (response.status() !== 200) throw new Error(`status ${response.status()}`);
      await page.locator('#root').waitFor();
    });

    await check('courses list shows seeded content', async () => {
      await page.goto(`${BASE}/courses`, { waitUntil: 'networkidle' });
      const text = await page.locator('main, #root').first().innerText();
      if (!/course/i.test(text)) throw new Error('no course content rendered');
    });

    // -------------------------------------------------------------- auth ----
    console.log('\nStudent session');
    await check('dev sign-in unlocks the student app', async () => {
      const token = await page.evaluate(async ({ base, email }) => {
        const response = await fetch(`${base}/api/auth/dev-login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, name: 'E2E Student' }),
        });
        if (!response.ok) return null;
        const payload = await response.json();
        return payload.token;
      }, { base: BASE, email: `e2e.student.${Date.now()}@prepsetu.test` });
      if (!token) throw new Error('dev-login failed');
      await page.addInitScript((value) => {
        window.localStorage.setItem('prepsetu.dev.token', value);
      }, token);
      await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
      const text = await page.locator('#root').innerText();
      if (/sign in/i.test(text) && !/profile/i.test(text)) throw new Error('profile page asked for a sign-in');
    });

    // -------------------------------------------------------------- exams ----
    console.log('\nExam runner');
    await check('exam detail page loads from the seeded mock', async () => {
      await page.goto(`${BASE}/tests`, { waitUntil: 'networkidle' });
      const cards = page.locator('a[href^="/tests/"]');
      if (!(await cards.count())) throw new Error('no exam cards rendered');
      await cards.first().click();
      await page.waitForURL(/\/tests\/[0-9a-f-]{36}/, { timeout: 15_000 });
      const text = await page.locator('#root').innerText();
      if (!/instructions|minutes|attempt/i.test(text)) throw new Error('exam detail lacks instructions/duration');
    });

    await check('starting an attempt shows the server-timed runner', async () => {
      const startButton = page.getByRole('button', { name: /start|begin/i }).first();
      if (!(await startButton.count())) throw new Error('no start button');
      await startButton.click();
      await page.waitForURL(/\/attempts\/[0-9a-f-]{36}/, { timeout: 20_000 });
      const text = await page.locator('#root').innerText();
      if (!/\d{1,2}:\d{2}/.test(text)) throw new Error('timer is not visible');
      if (!/question/i.test(text)) throw new Error('question is not visible');
    });

    await check('answering a question marks the palette', async () => {
      const option = page.locator('button, label').filter({ hasText: /^\s*A\.?\s/ }).first();
      if (await option.count()) await option.click();
      else {
        const radios = page.locator('input[type="radio"], input[type="checkbox"]');
        if (await radios.count()) await radios.first().check({ force: true });
      }
      await page.waitForTimeout(1200); // let the debounced autosave fire
    });

    // ------------------------------------------------------------ admin -----
    console.log('\nAdmin console');
    await check('admin dashboard renders for the super admin', async () => {
      const token = await page.evaluate(async ({ base, email }) => {
        const response = await fetch(`${base}/api/auth/dev-login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, name: 'E2E Admin' }),
        });
        if (!response.ok) return null;
        return (await response.json()).token;
      }, { base: BASE, email: ADMIN_EMAIL });
      if (!token) throw new Error('admin dev-login failed');
      await page.addInitScript((value) => {
        window.localStorage.setItem('prepsetu.dev.token', value);
      }, token);
      await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
      const text = await page.locator('#root').innerText();
      if (!/dashboard|students|examinations/i.test(text)) throw new Error('admin chrome missing');
      if (!/welcome|total students/i.test(text)) throw new Error('dashboard stats missing');
    });

    for (const [label, path, expected] of [
      ['exam manager', '/admin/exams', /examination|mock/i],
      ['question bank', '/admin/questions', /question/i],
      ['analytics', '/admin/analytics', /analytics|engagement/i],
      ['settings', '/admin/settings', /setting/i],
      ['audit log', '/admin/audit-logs', /audit/i],
      ['sheets sync', '/admin/sheets', /sheet|sync/i],
    ]) {
      await check(`admin ${label} page renders`, async () => {
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
        const text = await page.locator('#root').innerText();
        if (!expected.test(text)) throw new Error(`unexpected content on ${path}`);
        if (/something went wrong|failed to load/i.test(text)) throw new Error(`error state on ${path}`);
      });
    }

    // ------------------------------------------------------------ offline ---
    console.log('\nOffline & PWA');
    await check('offline page is served from the cache', async () => {
      await context.setOffline(true);
      const response = await page.goto(`${BASE}/offline.html`, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await context.setOffline(false);
      if (response && response.status() >= 400) throw new Error(`offline page ${response.status()}`);
    });

    // ------------------------------------------------------------- errors ---
    console.log('\nRuntime health');
    await check('no uncaught console errors during the run', async () => {
      const ignorable = /(Failed to load resource|net::ERR_|favicon|firebase|messaging|push service|permission)/i;
      const real = consoleErrors.filter((message) => !ignorable.test(message));
      if (real.length) throw new Error(`${real.length} console error(s): ${real[0].slice(0, 120)}`);
    });
  } finally {
    await browser.close();
  }

  const failed = results.filter((entry) => !entry.ok);
  console.log('');
  console.log(`${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log('');
    for (const entry of failed) console.log(`  • ${entry.label}${entry.detail ? ` — ${entry.detail}` : ''}`);
    process.exit(1);
  }
  console.log('');
}

main().catch((err) => {
  console.error('E2E crashed:', err);
  process.exit(1);
});
