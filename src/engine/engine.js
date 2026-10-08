/*
 * The correction engine. Pure functions only — no DOM, no browser APIs — so it
 * can be unit tested in Node and reused by every editor adapter.
 *
 * Adapters give the engine the text immediately before the caret, ending with
 * the character the user just typed. If that character finishes a word and the
 * word should be corrected, the engine says which trailing slice to replace and
 * with what.
 */
(function (root) {
  const NS = (root.BasicAutocorrect = root.BasicAutocorrect || {});

  // Characters that finish a word and trigger a correction.
  const BOUNDARIES = new Set([' ', '\u00A0', '\n', '.', ',', '!', '?', ';', ':', ')', ']', '}', '"', '\u201D', '\u2026']);
  // Characters allowed directly before a word (besides whitespace / start of text).
  const OPENERS = new Set(['(', '[', '{', '"', '\u201C', '\u2018', '\u00AB', '\u2014', '\u2013']);
  const WHITESPACE = /\s/;
  // A correctable built-in word: letters with optional apostrophes.
  const WORD = /^\p{L}[\p{L}'\u2019]*$/u;
  const LETTER = /\p{L}/u;
  // How far back adapters need to look for the longest word we would correct.
  const MAX_CONTEXT = 64;

  const isBoundary = (ch) => BOUNDARIES.has(ch);
  const isWordStop = (ch) => WHITESPACE.test(ch) || BOUNDARIES.has(ch) || OPENERS.has(ch);

  function normalizeKey(word) {
    return word.toLowerCase().replace(/\u2019/g, "'");
  }

  // Custom keys cannot contain characters that would end a word early.
  function isValidCustomKey(key) {
    return typeof key === 'string' && key.length > 0 && key.length <= MAX_CONTEXT - 2 &&
      ![...key].some(isWordStop);
  }

  // 'lower' | 'title' | 'upper' | 'mixed'
  function casePattern(word) {
    const letters = [...word].filter((c) => LETTER.test(c));
    if (!letters.length) return 'lower';
    const s = letters.join('');
    if (s === s.toLowerCase()) return 'lower';
    if (s === s.toUpperCase()) return letters.length === 1 ? 'title' : 'upper';
    const [first, ...rest] = letters;
    if (first === first.toUpperCase() && rest.join('') === rest.join('').toLowerCase()) return 'title';
    return 'mixed';
  }

  // Carry the capitalization the user typed over to the correction.
  // Returns null when the typed casing is unusual (e.g. "tEh", "iPhone") —
  // that's probably deliberate, so we leave it alone.
  function matchCase(typed, replacement) {
    switch (casePattern(typed)) {
      case 'lower': return replacement;
      case 'title': return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      case 'upper': return [...typed].filter((c) => LETTER.test(c)).length <= 2 ? null : replacement.toUpperCase();
      default: return null;
    }
  }

  function withApostrophe(text, curly) {
    return curly ? text.replace(/'/g, '\u2019') : text;
  }

  /**
   * Build a corrector from user settings.
   *   settings.custom     { typo: replacement }   user's own corrections
   *   settings.allowed    [word]                  never correct these
   *   settings.builtins   boolean                 use the built-in lists
   *   settings.aggressive boolean                 also fix other misspelled words
   *   settings.apostrophe 'straight' | 'curly'
   */
  function createCorrector(settings = {}) {
    const builtins = settings.builtins === false ? null : builtinMap();
    const aggressive = settings.aggressive === true;
    const custom = new Map();
    for (const [k, v] of Object.entries(settings.custom || {})) {
      if (isValidCustomKey(k) && typeof v === 'string' && v) custom.set(normalizeKey(k), v);
    }
    const allowed = new Set((settings.allowed || []).map(normalizeKey));
    const curlyDefault = settings.apostrophe === 'curly';

    // Aggressive mode: ask the speller (loaded on demand) about unknown words.
    // Capitalized words mid-sentence are probably names; ALL CAPS, acronyms.
    function suggest(token, sentenceStart) {
      const speller = aggressive && NS.spell && NS.spell.speller;
      if (!speller) return null;
      const pattern = casePattern(token);
      if (pattern === 'upper' || pattern === 'mixed' || (pattern === 'title' && !sentenceStart)) return null;
      const fix = speller.suggest(normalizeKey(token));
      return fix ? matchCase(token, fix) : null;
    }

    function lookup(token, boundary, sentenceStart = false) {
      const key = normalizeKey(token);
      if (allowed.has(key)) return null;

      if (custom.has(key)) {
        const value = custom.get(key);
        // Only re-case simple lowercase words ("adress" -> "address"); insert
        // anything else (emails, phrases with capitals, symbols) exactly.
        if (/^[\p{Ll}'\u2019 ]+$/u.test(value)) return matchCase(token, value);
        return value;
      }

      if (!WORD.test(token)) return null;
      // "i.e." — don't turn a lone letter followed by a period into anything.
      if (boundary === '.' && [...token].length === 1) return null;
      const correction = builtins && builtins[key];
      const cased = correction ? matchCase(token, correction) : suggest(token, sentenceStart);
      if (cased === null || cased === token) return null;
      return withApostrophe(cased, curlyDefault || token.includes('\u2019'));
    }

    /**
     * textBefore: text before the caret, ending with the character just typed.
     * Returns null, or { start, from, to, insert } meaning: replace
     * textBefore.slice(start) (the word plus the typed character) with `insert`.
     */
    function check(textBefore) {
      if (!textBefore) return null;
      const boundary = textBefore[textBefore.length - 1];
      if (!isBoundary(boundary)) return null;

      const end = textBefore.length - 1;
      let start = end;
      while (start > 0 && !isWordStop(textBefore[start - 1])) start--;
      // Ignore words glued to other text ("example.dont", "a,teh"): likely a
      // URL, file name, number or code.
      if (start > 0 && !WHITESPACE.test(textBefore[start - 1]) && !OPENERS.has(textBefore[start - 1])) return null;
      // A leading straight quote is punctuation, not part of the word.
      while (start < end && textBefore[start] === "'" && !custom.has(normalizeKey(textBefore.slice(start, end)))) start++;

      const token = textBefore.slice(start, end);
      if (!token) return null;
      let before = start - 1;
      while (before >= 0 && (WHITESPACE.test(textBefore[before]) || OPENERS.has(textBefore[before]))) before--;
      const sentenceStart = before < 0 || '.!?\n'.includes(textBefore[before]);
      const to = lookup(token, boundary, sentenceStart);
      if (to === null || to === undefined) return null;
      return { start, from: token, to, insert: to + boundary };
    }

    return { check, lookup };
  }

  // Hand-curated list first; the generated common-misspellings list fills in.
  let merged = null;
  function builtinMap() {
    if (!merged) merged = Object.assign(Object.create(null), NS.commonCorrections || {}, NS.builtinCorrections || {});
    return merged;
  }

  NS.engine = { createCorrector, isBoundary, isValidCustomKey, normalizeKey, matchCase, casePattern, MAX_CONTEXT };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
