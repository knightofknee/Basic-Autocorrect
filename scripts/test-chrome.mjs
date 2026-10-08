// Real-extension tests in headless Chrome: loads this folder as an unpacked
// extension and types with trusted key events. Also checks that web pages
// can't detect the extension through its bundled files.
//
// Needs Chrome for Testing (branded Chrome can't load unpacked extensions
// from the command line). One-time:
//   npx @puppeteer/browsers install chrome@stable --path .dev/browsers
// Usage: node scripts/test-chrome.mjs
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/chrome.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

async function findChromeForTesting() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = ROOT + '/.dev/browsers/chrome/';
  const [version] = (await readdir(base).catch(() => [])).sort().reverse();
  if (!version) throw new Error('Chrome for Testing not found. Run: npx @puppeteer/browsers install chrome@stable --path .dev/browsers');
  const dir = base + version + '/';
  const [sub] = await readdir(dir);
  return process.platform === 'darwin'
    ? `${dir}${sub}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
    : `${dir}${sub}/chrome`;
}

// Chrome's ID for an unpacked extension: sha256 of its path, hex mapped to a-p.
const extensionId = (path) => [...createHash('sha256').update(path).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

const server = createServer(async (req, res) => {
  let body;
  try {
    body = await readFile(join(ROOT, new URL(req.url, 'http://x').pathname));
  } catch {
    return res.writeHead(404).end();
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const pageUrl = `http://127.0.0.1:${server.address().port}/test/browser/plain.html`;

const chrome = await launch({ extensionPath: ROOT, executable: await findChromeForTesting() });
const { page, evaluate, typeKeys, undo } = chrome;
await page('Emulation.setFocusEmulationEnabled', { enabled: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const id = extensionId(ROOT);

async function navigate(url) {
  await page('Page.navigate', { url });
  await sleep(800);
}

async function setSettings(patch) {
  await navigate(`chrome-extension://${id}/src/popup/popup.html?page`);
  await evaluate(`chrome.storage.local.set(${JSON.stringify(patch)}).then(() => 1)`);
  await navigate(pageUrl);
}

const results = [];
async function check(field, keys, expected, { undo: withUndo = false } = {}) {
  await evaluate(`(e => { e.focus(); if (e.isContentEditable) { e.textContent = ''; getSelection().collapse(e, 0); } else e.value = ''; })(document.getElementById('${field}'))`);
  await sleep(300); // a person takes longer than this to start typing
  await typeKeys(keys);
  if (withUndo) {
    await undo();
    await typeKeys('go');
  }
  await sleep(200);
  const got = await evaluate(`(e => (e.isContentEditable ? e.innerText : e.value).replace(/\\u00A0/g, ' '))(document.getElementById('${field}'))`);
  const name = `${field}: ${JSON.stringify(keys)}${withUndo ? ' + undo' : ''}`;
  results.push(got === expected ? `PASS ${name}` : `FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
}

let failed = 1;
try {
  await setSettings({ aggressive: false });
  for (const field of ['input', 'textarea', 'ce']) {
    await check(field, 'cant dont im teh wierd commerical. ', "can't don't I'm the weird commercial. ");
    await check(field, 'so cant ', 'so cant go', { undo: true });
  }
  await check('input', 'so teh\n', 'so the');
  await check('textarea', 'teh\nend', 'the\nend');

  await setSettings({ aggressive: true });
  await check('input', 'my keybaord porgram ', 'my keyboard program ');

  // A page must not be able to fetch the extension's files by their fixed URL.
  const probe = await evaluate(`fetch('chrome-extension://${id}/src/spell/words.txt').then(() => 'reachable', () => 'blocked')`);
  results.push(probe === 'blocked' ? 'PASS extension files are not detectable by pages' : 'FAIL extension files are reachable from pages');

  failed = results.filter((r) => r.startsWith('FAIL')).length;
} catch (e) {
  results.push('FAIL ' + (e.stack || e.message));
} finally {
  console.log(results.join('\n'));
  console.log(failed ? '\nChrome tests FAILED' : '\nAll Chrome tests passed');
  await chrome.close();
  server.close();
  process.exit(failed ? 1 : 0);
}
