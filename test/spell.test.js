// The aggressive-mode speller, against the real shipped word data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadBloom } = require('../src/spell/bloom.js');
const { createSpeller } = require('../src/spell/spell.js');

const dir = path.join(__dirname, '../src/spell/');
const speller = createSpeller({
  words: fs.readFileSync(dir + 'words.txt', 'utf8').split('\n').filter(Boolean),
  known: loadBloom(new Uint8Array(fs.readFileSync(dir + 'known.bin'))),
});

test('fixes clear typos', () => {
  const cases = {
    wrok: 'work', thnig: 'thing', porgram: 'program',
    computr: 'computer', absolutly: 'absolutely', exampel: 'example', swiming: 'swimming', runing: 'running',
    questoin: 'question', contorl: 'control', differnt: 'different', wrold: 'world', quikc: 'quick',
  };
  for (const [typo, fixed] of Object.entries(cases)) assert.equal(speller.suggest(typo), fixed, typo);
});

test('leaves real words, names, slang and tech terms alone', () => {
  const words = ('work piece thing quixotic googled tweeted vibe okay brian docs javascript colour realise ' +
    'gonna wanna emoji selfie blog podcast nope yeah hmm ugh betted gaol outre cafe naive stogy').split(' ');
  for (const w of words) assert.equal(speller.suggest(w), null, w);
});

test('declines when the intended word is unclear', () => {
  for (const w of ['jumsp', 'helo', 'thr']) assert.equal(speller.suggest(w), null, w);
});

test('bloom filter knows its words', () => {
  const known = loadBloom(new Uint8Array(fs.readFileSync(dir + 'known.bin')));
  for (const w of ['the', 'quixotic', 'colour', "don't", 'paris']) assert.ok(known.has(w), w);
});

test('slang and its plurals are real words', () => {
  for (const w of ['noob', 'noobs', 'newb', 'newbs', 'noobing', 'bruh', 'yeeted', 'rizz', 'smh', 'streamers']) {
    assert.equal(speller.suggest(w), null, w);
  }
});

test('never corrects into vulgar words', () => {
  const blocked = new Set(fs.readFileSync(path.join(__dirname, '../scripts/data/never-suggest.txt'), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
  // One-key slips next to blocked words, e.g. b/n are neighbours: "noobs" vs "boobs".
  for (const w of ['boobz', 'bpobs', 'tots', 'fick', 'shiit']) {
    const fix = speller.suggest(w);
    assert.ok(!fix || !blocked.has(fix), `${w} -> ${fix}`);
  }
  const words = fs.readFileSync(dir + 'words.txt', 'utf8').split('\n');
  for (const w of blocked) assert.ok(!words.includes(w), `${w} is a correction candidate`);
});

test('missing double letters are still fixed', () => {
  assert.equal(speller.suggest('swiming'), 'swimming');
  assert.equal(speller.suggest('runing'), 'running');
});
