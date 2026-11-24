// =============================================================================
// AuthProvider — Firebase (or dev) sign-in + server session
// =============================================================================
// Single source of truth for "who is signed in and what may they do".
// The server always re-verifies; this context only drives the UI.
// =============================================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  GoogleAuthProvider,
  type Auth,
} from 'firebase/auth';
import { getFirebaseAuth, firebaseAvailable } from '@/lib/firebase';
import { api, ApiError, setTokenProvider, setUnauthorizedHandler } from '@/lib/api';
import { appConfig } from '@/config';
import type { SessionUser } from '@shared/types';

const DEV_TOKEN_KEY = 'prepsetu.dev.token';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

type AuthContextValue = {
  status: AuthStatus;
  user: SessionUser | null;
  firebaseUser: FirebaseUser | null;
  error: string | null;
  devMode: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ needsVerification: boolean }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  refresh: () => Promise<void>;
  updateProfile: (input: Record<string, unknown>) => Promise<void>;
  completeOnboarding: (input: { fullName: string; classId: string; targetExamTypeId: string; studyGoalMinutes: number }) => Promise<void>;
  /** Deletes the server record + Firebase account. Returns false when re-auth is needed. */
  deleteAccount: () => Promise<boolean>;
  hasPermission: (permission: string) => boolean;
  isStaff: boolean;
  isSuperAdmin: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readDevToken(): string | null {
  try {
    return localStorage.getItem(DEV_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeDevToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(DEV_TOKEN_KEY, token);
    else localStorage.removeItem(DEV_TOKEN_KEY);
  } catch {
    /* storage may be blocked */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false);

  const authRef = useRef<Auth | null>(null);
  const serverSessionRef = useRef(false);

  // ---- token provider (used by the API client) ----------------------------
  useEffect(() => {
    setTokenProvider(async () => {
      const devToken = readDevToken();
      if (devToken) return devToken;
      const auth = getFirebaseAuth();
      const current = auth?.currentUser;
      if (!current) return null;
      try {
        return await current.getIdToken(false);
      } catch {
        return null;
      }
    });

    setUnauthorizedHandler(() => {
      // Token was rejected: drop the cached session so the UI re-evaluates.
      serverSessionRef.current = false;
    });

    return () => {
      setTokenProvider(null);
      setUnauthorizedHandler(null);
    };
  }, []);

  const loadServerSession = useCallback(async (): Promise<SessionUser | null> => {
    try {
      const data = await api.get<{ user: SessionUser }>('/api/auth/me', undefined, { retries: 1 });
      serverSessionRef.current = true;
      setUser(data.user);
      setStatus('authenticated');
      setError(null);
      return data.user;
    } catch (err) {
      if (err instanceof ApiError && err.isAuthError) {
        setUser(null);
        setStatus('unauthenticated');
        return null;
      }
      setUser(null);
      setStatus('unauthenticated');
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
      return null;
    }
  }, []);

  // ---- bootstrap ----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Discover server config first: it tells us whether dev sign-in is allowed.
      let serverDevMode = false;
      try {
        const config = await api.get<{ devAuthEnabled?: boolean; authMode?: string }>('/api/auth/config', undefined, {
          auth: false,
          retries: 1,
        });
        serverDevMode = Boolean(config.devAuthEnabled);
      } catch {
        serverDevMode = false;
      }
      if (cancelled) return;
      setDevMode(serverDevMode);

      const devToken = readDevToken();
      if (serverDevMode && devToken) {
        await loadServerSession();
        return;
      }

      if (!firebaseAvailable) {
        // No Firebase config and no dev token: unauthenticated (public pages).
        setStatus('unauthenticated');
        return;
      }

      const auth = getFirebaseAuth();
      authRef.current = auth;
      if (!auth) {
        setStatus('unauthenticated');
        return;
      }

      onAuthStateChanged(auth, async (fbUser) => {
        if (cancelled) return;
        setFirebaseUser(fbUser);
        if (!fbUser) {
          setUser(null);
          setStatus('unauthenticated');
          return;
        }
        await loadServerSession();
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [loadServerSession]);

  // ---- actions ------------------------------------------------------------
  const signIn = useCallback(async (email: string, password: string) => {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error('Sign-in is not configured on this deployment.');
    await signInWithEmailAndPassword(auth, email.trim(), password);
    await loadServerSession();
  }, [loadServerSession]);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error('Registration is not configured on this deployment.');
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (displayName) {
      await updateProfile(credential.user, { displayName }).catch(() => undefined);
    }
    // Verification email (best effort — never blocks the account creation).
    await sendEmailVerification(credential.user).catch(() => undefined);
    await loadServerSession();
    return { needsVerification: !credential.user.emailVerified };
  }, [loadServerSession]);

  const signInWithGoogle = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error('Google sign-in is not configured on this deployment.');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
    await loadServerSession();
  }, [loadServerSession]);

  const signOut = useCallback(async () => {
    writeDevToken(null);
    const auth = getFirebaseAuth();
    if (auth?.currentUser) {
      await api.post('/api/auth/logout').catch(() => undefined);
      await firebaseSignOut(auth).catch(() => undefined);
    }
    await api.post('/api/auth/logout', undefined, { auth: false }).catch(() => undefined);
    setUser(null);
    setFirebaseUser(null);
    setStatus('unauthenticated');
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error('Password reset is not configured on this deployment.');
    await sendPasswordResetEmail(auth, email.trim());
  }, []);

  const resendVerification = useCallback(async () => {
    const auth = getFirebaseAuth();
    const current = auth?.currentUser;
    if (!current) throw new Error('You need to be signed in.');
    await sendEmailVerification(current);
  }, []);

  const refresh = useCallback(async () => {
    await loadServerSession();
  }, [loadServerSession]);

  const updateProfileAction = useCallback(async (input: Record<string, unknown>) => {
    const data = await api.put<{ user: SessionUser }>('/api/auth/profile', input);
    setUser(data.user);
    const auth = getFirebaseAuth();
    if (auth?.currentUser && typeof input.fullName === 'string' && input.fullName.trim()) {
      await updateProfile(auth.currentUser, { displayName: input.fullName.trim() }).catch(() => undefined);
    }
  }, []);

  const completeOnboarding = useCallback(
    async (input: { fullName: string; classId: string; targetExamTypeId: string; studyGoalMinutes: number }) => {
      const data = await api.post<{ user: SessionUser }>('/api/auth/onboarding', input);
      setUser(data.user);
      const auth = getFirebaseAuth();
      if (auth?.currentUser) await updateProfile(auth.currentUser, { displayName: input.fullName }).catch(() => undefined);
    },
    [],
  );

  /** Deletes the server record first, then the Firebase account. */
  const deleteAccount = useCallback(async (): Promise<boolean> => {
    try {
      await api.delete('/api/auth/account');
    } catch (err) {
      if (err instanceof ApiError && err.isAuthError) return false;
      throw err;
    }
    const auth = getFirebaseAuth();
    try {
      await auth?.currentUser?.delete();
    } catch {
      // Server record is gone even if Firebase needs a fresh login to delete.
    }
    writeDevToken(null);
    setUser(null);
    setFirebaseUser(null);
    setStatus('unauthenticated');
    return true;
  }, []);

  /** Dev sign-in helper exposed for the login screen when the server allows it. */
  const devSignIn = useCallback(
    async (email: string, name?: string) => {
      const data = await api.post<{ token: string }>('/api/auth/dev-login', { email, name }, { auth: false, retries: 0 });
      writeDevToken(data.token);
      await loadServerSession();
    },
    [loadServerSession],
  );

  const value = useMemo<AuthContextValue & { devSignIn: typeof devSignIn }>(
    () => ({
      status,
      user,
      firebaseUser,
      error,
      devMode,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      resetPassword,
      resendVerification,
      refresh,
      updateProfile: updateProfileAction,
      completeOnboarding,
      deleteAccount,
      hasPermission: (permission: string) => Boolean(user?.permissions.includes(permission)) || Boolean(user?.isSuperAdmin),
      isStaff: Boolean(user?.isStaff),
      isSuperAdmin: Boolean(user?.isSuperAdmin),
      devSignIn,
    }),
    [
      status,
      user,
      firebaseUser,
      error,
      devMode,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      resetPassword,
      resendVerification,
      refresh,
      updateProfileAction,
      completeOnboarding,
      deleteAccount,
      devSignIn,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context as AuthContextValue & { devSignIn: (email: string, name?: string) => Promise<void> };
}

export function usePermission(permission: string): boolean {
  const { hasPermission } = useAuth();
  return hasPermission(permission);
}

export { appConfig };
