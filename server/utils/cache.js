// Simple in-memory TTL cache for expensive read-heavy queries (dashboard stats)
const store = new Map();

function cached(key, ttlMs, fn) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.val;
  const val = fn();
  store.set(key, { val, ts: Date.now() });
  return val;
}

// Invalidate all cache entries whose key starts with a given prefix
// Call after any write to keep stats fresh (optional — cache expires on its own)
function invalidate(prefix) {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

// Clear everything (e.g., after a bulk import)
function flush() { store.clear(); }

module.exports = { cached, invalidate, flush };
