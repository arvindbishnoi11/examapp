// =============================================================================
// PWA registration + update prompting
// =============================================================================

import { useEffect, useState } from 'react';

let waitingWorker: ServiceWorker | null = null;
let updateCallback: (() => void) | null = null;

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  // Never register a SW during local Vite-only development (no /sw.js served).
  if (window.location.port === '5173') return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              waitingWorker = registration.waiting;
              updateCallback?.();
            }
          });
        });
      })
      .catch((error) => {
        console.warn('[PrepSetu] Service worker registration failed', error);
      });
  });
}

/** React hook: true when a new version is ready to activate. */
export function useServiceWorkerUpdate(): { updateAvailable: boolean; applyUpdate: () => void } {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    updateCallback = () => setUpdateAvailable(true);
    return () => {
      updateCallback = null;
    };
  }, []);

  return {
    updateAvailable,
    applyUpdate: () => {
      if (!waitingWorker) {
        window.location.reload();
        return;
      }
      waitingWorker.postMessage('SKIP_WAITING');
      waitingWorker.addEventListener('statechange', () => {
        if (waitingWorker?.state === 'activated') window.location.reload();
      });
    },
  };
}

/** Install prompt capture (Android/Chrome). */
export function useInstallPrompt(): { canInstall: boolean; promptInstall: () => Promise<void> } {
  const [event, setEvent] = useState<Event | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setEvent(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  return {
    canInstall: Boolean(event),
    promptInstall: async () => {
      if (!event) return;
      await (event as unknown as { prompt: () => Promise<void> }).prompt();
      setEvent(null);
    },
  };
}
