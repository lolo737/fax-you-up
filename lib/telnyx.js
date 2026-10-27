/**
 * Minimal Telnyx Programmable Fax client (POST /v2/faxes).
 * Interface: { sendFax({ to, mediaUrl, webhookUrl, clientState }) -> { id, status } }
 */
export function createTelnyxClient({ apiKey, connectionId, fromNumber, fetchImpl = fetch, baseUrl = 'https://api.telnyx.com/v2' }) {
  if (!apiKey) throw new Error('TELNYX_API_KEY is not set');
  if (!connectionId) throw new Error('TELNYX_CONNECTION_ID is not set');
  if (!fromNumber) throw new Error('TELNYX_FROM_NUMBER is not set');
  return {
    async sendFax({ to, mediaUrl, webhookUrl, clientState }) {
      const body = {
        connection_id: connectionId,
        from: fromNumber,
        to,
        media_url: mediaUrl,
        quality: 'high',
      };
      if (webhookUrl) body.webhook_url = webhookUrl;
      if (clientState) body.client_state = Buffer.from(clientState).toString('base64');
      const res = await fetchImpl(`${baseUrl}/faxes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.errors?.[0]?.detail || json?.errors?.[0]?.title || res.statusText;
        const err = new Error(`Telnyx error ${res.status}: ${detail}`);
        err.status = res.status;
        throw err;
      }
      return { id: json.data.id, status: json.data.status };
    },
  };
}
