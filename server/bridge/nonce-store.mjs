export class MemoryNonceStore {
  #entries = new Map();
  #maxEntries;

  constructor({ maxEntries = 10_000 } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new TypeError("maxEntries must be a positive integer.");
    this.#maxEntries = maxEntries;
  }

  async claim(deviceId, nonce, expiresAt, now = Date.now()) {
    for (const [key, expiry] of this.#entries) {
      if (expiry <= now) this.#entries.delete(key);
    }
    const key = `${deviceId}\u0000${nonce}`;
    if (this.#entries.has(key)) return false;
    if (this.#entries.size >= this.#maxEntries) return false;
    this.#entries.set(key, expiresAt);
    return true;
  }

  get size() { return this.#entries.size; }
}
