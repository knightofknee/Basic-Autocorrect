/*
 * Bloom filter for "is this a real word?" — compact enough to ship ~340k
 * words in ~400 KB. A false positive only means a typo is left alone.
 * Shared by scripts/build-data.mjs (writes known.bin) and spell.js (reads it).
 */
(function (root) {
  const NS = (root.BasicAutocorrect = root.BasicAutocorrect || {});

  function fnv1a(str, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }

  // k bit positions in [0, m) via double hashing.
  function bloomHashes(word, m, k) {
    const h1 = fnv1a(word, 2166136261);
    const h2 = fnv1a(word, 0x9747b28c) | 1;
    const out = new Array(k);
    for (let i = 0; i < k; i++) out[i] = ((h1 + Math.imul(i, h2)) >>> 0) % m;
    return out;
  }

  // bytes: [m (uint32 LE), k (uint32 LE), ...bits]
  function loadBloom(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const m = view.getUint32(0, true);
    const k = view.getUint32(4, true);
    return {
      has(word) {
        for (const h of bloomHashes(word, m, k)) {
          if (!(bytes[8 + (h >>> 3)] & (1 << (h & 7)))) return false;
        }
        return true;
      },
    };
  }

  NS.bloom = { bloomHashes, loadBloom };
  if (typeof module !== 'undefined' && module.exports) module.exports = { bloomHashes, loadBloom };
})(typeof globalThis !== 'undefined' ? globalThis : this);
