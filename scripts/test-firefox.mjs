// Real-extension tests in headless Firefox: installs this folder as a
// temporary add-on (like about:debugging) and types with trusted key events.
// Usage: node scripts/test-firefox.mjs
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/firefox.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
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
const profile = await mkdtemp(join(tmpdir(), 'ba-firefox-'));
const ff = await launch({ profile, extensionPath: ROOT, headless: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
async function check(id, keys, expected, { undo = false } = {}) {
  await ff.evaluate(`(e => { e.focus(); if (e.isContentEditable) { e.textContent = ''; getSelection().collapse(e, 0); } else e.value = ''; })(document.getElementById('${id}'))`);
  await sleep(300); // a person takes longer than this to start typing
  await ff.typeKeys(keys);
  if (undo) {
    await sleep(100);
    await ff.undo();
    await ff.typeKeys('go');
  }
  await sleep(200);
  const got = await ff.evaluate(`(e => (e.isContentEditable ? e.textContent : e.value).replace(/\\u00A0/g, ' '))(document.getElementById('${id}'))`);
  const name = `${id}: ${JSON.stringify(keys)}${undo ? ' + undo' : ''}`;
  results.push(got === expected ? `PASS ${name}` : `FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
}

let failed = 1;
try {
  await ff.navigate(`http://127.0.0.1:${server.address().port}/test/browser/plain.html`);
  await sleep(1000);
  for (const id of ['input', 'textarea', 'ce']) {
    await check(id, 'cant dont im teh wierd commerical. ', "can't don't I'm the weird commercial. ");
    await check(id, 'so cant ', 'so cant go', { undo: true });
  }
  await check('input', 'so teh\n', 'so the');
  await check('textarea', 'teh\nend', 'the\nend');
  await check('ce', 'wont\nend', "won'tend"); // textContent drops the paragraph break
  failed = results.filter((r) => r.startsWith('FAIL')).length;
} catch (e) {
  results.push('FAIL ' + (e.stack || e.message));
} finally {
  console.log(results.join('\n'));
  console.log(failed ? '\nFirefox tests FAILED' : '\nAll Firefox tests passed');
  await ff.close();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(failed ? 1 : 0);
}
