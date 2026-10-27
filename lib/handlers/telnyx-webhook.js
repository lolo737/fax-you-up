import { errorResponse, json, methodNotAllowed } from '../http.js';
import { addHistory, getFax, handleDelivered, handleFailure, saveFax } from '../faxes.js';
import { verifyTelnyxSignature } from '../crypto.js';

const FINAL = new Set(['delivered', 'failed']);

/**
 * POST — Telnyx fax status webhook. Verifies the Ed25519 signature with
 * TELNYX_PUBLIC_KEY. Only set TELNYX_SKIP_SIGNATURE_VERIFICATION=true for local
 * experiments; it is refused when CONTEXT=production.
 */
export const createTelnyxWebhookHandler = (deps) => async (req) => {
  if (req.method !== 'POST') return methodNotAllowed('POST');
  const { env, storage, now = () => Date.now() } = deps;
  const rawBody = await req.text();
  const skip = env.TELNYX_SKIP_SIGNATURE_VERIFICATION === 'true' && env.CONTEXT !== 'production';
  if (!skip) {
    const ok = verifyTelnyxSignature({
      rawBody,
      signature: req.headers.get('telnyx-signature-ed25519'),
      timestamp: req.headers.get('telnyx-timestamp'),
      publicKey: env.TELNYX_PUBLIC_KEY,
      now: now(),
    });
    if (!ok) return errorResponse(400, 'Invalid signature.', 'bad_signature');
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, 'Bad JSON.', 'bad_json');
  }
  const type = event?.data?.event_type;
  const payload = event?.data?.payload || {};
  const telnyxFaxId = payload.fax_id;
  if (!type || !telnyxFaxId) return json({ ignored: 'no_fax_id' });

  const link = await storage.getJSON(`telnyx/${telnyxFaxId}`);
  const fax = link && (await getFax(storage, link.faxId));
  if (!fax) return json({ ignored: 'unknown_fax' });
  if (FINAL.has(fax.status)) return json({ ignored: 'already_final' });
  if (fax.currentTelnyxFaxId && fax.currentTelnyxFaxId !== telnyxFaxId) return json({ ignored: 'stale_attempt' });

  switch (type) {
    case 'fax.delivered':
      await handleDelivered(fax, deps);
      break;
    case 'fax.failed':
      await handleFailure(fax, payload.failure_reason || 'unknown', deps);
      break;
    case 'fax.queued':
    case 'fax.media.processed':
    case 'fax.sending.started':
      addHistory(fax, type, now());
      await saveFax(storage, fax, now());
      break;
    default:
      break;
  }
  return json({ received: true, status: fax.status });
};
