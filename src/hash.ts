/**
 * Deterministic, dependency-free hashing utilities.
 * Used by the mock provider (reproducible decisions) and the cache layer.
 */

/** 32-bit FNV-1a hash of a UTF-8 string. Always returns an unsigned 32-bit int. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    // Simple UTF-16 -> UTF-8 fold, sufficient for hashing.
    if (c < 0x80) {
      hash ^= c;
    } else if (c < 0x800) {
      hash ^= 0xc0 | (c >> 6);
      hash = Math.imul(hash, 0x01000193);
      hash ^= 0x80 | (c & 0x3f);
    } else {
      hash ^= 0xe0 | (c >> 12);
      hash = Math.imul(hash, 0x01000193);
      hash ^= 0x80 | ((c >> 6) & 0x3f);
      hash = Math.imul(hash, 0x01000193);
      hash ^= 0x80 | (c & 0x3f);
    }
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Small deterministic PRNG (mulberry32) seeded from a string.
 * Produces values in [0, 1) with good distribution.
 */
export function seededRandom(seed: string): () => number {
  let a = fnv1a(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
