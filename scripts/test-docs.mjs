// End-to-end Google Docs tests in real Firefox with the real extension.
// Types with trusted key events and checks the document's actual text via
// Docs' own plain-text export.
//
// One-time setup (Google blocks sign-in in automated browsers):
//   1. Sign in once in the dev profile, without automation:
//        /Applications/Firefox.app/Contents/MacOS/firefox -no-remote -profile .dev/firefox-profile
//      then quit that window.
//   2. Put the URL of a scratch doc you own in .dev/docs-test-url
//      (its contents get overwritten by every run).
// Then: node scripts/test-docs.mjs
import { readFile, writeFile, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/firefox.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROFILE = ROOT + '.dev/firefox-profile';
const docUrl = (await readFile(ROOT + '.dev/docs-test-url', 'utf8')).trim();
const docId = docUrl.match(/\/document\/d\/([^/]+)/)[1];
const CMD = process.platform === 'darwin' ? '\uE03D' : '\uE009';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeout = (promise, ms, what) => Promise.race([promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), ms))]);

// Test build: the extension plus one test-only script that lets this test set
// settings from the page. It is never part of the shipped extension.
const BUILD = ROOT + '.dev/test-build/';
await rm(BUILD, { recursive: true, force: true });
for (const f of ['manifest.json', 'src', 'icons']) await cp(ROOT + f, BUILD + f, { recursive: true });
const manifest = JSON.parse(await readFile(BUILD + 'manifest.json', 'utf8'));
manifest.content_scripts.push({ matches: ['https://docs.google.com/*'], js: ['test-hook.js'] });
await writeFile(BUILD + 'manifest.json', JSON.stringify(manifest));
await writeFile(BUILD + 'test-hook.js', `window.addEventListener('message', async (e) => {
  if (e.source !== window || !e.data || !e.data.__baTestSettings) return;
  await browser.storage.local.set(e.data.__baTestSettings);
  const stored = await browser.storage.local.get(null);
  window.postMessage({ __baTestDone: JSON.stringify(stored) }, '*');
});`);
const ff = await launch({ profile: PROFILE, extensionPath: BUILD });
await sleep(2000); // let Firefox register the add-on's content scripts
const DEFAULTS = { enabled: true, custom: {}, allowed: [], disabledSites: [], builtins: true, aggressive: false, apostrophe: 'straight', recent: [] };

async function setSettings(patch) {
  // Content scripts register a moment after install, and the hook loads at
  // document_idle: reload and ask again until it answers.
  const ask = `new Promise((resolve) => {
    const send = () => postMessage({ __baTestSettings: ${JSON.stringify({ ...DEFAULTS, ...patch })} }, '*');
    const timer = setInterval(send, 500);
    addEventListener('message', (e) => e.data && e.data.__baTestDone && (clearInterval(timer), resolve(e.data.__baTestDone)));
    send();
  })`;
  for (let attempt = 1; ; attempt++) {
    await ff.navigate(docUrl);
    try {
      const stored = JSON.parse(await timeout(ff.evaluate(ask), 10000, 'setting extension settings'));
      for (const [k, v] of Object.entries(patch)) {
        if (JSON.stringify(stored[k]) !== JSON.stringify(v)) throw new Error(`setting ${k} did not stick: ${JSON.stringify(stored[k])}`);
      }
      break;
    } catch (e) {
      if (attempt === 3) {
        const where = await ff.evaluate('location.hostname + " / " + document.title').catch(() => '?');
        throw new Error(`${e.message} (page: ${where})`);
      }
    }
  }
  await ff.navigate(docUrl);
  for (let i = 0; i < 100; i++) {
    if (await ff.evaluate('!!document.querySelector("iframe.docs-texteventtarget-iframe")').catch(() => false)) break;
    await sleep(100);
  }
  await sleep(1500); // let Docs and the content script settle
}

async function clearDoc() {
  await ff.typeKeys('a', { modifier: CMD });
  await ff.typeKeys('\b');
  await sleep(300);
}

const norm = (s) => s.replace(/^\uFEFF/, '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
  .replace(/\r/g, '').trimEnd();
// Docs capitalizes sentence starts by itself (after . ! ? too), so compare
// case-insensitively unless a check is about capitalization.
let exactCase = false;
const same = (a, b) => (exactCase ? a.slice(0, 1).toLowerCase() + a.slice(1) === b.slice(0, 1).toLowerCase() + b.slice(1)
  : a.toLowerCase() === b.toLowerCase());

// Docs saves a few seconds after typing; fetch sparingly (Google rate-limits).
async function docText(expected) {
  let text = '';
  await sleep(2500);
  for (let i = 0; i < 5; i++) {
    const raw = await timeout(ff.evaluate(`fetch('/document/d/${docId}/export?format=txt', { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : 'HTTP ' + r.status))`), 20000, 'reading the doc');
    if (raw.startsWith('HTTP 429') || raw.includes('<title>Too Many Requests')) {
      await sleep(15000);
      continue;
    }
    text = norm(raw);
    if (same(text, expected)) break;
    await sleep(3000);
  }
  return text;
}

const results = [];
async function check(name, steps, expected, opts = {}) {
  exactCase = !!opts.exactCase;
  try {
    await clearDoc();
    for (const step of steps) {
      if (step === 'UNDO') await ff.undo();
      else if (step === 'HOME') await ff.typeKeys('\uE011');
      else await ff.typeKeys(step);
      await sleep(150);
    }
    const text = await docText(expected);
    results.push(same(text, expected) ? `PASS ${name}` : `FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(text.slice(0, 200))}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message}`);
  }
  console.log(results[results.length - 1]);
}

try {
  await setSettings({});
  await check('contractions and typos', ['cant wont dont im teh wierd commerical, i think so. '],
    "can't won't don't I'm the weird commercial, I think so.");
  await check('punctuation', ['so (teh) cant! dont? ok. '], "so (the) can't! don't? ok.");
  await check('capitalization', ['Cant DONT Teh '], "Can't DON'T The", { exactCase: true });
  await check('first word after select-all + delete', ['cant go '], "can't go");
  // Each undo check uses its own word: an undone word isn't corrected again in that document.
  await check('one Cmd-Z restores the typed word', ['so cant ', 'UNDO', 'go'], 'so cant go');
  await check('one Cmd-Z restores a word Docs would fix too', ['so dont ', 'UNDO', 'go'], 'so dont go');
  await check('undone word stays as typed', ['so wont ', 'UNDO', 'wont '], 'so wont wont');
  await check('undo after punctuation', ['ok teh,', 'UNDO', ' go'], 'ok teh, go');
  await setSettings({}); // fresh page: words undone above stay uncorrected for the rest of a session
  await check('Home is a word start', ['world', 'HOME', 'teh '], 'the world');
  await check('Enter finishes a word', ['dont\nteh\nok '], "don't\nthe\nok");
  await check('one Cmd-Z after Enter restores the word', ['so youre\n', 'UNDO', 'go'], 'so youre\ngo');
  await check('basic mode leaves unknown typos', ['my keybaord '], 'my keybaord');

  await setSettings({ aggressive: true });
  await check('aggressive fixes other typos', ['my keybaord porgram langauge '], 'my keyboard program language');
  await check('aggressive leaves real words and names', ['the quixotic Brian googled '], 'the quixotic Brian googled');

  await setSettings({ custom: { brianemail: 'brian@example.com' }, allowed: ['teh'] });
  await check('custom correction', ['mail brianemail now '], 'mail brian@example.com now');
  await check('never-correct word', ['teh end '], 'teh end');
} catch (e) {
  results.push(`FAIL setup: ${e.stack || e.message}`);
  console.log(results[results.length - 1]);
} finally {
  await setSettings({}).catch(() => {});
  await clearDoc().catch(() => {});
  const failed = results.filter((r) => r.startsWith('FAIL')).length || (results.length ? 0 : 1);
  console.log(failed ? `\n${failed} Docs test(s) FAILED` : '\nAll Docs tests passed');
  await ff.close();
  process.exit(failed ? 1 : 0);
}
