# Correction safety review (1.0.1)

Goal: autocorrect must only help. It must never change a correct word, and
never "fix" a typo into the wrong word. Leaving a typo alone is acceptable.

Measured with `node scripts/eval-corrections.mjs` against data the extension
does not ship as its answer key:

- **Real words:** ~705,000 words and names (SCOWL at every size and spelling,
  the system dictionary, and US first names and surnames).
- **Real misspellings:** ~4,000, from Wikipedia's list and the Norvig/Birkbeck
  test sets.
- **Simulated finger slips:** ~126,000, made from the 3,000 most common words
  (swapped letters, doubled or missed letters, neighbouring keys).

## What 1.0.0 got wrong

- **Aggressive mode** would have changed **59,391** real (if uncommon) words.
  It also picked the wrong word for **12%** of hard misspellings: "noobs" →
  "boobs", "perple" → "people" (meant purple), "semetary" → "secretary". Causes:
  - its "is this a real word?" list was too small (no slang, no variant spellings),
  - a word with a single nearby candidate was always "corrected",
  - two-edit guesses were often wrong, and slow (12–28 ms per word),
  - nothing stopped it from producing vulgar words.
- **Basic lists** included accepted spellings and real words: `heros`,
  `liquify`, `funguses`, `creche`, `august` → "August".
- **Names:** a typo that is also someone's name, typed capitalized mid-sentence,
  was "fixed" (Kelsey Grammer → "Grammar").
- **Punctuation:** in regular fields, a period corrected the word immediately,
  so `teh.txt` became `the.txt`.
- **Docs caret tracking:** a click or Tab was assumed to land at the start of a
  word, so typing "im " right after clicking inside "cla" could produce "claI'm".
- **Identifier fields:** usernames, codes and name fields (and password fields
  revealed as plain text) were treated as prose.

## What changed

- **Aggressive mode:**
  - It never changes any of ~650,000 known words: every SCOWL spelling
    including British and variant forms and accent-free forms, real-usage words
    from the frequency list, first names, a hand-kept slang/tech list, and the
    plurals of all of these.
  - Only one finger slip (swapped, doubled or missed letter, or a neighbouring
    key) can win.
  - Every possible correction still competes, so a typo that could mean two
    words is left alone.
  - "Leave it as typed" always competes, so a lone nearby word isn't enough.
  - It never produces a word on the never-suggest list (`scripts/data/never-suggest.txt`).
  - It looks one edit away only: about 1 ms per word.
- **Basic lists:** real words and accepted variants are removed via
  `scripts/data/not-typos.txt`. Typos that are also names are left alone when
  capitalized mid-sentence.
- **Punctuation:** outside Docs, words are checked when the space or Enter after
  them is typed, so file names and web addresses are seen whole. In Docs,
  punctuation still acts immediately, because Docs runs its own autocorrect on
  punctuation. Waiting caused a real corruption there ("dont?" → "Ddon't?"),
  caught by the Docs suite.
- **Docs:** after a click, Tab, or the typing frame reloading, the next word is
  left alone. One-press undo also works after the space that follows punctuation.
- **Regular fields:** username, password, code, email, phone, postcode and name
  fields are skipped, as are fields marked `spellcheck="false"` or `autocorrect="off"`.

## Numbers (1.0.1)

| | Result |
|---|---|
| Basic: listed typos fixed as intended | 3,569 / 3,569 |
| Aggressive, simulated finger slips | 105,451 right · **25 wrong (0.02%)** · 21,045 left alone |
| Aggressive, hard real misspellings not on the lists | 81 right · **1 wrong** · 432 left alone |
| Aggressive, real dictionary words changed | 6 of 63,033 unknown (all are typo-like entries in the 1934 dictionary, e.g. "saiid", "yoursel") |
| Aggressive, entries from the surnames list changed | 777, while typed lowercase (capitalized names mid-sentence are never changed; the list contains junk like "Brwon") |

The "wrong" finger-slip cases are artifacts of generating typos mechanically:
for "wway" (made from "away"), "way" is the better guess.

The Basic report lists ~320 entries that some large word list also contains.
Each was reviewed by hand. They are:
- misspelling variants that large dictionaries record (`arround`, `alledged`,
  `teh`),
- the requested contractions (`cant`, `wont`),
- typos that are also names (now left alone mid-sentence when capitalized).

## Before shipping any change to lists, the speller or typing logic

```bash
node scripts/eval-corrections.mjs
```

```bash
npm test && npm run test:browser && npm run test:chrome && npm run test:firefox && npm run test:docs
```
