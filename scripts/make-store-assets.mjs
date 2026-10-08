// Renders the store graphics in store/ from the HTML templates in store/src/:
//   screenshot-1-typing.png, screenshot-2-popup.png, screenshot-3-privacy.png (1280x800)
//   promo-small.png (440x280)
// The popup screenshot uses the real popup with sample settings.
// Usage: node scripts/make-store-assets.mjs
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/chrome.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  let body;
  try {
    body = await readFile(join(ROOT, path));
  } catch {
    return res.writeHead(404).end();
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { page, evaluate, close } = await launch();
async function shoot(url, width, height, scale, out, { fit = false } = {}) {
  await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  await page('Page.navigate', { url });
  await sleep(1000);
  if (fit) height = Math.ceil(await evaluate('document.body.getBoundingClientRect().bottom + 10'));
  const { data } = await page('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
  await writeFile(ROOT + out, Buffer.from(data, 'base64'));
  console.log(out);
}

try {
  await page('Page.enable');
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  // The real popup, with sample settings, via the test storage shim.
  const shim = await readFile(ROOT + 'test/browser/shim.js', 'utf8');
  const seed = `chrome.storage.local.set(${JSON.stringify({
    custom: { myemail: 'me@example.com', adress: 'address', omw: 'on my way!' },
    allowed: ['gonna', 'kinda'],
    recent: [{ from: 'cant', to: "can't", at: 2 }, { from: 'teh', to: 'the', at: 1 }],
  })});`;
  const { identifier } = await page('Page.addScriptToEvaluateOnNewDocument', { source: shim + '\n' + seed });
  await shoot(`${base}/src/popup/popup.html`, 340, 640, 2, 'store/popup-capture.png', { fit: true });
  await page('Page.removeScriptToEvaluateOnNewDocument', { identifier });

  await shoot(`${base}/store/src/typing.html`, 1280, 800, 1, 'store/screenshot-1-typing.png');
  await shoot(`${base}/store/src/popup.html`, 1280, 800, 1, 'store/screenshot-2-popup.png');
  await shoot(`${base}/store/src/privacy.html`, 1280, 800, 1, 'store/screenshot-3-privacy.png');
  await shoot(`${base}/store/src/promo-small.html`, 440, 280, 1, 'store/promo-small.png');
} finally {
  await close();
  server.close();
}
