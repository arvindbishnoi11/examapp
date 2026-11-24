import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '@/lib/api';

type State<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  setData: (updater: T | ((current: T | null) => T | null)) => void;
};

/**
 * Small data-fetching hook (no library needed for most screens).
 * `enabled: false` lets a component wait for auth to resolve.
 */
export function useApiQuery<T>(
  path: string | null,
  query?: Record<string, string | number | boolean | undefined | null>,
  options: { enabled?: boolean; auth?: boolean; deps?: unknown[] } = {},
): State<T> {
  const { enabled = true, auth = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path) && enabled);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);
  const queryKey = JSON.stringify(query ?? {});

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!path || !enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .get<T>(path, query, { auth })
      .then((result) => {
        if (!cancelled && mounted.current) {
          setData(result);
          setError(null);
        }
      })
      .catch((err) => {
        if (cancelled || !mounted.current) return;
        if (err instanceof ApiError && err.status === 404) {
          setError('Not found.');
        } else {
          setError(errorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled && mounted.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, auth, queryKey, nonce, ...(options.deps ?? [])]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, refetch, setData: setData as State<T>['setData'] };
}

/** Async action wrapper with loading + error handling for forms. */
export function useAsyncAction() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, setError, run };
}
