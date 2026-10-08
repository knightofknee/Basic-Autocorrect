// Builds the generated word data from public word lists:
//   src/engine/data-common.js   common misspellings (Wikipedia), filtered
//   src/spell/words.txt         common words, most frequent first (aggressive mode)
//   src/spell/known.bin         Bloom filter of ~340k valid words (aggressive mode)
//
// Sources (downloaded into .dev/sources on first run):
//   SCOWL 2020.12.07, Kevin Atkinson et al. (permissive; see NOTICE.md)
//   Wikipedia "Lists of common misspellings/For machines" (CC BY-SA 4.0)
//   FrequencyWords en_50k, Hermit Dave, from OpenSubtitles 2018 (CC BY-SA 4.0)
//
// Usage: node scripts/build-data.mjs
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = ROOT + '.dev/sources/';
const SOURCES = {
  scowl: 'https://downloads.sourceforge.net/project/wordlist/SCOWL/2020.12.07/scowl-2020.12.07.tar.gz',
  wiki: 'https://en.wikipedia.org/w/index.php?title=Wikipedia:Lists_of_common_misspellings/For_machines&action=raw',
  freq: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt',
};

async function download(name, file) {
  if (existsSync(SRC + file)) return;
  console.log('downloading', name);
  const res = await fetch(SOURCES[name]);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  await writeFile(SRC + file, Buffer.from(await res.arrayBuffer()));
}

await mkdir(SRC, { recursive: true });
await download('scowl', 'scowl.tar.gz');
await download('wiki', 'wiki-misspellings.txt');
await download('freq', 'en_50k.txt');
if (!existsSync(SRC + 'scowl-2020.12.07')) execFileSync('tar', ['xzf', 'scowl.tar.gz'], { cwd: SRC });

// ---- SCOWL ------------------------------------------------------------------------
const FINAL = SRC + 'scowl-2020.12.07/final/';
const files = await readdir(FINAL);
const latin1 = new TextDecoder('latin1');
async function scowl({ maxLevel, kinds, spellings = ['english', 'american', 'british', 'canadian'] }) {
  const out = new Set();
  for (const f of files) {
    const m = f.match(/^([a-z_0-9]+)-([a-z-]+)\.(\d+)$/);
    if (!m || !spellings.includes(m[1]) || !kinds.includes(m[2]) || Number(m[3]) > maxLevel) continue;
    for (const w of latin1.decode(await readFile(FINAL + f)).split('\n')) {
      if (w) out.add(w.normalize('NFC').toLowerCase());
    }
  }
  return out;
}
const ALL_KINDS = ['words', 'upper', 'proper-names', 'contractions', 'abbreviations'];
const known = await scowl({ maxLevel: 80, kinds: ALL_KINDS });
const common = await scowl({ maxLevel: 60, kinds: ['words', 'contractions'], spellings: ['english', 'american'] });
console.log(`known words: ${known.size}, common words: ${common.size}`);

// ---- frequencies --------------------------------------------------------------------
const freq = new Map();
for (const line of (await readFile(SRC + 'en_50k.txt', 'utf8')).split('\n')) {
  const [w, n] = line.trim().split(' ');
  if (w) freq.set(w.toLowerCase(), Number(n));
}
// The frequency list drops apostrophes ("dont"), so look contractions up that way.
const countOf = (w) => freq.get(w) || freq.get(w.replace(/'/g, '')) || 0;

// Candidate words for aggressive correction: common, real, plain words that
// people actually use, most frequent first.
// The subtitle tokenizer split contractions ("don't" -> "don" + "t"), which
// inflates these fragments; keep them out of the candidates.
const FRAGMENTS = new Set(['don', 'didn', 'doesn', 'isn', 'wasn', 'aren', 'weren', 'couldn', 'shouldn', 'wouldn',
  'hasn', 'haven', 'hadn', 'mustn', 'needn', 'ain', 'mightn', 'shan', 'll', 've', 're']);
const candidates = [...common]
  .filter((w) => /^[a-z]+(?:'[a-z]+)?$/.test(w) && countOf(w) >= 20 && !FRAGMENTS.has(w))
  .sort((a, b) => countOf(b) - countOf(a));
for (const w of ['a', 'i']) if (!candidates.includes(w)) candidates.push(w);
await mkdir(ROOT + 'src/spell', { recursive: true });
await writeFile(ROOT + 'src/spell/words.txt', candidates.join('\n') + '\n');
console.log(`candidates: ${candidates.length}`);

// ---- Bloom filter of known words ------------------------------------------------------
// False positives only mean a typo is treated as a real word (left alone).
const require = createRequire(import.meta.url);
const { bloomHashes } = require('../src/spell/bloom.js');
const n = known.size + candidates.length;
const m = Math.ceil((-n * Math.log(0.01)) / Math.LN2 ** 2 / 8) * 8; // ~1% false positives
const k = 7;
const bits = new Uint8Array(m / 8 + 8);
new DataView(bits.buffer).setUint32(0, m, true);
new DataView(bits.buffer).setUint32(4, k, true);
for (const w of [...known, ...candidates]) {
  for (const h of bloomHashes(w, m, k)) bits[8 + (h >>> 3)] |= 1 << (h & 7);
}
await writeFile(ROOT + 'src/spell/known.bin', bits);
console.log(`bloom: ${(bits.length / 1024).toFixed(0)} KB`);

// ---- common misspellings ---------------------------------------------------------------
const { builtinCorrections: handCurated } = require('../src/engine/data.js');
const isKnown = (w) => known.has(w);
const wiki = {};
let skipped = 0;
for (const line of (await readFile(SRC + 'wiki-misspellings.txt', 'utf8')).split('\n')) {
  const m = line.trim().match(/^([^\s>]+)->(.+)$/);
  if (!m) continue;
  const typo = m[1].toLowerCase();
  const correction = m[2].trim();
  const ok =
    !correction.includes(',') && // several possible meanings: ambiguous
    /^[a-z']{3,}$/.test(typo) &&
    !isKnown(typo) && // a real word: never "correct" it
    !(typo in handCurated) &&
    correction.toLowerCase() !== typo &&
    correction.toLowerCase().split(/[ -]/).every(isKnown);
  if (ok) wiki[typo] = correction;
  else skipped++;
}
const header = `/*
 * GENERATED by scripts/build-data.mjs — do not edit by hand.
 * Common English misspellings, from Wikipedia's "Lists of common misspellings"
 * (https://en.wikipedia.org/wiki/Wikipedia:Lists_of_common_misspellings),
 * licensed CC BY-SA 4.0. Filtered: only single, unambiguous corrections whose
 * typo is not a real word in SCOWL (size 80).
 */
`;
await writeFile(ROOT + 'src/engine/data-common.js', header + `(function (root) {
  const NS = (root.BasicAutocorrect = root.BasicAutocorrect || {});
  NS.commonCorrections = ${JSON.stringify(wiki, null, 0).replace(/","/g, '",\n"')};
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
`);
console.log(`common misspellings: ${Object.keys(wiki).length} kept, ${skipped} skipped`);
