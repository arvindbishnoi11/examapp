// Firebase auth error codes → student-friendly messages (no stack traces).

const MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'That email address is not valid.',
  'auth/user-disabled': 'This account has been disabled. Please contact support.',
  'auth/user-not-found': 'No account found with that email. Check the spelling or create a new account.',
  'auth/wrong-password': 'Incorrect password. Try again or reset it.',
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/invalid-login-credentials': 'Email or password is incorrect.',
  'auth/email-already-in-use': 'An account already exists with this email. Try signing in instead.',
  'auth/weak-password': 'Choose a stronger password (at least 6 characters).',
  'auth/missing-password': 'Please enter your password.',
  'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
  'auth/network-request-failed': 'Network problem. Check your connection and try again.',
  'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
  'auth/popup-blocked': 'Your browser blocked the sign-in popup. Allow popups for this site and retry.',
  'auth/cancelled-popup-request': 'Another sign-in is already in progress.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled. Ask the administrator to enable it in Firebase.',
  'auth/requires-recent-login': 'Please sign in again to continue.',
  'auth/unauthorized-domain': 'This domain is not authorised for sign-in. Add it to Firebase Authentication → Settings → Authorised domains.',
  'auth/internal-error': 'Firebase could not complete the request. Please try again.',
  'auth/app-not-authorized': 'This app is not authorised for Firebase Authentication.',
  'auth/invalid-api-key': 'Firebase is misconfigured (invalid web API key). Contact the administrator.',
  'auth/configuration-not-found': 'Firebase Authentication is not configured for this project.',
};

export function firebaseAuthMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (error instanceof Error && error.message) return error.message;
  return 'Sign-in failed. Please try again.';
}
