// =============================================================================
// Lightweight performance instrumentation
// =============================================================================
// Records Core Web Vitals into `window.__PREPSETU_METRICS__` and sessionStorage
// so they can be inspected in the admin "Performance" panel without shipping a
// third-party analytics bundle. Nothing is sent to an external service.
// =============================================================================

type Metric = { name: string; value: number; rating: 'good' | 'needs-improvement' | 'poor'; at: number };

declare global {
  interface Window {
    __PREPSETU_METRICS__?: Metric[];
  }
}

function rating(name: string, value: number): Metric['rating'] {
  const thresholds: Record<string, [number, number]> = {
    LCP: [2500, 4000],
    FCP: [1800, 3000],
    CLS: [0.1, 0.25],
    TTFB: [800, 1800],
    INP: [200, 500],
  };
  const [good, poor] = thresholds[name] ?? [0, Infinity];
  return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor';
}

function record(name: string, value: number) {
  const metric: Metric = { name, value: Math.round(value * 1000) / 1000, rating: rating(name, value), at: Date.now() };
  window.__PREPSETU_METRICS__ = [...(window.__PREPSETU_METRICS__ ?? []), metric];
  try {
    sessionStorage.setItem('prepsetu.metrics', JSON.stringify(window.__PREPSETU_METRICS__.slice(-25)));
  } catch {
    /* storage full or blocked */
  }
}

export function initPerformanceMonitoring(): void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;

  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as PerformanceEntry & { renderTime?: number; loadTime?: number };
      record('LCP', last.renderTime || last.loadTime || last.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    /* unsupported */
  }

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { hadRecentInput?: boolean; value?: number })[]) {
        if (!entry.hadRecentInput) record('CLS', entry.value ?? 0);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    /* unsupported */
  }

  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) record('INP', last.duration);
    }).observe({ type: 'first-input', buffered: true });
  } catch {
    /* unsupported */
  }

  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (navigation) {
    record('TTFB', navigation.responseStart);
    record('FCP', performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0);
  }
}
