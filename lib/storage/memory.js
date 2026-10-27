/** In-memory storage driver: used by tests and `STORAGE_DRIVER=memory` local runs. */
export function createMemoryStorage() {
  const json = new Map();
  const bytes = new Map();
  return {
    driver: 'memory',
    async getJSON(key) {
      return json.has(key) ? structuredClone(json.get(key)) : null;
    },
    async setJSON(key, value) {
      json.set(key, structuredClone(value));
    },
    async getBytes(key) {
      return bytes.has(key) ? new Uint8Array(bytes.get(key)) : null;
    },
    async setBytes(key, value) {
      bytes.set(key, new Uint8Array(value));
    },
    async delete(key) {
      json.delete(key);
      bytes.delete(key);
    },
    async list(prefix = '') {
      const keys = new Set([...json.keys(), ...bytes.keys()]);
      return [...keys].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}
