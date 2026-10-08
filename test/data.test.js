// Guards the built-in list against entries that are real words, the main way
// autocorrect goes wrong. Uses the system word list when available.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { builtinCorrections, builtinGroups, parseCorrections } = require('../src/engine/data.js');

const WORDS_FILE = '/usr/share/dict/words';

// Typos that appear in the (very permissive) system word list as archaic or
// obscure words, but that people essentially always mean as the correction.
const KNOWN_OK = new Set([
  'accidently', 'aswell', 'belive', 'calander', 'frist', 'incase', 'orignal', 'tecnology', 'tath', 'untill',
]);

test('no built-in misspelling is a real word', { skip: !fs.existsSync(WORDS_FILE) && 'no system word list' }, () => {
  const words = new Set(fs.readFileSync(WORDS_FILE, 'utf8').split('\n').map((w) => w.trim().toLowerCase()));
  const realWords = Object.keys(parseCorrections(builtinGroups.misspellings)).filter(
    (typo) => words.has(typo) && !KNOWN_OK.has(typo)
  );
  assert.deepEqual(realWords, [], 'These typos are real words; remove them or add to KNOWN_OK: ' + realWords.join(', '));
});

test('corrections are not themselves typos', () => {
  for (const [typo, correction] of Object.entries(builtinCorrections)) {
    for (const part of correction.toLowerCase().split(' ')) {
      if (part !== typo) assert.ok(!(part in builtinCorrections) || builtinCorrections[part].toLowerCase() === part,
        `"${typo}" -> "${correction}" but "${part}" is itself corrected`);
    }
  }
});
