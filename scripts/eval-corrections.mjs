// Measures whether autocorrect ever makes typing worse. Two questions:
//   1. Harm: does it change words that are already correct?
//      Checked against ~700k real words and names (SCOWL up to size 95, the
//      system dictionary, US first and last names), none of which it may change.
//   2. Wrong fixes: when it corrects a real misspelling, is it the intended word?
//      Checked against real misspellings (Wikipedia list, Norvig/Birkbeck sets).
// Basic lists and Aggressive speller are reported separately. Runs on all CPU cores.
//
// Needs the sources from `node scripts/build-data.mjs`; downloads the rest.
// Usage: node scripts/eval-corrections.mjs [--samples N] [--compare]
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = ROOT + '.dev/sources/';
const require = createRequire(import.meta.url);

async function loadSpeller(options) {
  const { loadBloom } = require('../src/spell/bloom.js');
  const { createSpeller } = require('../src/spell/spell.js');
  return createSpeller({
    words: (await readFile(ROOT + 'src/spell/words.txt', 'utf8')).split('\n').filter(Boolean),
    known: loadBloom(new Uint8Array(await readFile(ROOT + 'src/spell/known.bin'))),
  }, options);
}

// ---- worker: run the speller over a slice of words ----------------------------------
if (!isMainThread) {
  const speller = await loadSpeller(workerData.options);
  const out = workerData.words.map((w) => speller.suggest(w));
  parentPort.postMessage(out);
}

async function suggestAll(words, options) {
  const n = availableParallelism();
  const size = Math.ceil(words.length / n);
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => new Promise((resolve, reject) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { words: words.slice(i * size, (i + 1) * size), options } });
    w.once('message', resolve);
    w.once('error', reject);
  })));
  return parts.flat();
}

// ---- main ------------------------------------------------------------------------------
if (isMainThread) {
  const SAMPLES = process.argv.includes('--samples') ? Number(process.argv[process.argv.indexOf('--samples') + 1]) : 30;
  const EVAL_SOURCES = {
    'norvig1.txt': 'https://norvig.com/spell-testset1.txt',
    'norvig2.txt': 'https://norvig.com/spell-testset2.txt',
    'names-first.txt': 'https://raw.githubusercontent.com/smashew/NameDatabases/master/NamesDatabases/first%20names/us.txt',
    'names-last.txt': 'https://raw.githubusercontent.com/smashew/NameDatabases/master/NamesDatabases/surnames/us.txt',
  };
  for (const [file, url] of Object.entries(EVAL_SOURCES)) {
    if (!existsSync(SRC + file)) await writeFile(SRC + file, Buffer.from(await (await fetch(url)).arrayBuffer()));
  }

  require('../src/engine/data.js');
  require('../src/engine/data-common.js');
  const NS = globalThis.BasicAutocorrect;
  const basic = Object.assign(Object.create(null), NS.commonCorrections, NS.builtinCorrections);

  // Real words.
  const latin1 = new TextDecoder('latin1');
  const FINAL = SRC + 'scowl-2020.12.07/final/';
  const real = new Map();
  const add = (w, source) => {
    w = w.trim().toLowerCase();
    if (/^[a-z]+(?:'[a-z]+)?$/.test(w) && !real.has(w)) real.set(w, source);
  };
  for (const f of await readdir(FINAL)) {
    if (/^[a-z_0-9]+-(words|upper|proper-names|contractions)\.\d+$/.test(f)) {
      for (const w of latin1.decode(await readFile(FINAL + f)).split('\n')) add(w, 'scowl-' + f.split('.')[1]);
    }
  }
  if (existsSync('/usr/share/dict/words')) for (const w of (await readFile('/usr/share/dict/words', 'utf8')).split('\n')) add(w, 'dict');
  for (const f of ['names-first.txt', 'names-last.txt']) for (const w of (await readFile(SRC + f, 'utf8')).split('\n')) add(w, 'name');

  // Real misspellings (excluding "typos" that are themselves real words).
  const typos = new Map();
  const addTypo = (t, right) => !real.has(t) && !typos.has(t) && typos.set(t, right.toLowerCase());
  for (const line of (await readFile(SRC + 'wiki-misspellings.txt', 'utf8')).split('\n')) {
    const m = line.trim().match(/^([a-z']+)->([a-zA-Z']+)$/);
    if (m) addTypo(m[1], m[2]);
  }
  for (const f of ['norvig1.txt', 'norvig2.txt']) {
    for (const line of (await readFile(SRC + f, 'utf8')).split('\n')) {
      const [right, wrongs] = line.split(':');
      if (!wrongs || !/^[a-z']+$/.test(right.trim())) continue;
      for (const w of wrongs.trim().split(/\s+/)) if (/^[a-z']+$/.test(w)) addTypo(w, right.trim());
    }
  }

  // Basic lists: harm is fixed data, independent of speller settings.
  const harmBasic = [...real].filter(([w]) => basic[w] && basic[w].toLowerCase() !== w).map(([w, src]) => `${w} → ${basic[w]} (${src})`);

  // Only words the speller doesn't already know can be harmed; find them once.
  const probe = await loadSpeller({});
  const unknownReal = [...real.keys()].filter((w) => !basic[w] && !probe.isKnown(w) && w.length >= 3);
  const typoList = [...typos.keys()].filter((t) => !basic[t]);
  const basicTypos = [...typos.keys()].filter((t) => basic[t]);
  const basicRight = basicTypos.filter((t) => basic[t].toLowerCase().replace(/'/g, '') === typos.get(t).replace(/'/g, '')).length;

  console.log(`Real words and names: ${real.size.toLocaleString()} (${unknownReal.length.toLocaleString()} unknown to the speller)`);
  console.log(`Real misspellings: ${typos.size.toLocaleString()} (${basicTypos.length} covered by the Basic lists)\n`);
  console.log(`BASIC LISTS: changes ${harmBasic.length} correct words; fixes ${basicRight}/${basicTypos.length} listed typos as intended`);
  if (harmBasic.length) console.log('    ' + harmBasic.slice(0, SAMPLES).join('\n    '));

  // --compare sweeps the confidence threshold across edit models.
  const only = process.argv.includes('--config') ? JSON.parse(process.argv[process.argv.indexOf('--config') + 1]) : null;
  const slips = ['transpose', 'double', 'adjacent'];
  const configs = only ? { custom: only } : process.argv.includes('--compare') ? Object.fromEntries([-10, -11, -12, -13, -14].flatMap((k) => [
    [`slips win, keep ${k}`, { twoEdits: false, keepScore: k, winKinds: slips }],
    [`slips+missed letter win, keep ${k}`, { twoEdits: false, keepScore: k, winKinds: [...slips, 'insert'] }],
    [`slips+missed+extra win, keep ${k}`, { twoEdits: false, keepScore: k, winKinds: [...slips, 'insert', 'delete'] }],
  ])) : { current: {} };

  // Realistic finger slips on the 3,000 most common words: swapped letters,
  // doubled/undoubled letters, a neighbouring key, a missed letter.
  const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const near = {};
  ROWS.forEach((row, r) => [...row].forEach((ch, c) => {
    near[ch] = [r - 1, r, r + 1].flatMap((rr) => (ROWS[rr] ? [c - 1, c, c + 1].map((cc) => ROWS[rr][cc]) : [])).filter((x) => x && x !== ch);
  }));
  const common = (await readFile(ROOT + 'src/spell/words.txt', 'utf8')).split('\n').filter((w) => w.length >= 4).slice(0, 3000);
  const slipTypos = new Map();
  for (const w of common) {
    const variants = [];
    for (let i = 0; i < w.length; i++) {
      if (i < w.length - 1 && w[i] !== w[i + 1]) variants.push(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
      variants.push(w.slice(0, i) + w.slice(i + 1)); // missed a letter
      variants.push(w.slice(0, i) + w[i] + w.slice(i)); // doubled a letter
      for (const ch of near[w[i]] || []) variants.push(w.slice(0, i) + ch + w.slice(i + 1));
    }
    for (const v of variants) if (v !== w && !real.has(v) && !probe.isKnown(v) && !basic[v] && !slipTypos.has(v)) slipTypos.set(v, w);
  }
  const slipList = [...slipTypos.keys()];
  console.log(`Synthetic finger slips on common words: ${slipList.length.toLocaleString()}`);

  for (const [name, options] of Object.entries(configs)) {
    const t0 = Date.now();
    const harmS = await suggestAll(unknownReal, options);
    const fixS = await suggestAll(typoList, options);
    const harm = unknownReal.map((w, i) => [w, harmS[i]]).filter(([, s]) => s);
    let right = 0, wrong = 0;
    const wrongs = [];
    typoList.forEach((t, i) => {
      const s = fixS[i];
      if (!s) return;
      if (s.replace(/'/g, '') === typos.get(t).replace(/'/g, '')) right++;
      else {
        wrong++;
        wrongs.push(`${t} → ${s} (meant ${typos.get(t)})`);
      }
    });
    console.log(`\nAGGRESSIVE [${name}]  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    const bySource = (src) => harm.filter(([w]) => real.get(w) === src).length;
    console.log(`  changes correct words: ${harm.length} of ${unknownReal.length.toLocaleString()} (dictionary words: ${bySource('dict')}, surnames list: ${bySource('name')})`);
    if (harm.length) console.log('    ' + harm.slice(0, SAMPLES).map(([w, s]) => `${w} → ${s} (${real.get(w)})`).join('\n    '));
    console.log(`  on ${typoList.length} other real typos: ${right} right, ${wrong} WRONG, ${typoList.length - right - wrong} left alone`);
    if (wrongs.length) console.log('    ' + wrongs.slice(0, SAMPLES).join('\n    '));
    const slipS = await suggestAll(slipList, options);
    let sRight = 0, sWrong = 0;
    const sWrongs = [];
    slipList.forEach((t, i) => {
      if (!slipS[i]) return;
      if (slipS[i] === slipTypos.get(t)) sRight++;
      else {
        sWrong++;
        sWrongs.push(`${t} → ${slipS[i]} (meant ${slipTypos.get(t)})`);
      }
    });
    console.log(`  on ${slipList.length} finger slips: ${sRight} right, ${sWrong} WRONG, ${slipList.length - sRight - sWrong} left alone`);
    if (sWrongs.length) console.log('    ' + sWrongs.slice(0, SAMPLES).join('\n    '));
  }
}
