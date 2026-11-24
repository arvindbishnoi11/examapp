// =============================================================================
// Firebase client (modular SDK)
// =============================================================================
// Only the web client config is used here (public by design). Server-side
// authority lives in the Worker, which verifies ID tokens independently.
// =============================================================================

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  setPersistence,
  browserLocalPersistence,
  type Auth,
} from 'firebase/auth';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import type { Messaging } from 'firebase/messaging';
import { appConfig, firebaseConfigured } from '@/config';

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let storageInstance: FirebaseStorage | null = null;
let messagingInstance: Messaging | null = null;
let messagingChecked = false;
let initialised = false;

export const firebaseAvailable: boolean = firebaseConfigured;

function ensureApp(): FirebaseApp | null {
  if (!firebaseAvailable) return null;
  if (app) return app;
  app = getApps().length ? getApps()[0]! : initializeApp(appConfig.firebase);
  return app;
}

export function getFirebaseAuth(): Auth | null {
  if (!firebaseAvailable) return null;
  if (authInstance) return authInstance;
  const instance = ensureApp();
  if (!instance) return null;
  authInstance = getAuth(instance);
  if (typeof window !== 'undefined') {
    if (appConfig.useEmulators && appConfig.authEmulatorUrl) {
      try {
        connectAuthEmulator(authInstance, appConfig.authEmulatorUrl, { disableWarnings: true });
      } catch {
        /* already connected */
      }
    }
    // Persist sessions so students are not logged out when the PWA is closed.
    setPersistence(authInstance, browserLocalPersistence).catch(() => undefined);
  }
  initialised = true;
  return authInstance;
}

export function getFirebaseStorageInstance(): FirebaseStorage | null {
  if (!firebaseAvailable) return null;
  if (storageInstance) return storageInstance;
  const instance = ensureApp();
  if (!instance) return null;
  storageInstance = getStorage(instance);
  return storageInstance;
}

/**
 * Messaging is only available in secure contexts with Service Worker + Push
 * support. `isSupported()` is async, so this resolves to null when the browser
 * cannot do web push — callers must treat that as "no push", never as an error.
 */
export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (!firebaseAvailable || typeof window === 'undefined') return null;
  if (messagingInstance) return messagingInstance;
  if (messagingChecked) return messagingInstance;
  messagingChecked = true;
  try {
    // Loaded on demand: web push is optional and its SDK is heavy.
    const { getMessaging, isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) return null;
    const instance = ensureApp();
    if (!instance) return null;
    messagingInstance = getMessaging(instance);
    return messagingInstance;
  } catch {
    return null;
  }
}

export function isFirebaseInitialised(): boolean {
  return initialised;
}

export function getFirebaseProjectId(): string {
  return appConfig.firebase.projectId;
}
