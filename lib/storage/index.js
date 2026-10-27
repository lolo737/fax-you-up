/**
 * Storage interface. Every driver implements:
 *   getJSON(key) -> object|null      setJSON(key, value)
 *   getBytes(key) -> Uint8Array|null  setBytes(key, Uint8Array)
 *   delete(key)                       list(prefix) -> string[]
 * Pick a driver with STORAGE_DRIVER=netlify-blobs (default) | memory.
 */
import { createMemoryStorage } from './memory.js';

let cached;

export async function getStorage(env = process.env) {
  if (cached) return cached;
  const driver = env.STORAGE_DRIVER || 'netlify-blobs';
  if (driver === 'memory') {
    cached = createMemoryStorage();
  } else if (driver === 'netlify-blobs') {
    const { createNetlifyBlobsStorage } = await import('./netlify-blobs.js');
    cached = createNetlifyBlobsStorage({ env });
  } else {
    throw new Error(`Unknown STORAGE_DRIVER "${driver}"`);
  }
  return cached;
}

export { createMemoryStorage };
