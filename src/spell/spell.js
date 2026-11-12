/*
 * Aggressive mode: fix misspelled words that aren't in the correction lists.
 * Built to help only: a word is corrected only when
 *   - it is not a known word (~650k words: every SCOWL spelling incl. names,
 *     British/variant spellings, real-usage words, slang), nor a plural of one,
 *   - it is exactly one finger slip (swapped, doubled or missed letter, or a
 *     neighbouring key) away from a common word,
 *   - no other correction is about as likely, and
 *   - the correction is clearly more likely than the word being real-but-rare.
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

  // Tuned with scripts/eval-corrections.mjs (held-out real words, real
  // misspellings and simulated finger slips). With these settings: 0.02% of
  // corrections pick the wrong word on finger slips, ~1% on real misspellings,
  // and real dictionary words are essentially never changed.
  const DEFAULTS = {
    // Edit costs (1 = an ordinary typo). Cheaper = more likely to be a slip.
    cost: { transpose: 0.6, double: 0.6, adjacent: 0.8, delete: 1, insert: 1, replace: 1.5, first: 0.4 },
    perCost: 2.3, // one unit of edit cost ~ a 10x difference in word frequency
    margin: 1.6, // winner must beat the runner-up and "leave it" by this much (log scale)
    keepScore: -12, // how likely a correction must be before it beats "leave it as typed"
    maxRank: 25000, // never "correct" into rare words
    minLength: 4,
    twoEdits: false, // two-edit guesses were wrong too often (and slow)
    // Edit kinds allowed to WIN: finger slips only. Every kind still counts as a
    // competitor, so a typo that could be two different words is left alone.
    winKinds: ['transpose', 'double', 'adjacent', 'insert'],
  };

  function edits(word, onEdit, COST) {
    const n = word.length;
    for (let i = 0; i < n; i++) {
      const first = i === 0 ? COST.first : 0;
      // deletion (typed an extra letter)
      const doubled = word[i] === word[i - 1] || word[i] === word[i + 1];
      onEdit(word.slice(0, i) + word.slice(i + 1), (doubled ? COST.double : COST.delete) + first, doubled ? 'double' : 'delete');
      // transposition
      if (i < n - 1 && word[i] !== word[i + 1]) {
        onEdit(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2), COST.transpose + first, 'transpose');
      }
      // substitution
      for (const ch of LETTERS) {
        if (ch === word[i]) continue;
        const near = ADJACENT[word[i]] && ADJACENT[word[i]].has(ch);
        onEdit(word.slice(0, i) + ch + word.slice(i + 1), (near ? COST.adjacent : COST.replace) + first, near ? 'adjacent' : 'replace');
      }
    }
    // insertion (missed a letter)
    for (let i = 0; i <= n; i++) {
      for (const ch of LETTERS) {
        const doubled = ch === word[i - 1] || ch === word[i];
        onEdit(word.slice(0, i) + ch + word.slice(i), (doubled ? COST.double : COST.insert) + (i === 0 ? COST.first : 0), doubled ? 'double' : 'insert');
      }
    }
  }

  function createSpeller({ words, known }, options = {}) {
    const opt = { ...DEFAULTS, ...options, cost: { ...DEFAULTS.cost, ...(options.cost || {}) } };
    const COST = opt.cost;
    const winKinds = new Set(opt.winKinds);
    const rank = new Map();
    words.forEach((w, i) => rank.set(w, i));
    const has = (w) => rank.has(w) || known.has(w);
    // Plurals and possessives of known words are known too ("noobs", "noob's").
    // Not -ing/-ed: "swiming" is a typo even though "swim" is a word.
    const SUFFIXES = ["'s", 's', 'es'];
    const isKnown = (w) => has(w) || SUFFIXES.some((x) => w.length > x.length + 2 && w.endsWith(x) && has(w.slice(0, -x.length)));

    function score(candidate, cost) {
      return -Math.log(rank.get(candidate) + 50) - cost * opt.perCost;
    }

    // best: candidate -> { score, canWin }. Rare words still compete (they make
    // a typo ambiguous) but can never be chosen.
    function consider(best, candidate, cost, kind) {
      const r = rank.get(candidate);
      if (r === undefined) return;
      const s = score(candidate, cost);
      const canWin = winKinds.has(kind) && r <= opt.maxRank;
      const prev = best.get(candidate);
      if (!prev || s > prev.score) best.set(candidate, { score: s, canWin });
    }

    // The winner must clearly beat both the runner-up and "leave it as typed"
    // (the word may be real but unknown to us): one nearby word isn't enough.
    function pick(best) {
      let top = null, topScore = -Infinity, second = -Infinity;
      let topCanWin = false;
      for (const [w, { score: s, canWin }] of best) {
        if (s > topScore) {
          second = topScore;
          top = w;
          topScore = s;
          topCanWin = canWin;
        } else if (s > second) second = s;
      }
      return top && topCanWin && topScore - Math.max(second, opt.keepScore) >= opt.margin ? top : null;
    }

    // word: lowercase. Returns a lowercase correction or null.
    function suggest(word) {
      const n = word.length;
      if (n < opt.minLength || n > 24 || !/^[a-z]+(?:'[a-z]+)?$/.test(word) || isKnown(word)) return null;

      const best = new Map();
      edits(word, (e, cost, kind) => consider(best, e, cost, kind), COST);
      if (best.size) return pick(best);

      // Two edits away: only for longer words, where it's still unambiguous.
      if (!opt.twoEdits || n < 6 || n > 16) return null;
      const seen = new Map();
      edits(word, (e, cost) => {
        if (!seen.has(e) || seen.get(e) > cost) seen.set(e, cost);
      }, COST);
      for (const [e, cost] of seen) {
        if (cost > 1.2) continue; // second edit only after a cheap first one
        edits(e, (e2, cost2) => consider(best, e2, cost + cost2, 'two'), COST);
      }
      return best.size ? pick(best) : null;
    }

    return { suggest, isKnown, options: opt };
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

  NS.spell = { createSpeller, load, speller: null, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.spell;
})(typeof globalThis !== 'undefined' ? globalThis : this);
