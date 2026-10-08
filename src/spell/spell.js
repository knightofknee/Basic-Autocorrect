/*
 * Aggressive mode: fix misspelled words that aren't in the correction lists,
 * the way phone keyboards do. A word is corrected only when
 *   - it is not a known word (~340k words incl. names and British spellings),
 *   - a common word is one or two small edits away, and
 *   - that candidate clearly beats every other candidate.
 * Otherwise the word is left alone. Pure logic; data is loaded on demand.
 */
(function (root) {
  const NS = (root.BasicAutocorrect = root.BasicAutocorrect || {});

  const LETTERS = "abcdefghijklmnopqrstuvwxyz'";
  const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const ADJACENT = {};
  ROWS.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      const near = new Set();
      for (let dr = -1; dr <= 1; dr++) {
        const other = ROWS[r + dr];
        if (!other) continue;
        // Rows are staggered: neighbours sit at c-1..c+1 (roughly).
        for (let dc = -1; dc <= 1; dc++) if (other[c + dc] && !(dr === 0 && dc === 0)) near.add(other[c + dc]);
      }
      ADJACENT[ch] = near;
    });
  });

  // Edit costs (1 = an ordinary typo). Cheaper = more likely to be a slip.
  const COST = { transpose: 0.6, double: 0.6, adjacent: 0.8, delete: 1, insert: 1, replace: 1.5, first: 0.4 };
  const PER_COST = 2.3; // one unit of edit cost ~ a 10x difference in word frequency
  const MARGIN = 1.6; // winner must beat the runner-up by ~5x
  const MAX_RANK = 25000; // never "correct" into rare words

  function edits(word, onEdit) {
    const n = word.length;
    for (let i = 0; i < n; i++) {
      const first = i === 0 ? COST.first : 0;
      // deletion (typed an extra letter)
      const doubled = word[i] === word[i - 1] || word[i] === word[i + 1];
      onEdit(word.slice(0, i) + word.slice(i + 1), (doubled ? COST.double : COST.delete) + first);
      // transposition
      if (i < n - 1 && word[i] !== word[i + 1]) {
        onEdit(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2), COST.transpose + first);
      }
      // substitution
      for (const ch of LETTERS) {
        if (ch === word[i]) continue;
        const near = ADJACENT[word[i]] && ADJACENT[word[i]].has(ch);
        onEdit(word.slice(0, i) + ch + word.slice(i + 1), (near ? COST.adjacent : COST.replace) + first);
      }
    }
    // insertion (missed a letter)
    for (let i = 0; i <= n; i++) {
      for (const ch of LETTERS) {
        const doubled = ch === word[i - 1] || ch === word[i];
        onEdit(word.slice(0, i) + ch + word.slice(i), (doubled ? COST.double : COST.insert) + (i === 0 ? COST.first : 0));
      }
    }
  }

  function createSpeller({ words, known }) {
    const rank = new Map();
    words.forEach((w, i) => rank.set(w, i));
    const isKnown = (w) => rank.has(w) || known.has(w);

    function score(candidate, cost) {
      return -Math.log(rank.get(candidate) + 50) - cost * PER_COST;
    }

    function consider(best, candidate, cost) {
      const r = rank.get(candidate);
      if (r === undefined || r > MAX_RANK) return;
      const s = score(candidate, cost);
      const prev = best.get(candidate);
      if (prev === undefined || s > prev) best.set(candidate, s);
    }

    function pick(best) {
      let top = null, topScore = -Infinity, second = -Infinity;
      for (const [w, s] of best) {
        if (s > topScore) {
          second = topScore;
          top = w;
          topScore = s;
        } else if (s > second) second = s;
      }
      return top && topScore - second >= MARGIN ? top : null;
    }

    // word: lowercase. Returns a lowercase correction or null.
    function suggest(word) {
      const n = word.length;
      if (n < 4 || n > 24 || !/^[a-z]+(?:'[a-z]+)?$/.test(word) || isKnown(word)) return null;

      const best = new Map();
      edits(word, (e, cost) => consider(best, e, cost));
      if (best.size) return pick(best);

      // Two edits away: only for longer words, where it's still unambiguous.
      if (n < 6 || n > 16) return null;
      const seen = new Map();
      edits(word, (e, cost) => {
        if (!seen.has(e) || seen.get(e) > cost) seen.set(e, cost);
      });
      for (const [e, cost] of seen) {
        if (cost > 1.2) continue; // second edit only after a cheap first one
        edits(e, (e2, cost2) => consider(best, e2, cost + cost2));
      }
      return best.size ? pick(best) : null;
    }

    return { suggest, isKnown };
  }

  // ---- loading (extension only) ---------------------------------------------------

  let loading = null;
  function load(getURL) {
    if (!loading) {
      loading = Promise.all([
        fetch(getURL('src/spell/words.txt')).then((r) => r.text()),
        fetch(getURL('src/spell/known.bin')).then((r) => r.arrayBuffer()),
      ]).then(([text, bin]) => {
        NS.spell.speller = createSpeller({
          words: text.split('\n').filter(Boolean),
          known: NS.bloom.loadBloom(new Uint8Array(bin)),
        });
        return NS.spell.speller;
      }).catch((e) => {
        loading = null; // try again next time
        throw e;
      });
    }
    return loading;
  }

  NS.spell = { createSpeller, load, speller: null };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.spell;
})(typeof globalThis !== 'undefined' ? globalThis : this);
