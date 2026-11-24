// =============================================================================
// Firebase Cloud Messaging — device token registration
// =============================================================================
// The Worker signs FCM v1 requests with its service account, but it can only
// target devices whose registration tokens it has stored. This module obtains
// a token in the browser (which requires a VAPID key and the *same* Firebase
// project the Worker uses) and hands it to `POST /api/notifications/register`.
//
// Every failure path is non-fatal: students can always read in-app
// notifications, and a declined permission must never break the app.
// =============================================================================

import { appConfig } from '@/config';
import { firebaseAvailable, getFirebaseMessaging, getFirebaseAuth } from '@/lib/firebase';
import { api } from '@/lib/api';

const TOKEN_KEY = 'prepsetu.fcm.token';

export type PushSupport =
  | 'supported'
  | 'no-service-worker'
  | 'no-vapid-key'
  | 'firebase-unconfigured'
  | 'unsupported-browser';

/** Cheap capability probe — says nothing about permission. */
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported-browser';
  if (!firebaseAvailable) return 'firebase-unconfigured';
  if (!appConfig.vapidKey) return 'no-vapid-key';
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return 'unsupported-browser';
  return 'supported';
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * Requests permission (must be called from a user gesture), obtains the FCM
 * token and registers it with the Worker. Returns the token on success.
 */
export async function registerForPush(): Promise<{ ok: boolean; reason?: string; token?: string }> {
  const support = pushSupport();
  if (support !== 'supported') return { ok: false, reason: support };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: `permission-${permission}` };

    const messaging = await getFirebaseMessaging();
    if (!messaging) return { ok: false, reason: 'messaging-unavailable' };

    // /firebase-messaging-sw.js is a separate top-level worker; the app shell
    // worker deliberately does not handle push so the two never fight.
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });

    const { getToken, onMessage } = await import('firebase/messaging');
    const token = await getToken(messaging, {
      vapidKey: appConfig.vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) return { ok: false, reason: 'no-token' };

    await api.post('/api/notifications/register', {
      token,
      platform: 'web',
      deviceInfo: navigator.userAgent.slice(0, 280),
    });

    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage may be blocked; the server already has the token */
    }

    // Foreground messages are not shown by the service worker, so surface them
    // as an in-app event the notifications screen listens for.
    onMessage(messaging, (payload) => {
      window.dispatchEvent(new CustomEvent('prepsetu:push', { detail: payload }));
    });

    return { ok: true, token };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'unknown' };
  }
}

/** Best-effort removal — called on sign-out so a shared device stops receiving push. */
export async function unregisterFromPush(): Promise<void> {
  let token: string | null = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }

  if (!token) {
    // Fall back to asking FCM for the current token.
    try {
      const messaging = await getFirebaseMessaging();
      if (messaging) {
        const { getToken } = await import('firebase/messaging');
        token = (await getToken(messaging, { vapidKey: appConfig.vapidKey })) || null;
      }
    } catch {
      token = null;
    }
  }

  if (!token) return;
  try {
    await api.post('/api/notifications/unregister', { token });
  } catch {
    /* offline sign-out must still succeed locally */
  }
  try {
    const messaging = await getFirebaseMessaging();
    if (messaging && getFirebaseAuth()) {
      const { deleteToken } = await import('firebase/messaging');
      await deleteToken(messaging);
    }
  } catch {
    /* ignore */
  }
}
