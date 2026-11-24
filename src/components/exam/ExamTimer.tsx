import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { formatClock } from '@/lib/format';

/**
 * Countdown driven by an authoritative server deadline.
 * The component never decides when the exam ends — it reports reaching zero
 * and the page calls the submit endpoint, which is the real gate.
 */
export function ExamTimer({
  expiresAtMs,
  serverNowMs,
  onExpire,
  paused = false,
}: {
  expiresAtMs: number;
  serverNowMs: number;
  onExpire: () => void;
  paused?: boolean;
}) {
  // Offset between server clock and device clock, captured once at mount.
  const offsetRef = useRef(serverNowMs - Date.now());
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAtMs - serverNowMs));
  const firedRef = useRef(false);

  useEffect(() => {
    offsetRef.current = serverNowMs - Date.now();
  }, [serverNowMs]);

  useEffect(() => {
    if (paused) return;
    const tick = () => {
      const left = Math.max(0, expiresAtMs - (Date.now() + offsetRef.current));
      setRemaining(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpire();
      }
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [expiresAtMs, onExpire, paused]);

  const totalSeconds = Math.floor(remaining / 1000);
  const critical = totalSeconds <= 60;
  const warning = totalSeconds <= 300;

  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[13px] font-bold tabular-nums transition ${
        critical
          ? 'bg-rose-600 text-white motion-safe:animate-pulse'
          : warning
            ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100'
            : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
      }`}
      role="timer"
      aria-live={critical ? 'assertive' : 'off'}
      aria-label={`Time remaining ${formatClock(totalSeconds)}`}
    >
      {critical ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <Clock className="h-4 w-4" aria-hidden />}
      {formatClock(totalSeconds)}
    </div>
  );
}
