import { getStore } from '@netlify/blobs';

/**
 * Netlify Blobs driver (the default in production). Inside a Netlify Function
 * the store is configured automatically; elsewhere set NETLIFY_SITE_ID and
 * NETLIFY_BLOBS_TOKEN.
 */
export function createNetlifyBlobsStorage({ name = 'fax-you-up', env = process.env } = {}) {
  const opts = { name, consistency: 'strong' };
  if (env.NETLIFY_SITE_ID && env.NETLIFY_BLOBS_TOKEN) {
    opts.siteID = env.NETLIFY_SITE_ID;
    opts.token = env.NETLIFY_BLOBS_TOKEN;
  }
  const store = getStore(opts);
  return {
    driver: 'netlify-blobs',
    async getJSON(key) {
      return (await store.get(key, { type: 'json' })) ?? null;
    },
    async setJSON(key, value) {
      await store.setJSON(key, value);
    },
    async getBytes(key) {
      const buf = await store.get(key, { type: 'arrayBuffer' });
      return buf ? new Uint8Array(buf) : null;
    },
    async setBytes(key, value) {
      await store.set(key, value);
    },
    async delete(key) {
      await store.delete(key);
    },
    async list(prefix = '') {
      const { blobs } = await store.list({ prefix });
      return blobs.map((b) => b.key).sort();
    },
  };
}
