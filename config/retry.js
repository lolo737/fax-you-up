/**
 * Retry policy for faxes Telnyx reports as failed.
 *
 * Attempt N+1 waits backoffBaseSeconds * backoffMultiplier^(N-1) seconds,
 * capped at backoffMaxSeconds. With the defaults: 2 min, 8 min, 32 min.
 * The customer is e-mailed about a failure ONLY once it is final: either the
 * reason is clearly permanent (bad number, not a fax line) or the attempts are spent.
 */
export const retryPolicy = {
  maxAttempts: 4,
  backoffBaseSeconds: 120,
  backoffMultiplier: 4,
  backoffMaxSeconds: 3600,
  /** Failure reasons containing any of these fragments are not worth retrying. */
  permanentFailureReasonPatterns: [
    'invalid',
    'not_a_fax',
    'no_fax',
    'unallocated',
    'number_format',
    'destination_not_allowed',
    'unsupported_media',
    'media_unprocessable',
  ],
};

export default retryPolicy;
