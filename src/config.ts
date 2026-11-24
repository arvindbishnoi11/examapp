// =============================================================================
// Runtime configuration
// =============================================================================
// Values come from `window.__PREPSETU_ENV__`, generated at build time by
// scripts/build-config.mjs from *public* VITE_* variables. Nothing here is
// secret; server secrets never reach the browser.
// =============================================================================

type PublicEnv = {
  APP_NAME?: string;
  APP_ENV?: string;
  FIREBASE_API_KEY?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_STORAGE_BUCKET?: string;
  FIREBASE_MESSAGING_SENDER_ID?: string;
  FIREBASE_APP_ID?: string;
  FIREBASE_MEASUREMENT_ID?: string;
  FIREBASE_VAPID_KEY?: string;
  GOOGLE_SHEET_ID?: string;
  GOOGLE_SHEET_URL?: string;
  SUPER_ADMIN_EMAIL?: string;
  RECAPTCHA_SITE_KEY?: string;
  USE_FIREBASE_EMULATORS?: string;
  AUTH_EMULATOR_URL?: string;
  APP_CHECK_DEBUG_TOKEN?: string;
  BUILD_TIME?: string;
};

declare global {
  interface Window {
    __PREPSETU_ENV__?: PublicEnv;
  }
}

const raw: PublicEnv = (typeof window !== 'undefined' && window.__PREPSETU_ENV__) || {};

export const appConfig = {
  name: raw.APP_NAME || 'PrepSetu',
  env: raw.APP_ENV || 'development',
  buildTime: raw.BUILD_TIME ?? null,
  superAdminEmail: raw.SUPER_ADMIN_EMAIL || 'arvindbishnoi@gmail.com',
  sheetId: raw.GOOGLE_SHEET_ID || '1tNqp66KgAnnhCRceOPkZubl1C-pMK_olzJkBlKGEnE4',
  sheetUrl:
    raw.GOOGLE_SHEET_URL ||
    'https://docs.google.com/spreadsheets/d/1tNqp66KgAnnhCRceOPkZubl1C-pMK_olzJkBlKGEnE4/edit',
  firebase: {
    apiKey: raw.FIREBASE_API_KEY || '',
    authDomain: raw.FIREBASE_AUTH_DOMAIN || '',
    projectId: raw.FIREBASE_PROJECT_ID || '',
    storageBucket: raw.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: raw.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: raw.FIREBASE_APP_ID || '',
    measurementId: raw.FIREBASE_MEASUREMENT_ID || '',
  },
  vapidKey: raw.FIREBASE_VAPID_KEY || '',
  recaptchaSiteKey: raw.RECAPTCHA_SITE_KEY || '',
  useEmulators: raw.USE_FIREBASE_EMULATORS === 'true',
  authEmulatorUrl: raw.AUTH_EMULATOR_URL || '',
  appCheckDebugToken: raw.APP_CHECK_DEBUG_TOKEN || '',
  isProduction: (raw.APP_ENV || 'development') === 'production',
} as const;

export const firebaseConfigured: boolean = (() => {
  const f = appConfig.firebase;
  return Boolean(f.apiKey && f.authDomain && f.projectId && f.appId);
})();

export function isFirebaseConfigured(): boolean {
  const f = appConfig.firebase;
  return Boolean(f.apiKey && f.authDomain && f.projectId && f.appId);
}
