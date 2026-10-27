import defaultPolicy from '../config/retry.js';

/** Is this failure reason one that no amount of retrying will fix? */
export function isPermanentFailure(reason, policy = defaultPolicy) {
  const r = String(reason || '').toLowerCase();
  if (!r) return false;
  return policy.permanentFailureReasonPatterns.some((p) => r.includes(p));
}

/** Seconds to wait before attempt number `nextAttempt` (2, 3, ...). */
export function backoffSeconds(nextAttempt, policy = defaultPolicy) {
  const n = Math.max(1, nextAttempt - 1);
  const raw = policy.backoffBaseSeconds * policy.backoffMultiplier ** (n - 1);
  return Math.min(raw, policy.backoffMaxSeconds);
}

/**
 * The heart of the retry policy.
 * @param {{ attemptsMade: number, failureReason: string }} state
 * @returns {{ action: 'retry', delaySeconds: number, nextAttempt: number } | { action: 'give_up', notifyCustomer: true, why: string }}
 */
export function decideAfterFailure({ attemptsMade, failureReason }, policy = defaultPolicy) {
  if (isPermanentFailure(failureReason, policy)) {
    return { action: 'give_up', notifyCustomer: true, why: 'permanent_failure' };
  }
  if (attemptsMade >= policy.maxAttempts) {
    return { action: 'give_up', notifyCustomer: true, why: 'attempts_exhausted' };
  }
  const nextAttempt = attemptsMade + 1;
  return { action: 'retry', delaySeconds: backoffSeconds(nextAttempt, policy), nextAttempt };
}
