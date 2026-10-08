// Browser tests: loads test/browser/index.html in headless Chrome (driven over
// the DevTools protocol, no dependencies), runs the in-page suite, then types
// with real, trusted key events — including Cmd/Ctrl-Z — to check the whole
// pipeline the way a person would use it.
//
// Usage: node scripts/test-browser.mjs   (set CHROME=/path/to/chrome if needed)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/chrome.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

// ---- static server --------------------------------------------------------------
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const pageUrl = `http://127.0.0.1:${server.address().port}/test/browser/index.html`;

// ---- Chrome ------------------------------------------------------------------------
const { page, evaluate, close, typeKeys, undo } = await launch();
await page('Emulation.setFocusEmulationEnabled', { enabled: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function load() {
  await page('Page.navigate', { url: pageUrl });
  for (let i = 0; i < 100 && !(await evaluate('!!window.testPageReady').catch(() => false)); i++) await sleep(50);
}

const typeText = (text, opts) => typeKeys(text, opts);
const read = (id) => evaluate(`(() => { const el = document.getElementById('${id}');
  return (el.isContentEditable ? el.innerText : el.value).replace(/\\u00A0/g, ' '); })()`);
const focus = (id) => evaluate(`(() => { const el = document.getElementById('${id}');
  if (el.isContentEditable) el.innerHTML = ''; else el.value = ''; el.focus(); })()`);

// ---- tests -----------------------------------------------------------------------
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(`PASS ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message}`);
  }
}
const eq = (a, b) => {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};

let exitCode = 1;
try {
  await load();
  const suite = await evaluate('window.runTests()');
  for (const f of suite.failed) results.push(`FAIL [page] ${f.name}: ${f.msg}`);
  results.push(`PASS [page] ${suite.passed} in-page tests`);

  for (const id of ['input', 'textarea', 'ce']) {
    for (const split of [false, true]) {
      const how = split ? ' (split key events)' : '';
      await check(`real keys ${id}${how}: typing`, async () => {
        await focus(id);
        await typeText('dont worry im sure teh cat isnt wierd ', { split });
        eq((await read(id)).trimEnd(), "don't worry I'm sure the cat isn't weird");
      });
    }
    await check(`real keys ${id}: Cmd/Ctrl-Z undoes only the correction`, async () => {
      await focus(id);
      await typeText('so dont ');
      eq(await read(id), "so don't ");
      await undo();
      eq(await read(id), 'so dont ');
      await typeText('go');
      eq(await read(id), 'so dont go');
    });
  }

  await check('real keys textarea: Enter finishes a word', async () => {
    await focus('textarea');
    await typeText('teh\nend');
    eq(await read('textarea'), 'the\nend');
  });

  await check('real keys input: Enter finishes a word', async () => {
    await focus('input');
    await typeText('so teh\n');
    eq(await read('input'), 'so the');
  });

  await check('real keys contenteditable: Enter finishes a word', async () => {
    await focus('ce');
    await typeText('wont\nteh\nend');
    eq((await read('ce')).replace(/\n+/g, '|'), "won't|the|end");
  });

  exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0;
} catch (e) {
  results.push('ERROR ' + e.stack);
} finally {
  console.log(results.join('\n'));
  console.log(exitCode ? '\nBrowser tests FAILED' : '\nAll browser tests passed');
  await close();
  server.close();
  process.exit(exitCode);
}
