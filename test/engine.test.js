const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/engine/data.js');
require('../src/engine/data-common.js');
const { engine } = require('../src/engine/engine.js');

// Simulate typing `text` character by character into a plain field, applying
// corrections the way the content script does. Returns the final text.
function type(text, settings = {}) {
  const corrector = engine.createCorrector(settings);
  let out = '';
  for (const ch of text) {
    out += ch;
    const r = corrector.check(out.slice(-engine.MAX_CONTEXT));
    if (r) {
      const tail = out.slice(-engine.MAX_CONTEXT);
      out = out.slice(0, out.length - tail.length + r.start) + r.insert;
    }
  }
  return out;
}

test('contractions', () => {
  assert.equal(type('dont '), "don't ");
  assert.equal(type('cant '), "can't ");
  assert.equal(type('wont '), "won't ");
  assert.equal(type('im '), "I'm ");
  assert.equal(type('ive '), "I've ");
  assert.equal(type('i '), 'I ');
  assert.equal(type("i'm "), "I'm ");
  assert.equal(type('doesnt '), "doesn't ");
  assert.equal(type("does'nt "), "doesn't ");
  assert.equal(type('youre right'), "you're right");
});

test('every common contraction', () => {
  const pairs = {
    aint: "ain't", arent: "aren't", cant: "can't", couldnt: "couldn't", couldve: "could've", didnt: "didn't",
    doesnt: "doesn't", dont: "don't", hadnt: "hadn't", hasnt: "hasn't", havent: "haven't", hed: "he'd", hes: "he's",
    heres: "here's", howd: "how'd", howre: "how're", hows: "how's", im: "I'm", ive: "I've", isnt: "isn't",
    itd: "it'd", itll: "it'll", mightve: "might've", mustnt: "mustn't", mustve: "must've", neednt: "needn't",
    shant: "shan't", shes: "she's", shouldnt: "shouldn't", shouldve: "should've", thatll: "that'll", thats: "that's",
    thered: "there'd", theres: "there's", theyd: "they'd", theyll: "they'll", theyre: "they're", theyve: "they've",
    wasnt: "wasn't", weve: "we've", werent: "weren't", whatd: "what'd", whatll: "what'll", whats: "what's",
    whered: "where'd", wheres: "where's", whod: "who'd", wholl: "who'll", whos: "who's", whove: "who've",
    whyd: "why'd", wont: "won't", wouldnt: "wouldn't", wouldve: "would've", yall: "y'all", youd: "you'd",
    youll: "you'll", youre: "you're", youve: "you've", oclock: "o'clock",
  };
  for (const [typo, fixed] of Object.entries(pairs)) assert.equal(type(typo + ' '), fixed + ' ', typo);
});

test('common misspellings list (generated) is used', () => {
  assert.equal(type('commerical '), 'commercial ');
  assert.equal(type('televsion '), 'television ');
  assert.equal(type('Eurpean '), 'European ');
});

test('ambiguous words are left alone', () => {
  for (const w of ['its', 'ill', 'id', 'were', 'well', 'shell', 'lets', 'wed', 'hell', 'shed', 'form', 'may', 'march']) {
    assert.equal(type(w + ' '), w + ' ', w);
  }
});

test('common misspellings', () => {
  assert.equal(type('teh '), 'the ');
  assert.equal(type('recieve '), 'receive ');
  assert.equal(type('definately '), 'definitely ');
  assert.equal(type('seperate '), 'separate ');
  assert.equal(type('alot '), 'a lot ');
  assert.equal(type('i think teh cat is wierd.'), 'I think the cat is weird.');
});

test('only corrects when the word is finished', () => {
  assert.equal(type('dont'), 'dont');
  assert.equal(type('tehran '), 'tehran ');
});

test('capitalization is preserved', () => {
  assert.equal(type('Dont '), "Don't ");
  assert.equal(type('DONT '), "DON'T ");
  assert.equal(type('Teh '), 'The ');
  assert.equal(type('TEH '), 'THE ');
  assert.equal(type('Alot '), 'A lot ');
  assert.equal(type('Im '), "I'm ");
  assert.equal(type('monday '), 'Monday ');
  assert.equal(type('febuary '), 'February ');
});

test('odd casing is treated as deliberate', () => {
  assert.equal(type('tEh '), 'tEh ');
  assert.equal(type('dONT '), 'dONT ');
  assert.equal(type('IM '), 'IM '); // instant message, not "I'M"
});

test('punctuation finishes a word and is kept', () => {
  assert.equal(type('dont.'), "don't.");
  assert.equal(type('dont,'), "don't,");
  assert.equal(type('dont!'), "don't!");
  assert.equal(type('dont?'), "don't?");
  assert.equal(type('dont;'), "don't;");
  assert.equal(type('dont:'), "don't:");
  assert.equal(type('(dont)'), "(don't)");
  assert.equal(type('"teh"'), '"the"');
  assert.equal(type("'teh "), "'the ");
  assert.equal(type('teh\n'), 'the\n');
  assert.equal(type('teh\u00A0'), 'the\u00A0');
});

test('URLs, emails, paths and abbreviations are left alone', () => {
  assert.equal(type('www.teh.com '), 'www.teh.com ');
  assert.equal(type('foo.dont '), 'foo.dont ');
  assert.equal(type('me@teh.org '), 'me@teh.org ');
  assert.equal(type('/home/teh '), '/home/teh ');
  assert.equal(type('i.e. '), 'i.e. ');
  assert.equal(type('teh_var '), 'teh_var ');
  assert.equal(type('teh2 '), 'teh2 ');
});

test('curly apostrophes', () => {
  assert.equal(type('dont ', { apostrophe: 'curly' }), 'don\u2019t ');
  assert.equal(type('i\u2019m '), 'I\u2019m ');
  assert.equal(type('does\u2019nt '), 'doesn\u2019t ');
});

test('custom corrections', () => {
  const custom = { brianemail: 'brian@example.com', adress: 'address', omw: 'on my way', teh: 'tea' };
  assert.equal(type('brianemail ', { custom }), 'brian@example.com ');
  assert.equal(type('Brianemail ', { custom }), 'brian@example.com '); // exact, not re-cased
  assert.equal(type('Adress ', { custom }), 'Address ');
  assert.equal(type('omw.', { custom }), 'on my way.');
  assert.equal(type('teh ', { custom }), 'tea '); // overrides built-in
  assert.equal(type('x@ ', { custom: { 'x@': 'hi' } }), 'hi ');
});

test('invalid custom keys are ignored', () => {
  assert.equal(engine.isValidCustomKey('a b'), false);
  assert.equal(engine.isValidCustomKey('a.b'), false);
  assert.equal(engine.isValidCustomKey(''), false);
  assert.equal(engine.isValidCustomKey('sig1'), true);
  assert.equal(type('a.b ', { custom: { 'a.b': 'x' } }), 'a.b ');
});

test('allowed words are never corrected', () => {
  assert.equal(type('teh ', { allowed: ['teh'] }), 'teh ');
  assert.equal(type('Teh ', { allowed: ['teh'] }), 'Teh ');
  assert.equal(type('dont ', { allowed: ['dont'] }), 'dont ');
  assert.equal(type('omw ', { custom: { omw: 'on my way' }, allowed: ['omw'] }), 'omw ');
});

test('built-in list can be turned off', () => {
  assert.equal(type('dont ', { builtins: false }), 'dont ');
  assert.equal(type('omw ', { builtins: false, custom: { omw: 'on my way' } }), 'on my way ');
});

test('check() reports what to replace', () => {
  const c = engine.createCorrector();
  assert.deepEqual(c.check('so dont '), { start: 3, from: 'dont', to: "don't", insert: "don't " });
  assert.equal(c.check('so dont'), null);
  assert.equal(c.check(''), null);
});

test('aggressive mode uses the speller for unknown words only', () => {
  const NS = globalThis.BasicAutocorrect;
  const saved = NS.spell;
  NS.spell = { speller: { suggest: (w) => ({ blarg: 'blurb', snorf: 'snort' })[w] || null } };
  try {
    assert.equal(type('blarg '), 'blarg '); // basic mode: untouched
    assert.equal(type('my blarg ', { aggressive: true }), 'my blurb ');
    assert.equal(type('Blarg ', { aggressive: true }), 'Blurb '); // sentence start: re-cased
    assert.equal(type('at Snorf ', { aggressive: true }), 'at Snorf '); // mid-sentence capital: a name?
    assert.equal(type('end. Snorf ', { aggressive: true }), 'end. Snort ');
    assert.equal(type('BLARG ', { aggressive: true }), 'BLARG '); // all caps: acronym?
    assert.equal(type('blarg ', { aggressive: true, allowed: ['blarg'] }), 'blarg ');
    assert.equal(type('dont ', { aggressive: true }), "don't "); // lists still first
  } finally {
    NS.spell = saved;
  }
});
