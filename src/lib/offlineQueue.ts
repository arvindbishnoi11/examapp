// =============================================================================
// Attempt answer offline queue
// =============================================================================
// The exam engine autosaves answers to the Worker. On flaky mobile networks a
// save can fail; losing an answer is unacceptable, so every pending answer is
// also written to localStorage and replayed as soon as the network returns or
// the tab is restored.
//
// IMPORTANT: only ANSWERS the student has already chosen are queued. No
// question text, answer key or result data is ever stored — the queue is
// attempt-scoped and cleared on submit.
// =============================================================================

import type { AnswerPayload } from '@shared/types';

const KEY_PREFIX = 'prepsetu.pending.';

type PendingMap = Record<string, AnswerPayload>;

function key(attemptId: string): string {
  return `${KEY_PREFIX}${attemptId}`;
}

export function readPending(attemptId: string): PendingMap {
  try {
    const raw = localStorage.getItem(key(attemptId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PendingMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writePending(attemptId: string, answers: Record<string, AnswerPayload>): void {
  try {
    if (!Object.keys(answers).length) localStorage.removeItem(key(attemptId));
    else localStorage.setItem(key(attemptId), JSON.stringify(answers));
  } catch {
    /* storage unavailable (private mode) — server autosave still applies */
  }
}

export function enqueue(attemptId: string, payloads: AnswerPayload[]): void {
  const pending = readPending(attemptId);
  for (const payload of payloads) pending[payload.examQuestionId] = payload;
  writePending(attemptId, pending);
}

export function clearPending(attemptId: string, ids?: string[]): void {
  if (!ids?.length) {
    try {
      localStorage.removeItem(key(attemptId));
    } catch {
      /* ignore */
    }
    return;
  }
  const pending = readPending(attemptId);
  for (const id of ids) delete pending[id];
  writePending(attemptId, pending);
}

export function clearAllAttemptData(attemptId: string): void {
  clearPending(attemptId);
  try {
    localStorage.removeItem(`prepsetu.attempt.${attemptId}.local`);
  } catch {
    /* ignore */
  }
}

/** Serialises answer payloads for the API (drops client-only fields). */
export function toApiPayload(answers: AnswerPayload[]): AnswerPayload[] {
  return answers.map((a) => ({
    examQuestionId: a.examQuestionId,
    selectedOptions: a.selectedOptions,
    numericAnswer: a.numericAnswer,
    integerAnswer: a.integerAnswer,
    status: a.status,
    timeSpentSeconds: a.timeSpentSeconds,
  }));
}
