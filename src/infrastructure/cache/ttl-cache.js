class TtlCache {
  constructor() {
    this.store = new Map();
  }

  get(key) {
    const hit = this.store.get(key);
    if (!hit) {
      return undefined;
    }

    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    return hit.value;
  }

  set(key, value, ttlMs) {
    const ttl = Math.max(0, Number(ttlMs) || 0);
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttl
    });
    return value;
  }

  clear() {
    this.store.clear();
  }
}

module.exports = {
  TtlCache
};
