// Tiny headless-Chrome driver over the DevTools protocol (no dependencies;
// uses Node's built-in WebSocket). Used by the browser tests and icon builder.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: 'google-chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
}[process.platform];

// extensionPath: load an unpacked extension. Branded Chrome no longer allows
// this from the command line, so it needs Chrome for Testing (see
// scripts/test-chrome.mjs), passed as `executable`.
export async function launch({ extensionPath, executable } = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'ba-chrome-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check'];
  if (extensionPath) args.push(`--load-extension=${extensionPath}`, `--disable-extensions-except=${extensionPath}`);
  const chrome = spawn(executable || CHROME, [...args, 'about:blank']);
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    chrome.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    chrome.on('exit', () => reject(new Error('Chrome exited:\n' + buf)));
    setTimeout(() => reject(new Error(`Chrome did not start (${CHROME}); set CHROME=/path/to/chrome`)), 15000);
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 1;
  const waiting = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  const send = (method, params = {}, sessionId) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
  };

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);

  async function evaluate(expression) {
    const { result, exceptionDetails } = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  }

  // Real key events. `split` delivers keydown and the character as separate
  // events, the way Chrome does for physical keyboards. '\n' is Enter.
  const KEYS = { ' ': 'Space', '\n': 'Enter' };
  async function press(ch, { split = false } = {}) {
    const key = ch === '\n' ? 'Enter' : ch;
    const code = KEYS[ch] || (/[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : '');
    const text = ch === '\n' ? '\r' : ch;
    const PUNCT = { '.': 190, ',': 188, ';': 186, "'": 222, '/': 191, '-': 189 };
    const keyCode = ch === '\n' ? 13 : /[a-z0-9 ]/i.test(ch) ? ch.toUpperCase().charCodeAt(0) : PUNCT[ch] || 0;
    if (split) {
      await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode });
      await page('Input.dispatchKeyEvent', { type: 'char', key, code, text, unmodifiedText: text });
    } else {
      await page('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text, unmodifiedText: text, windowsVirtualKeyCode: keyCode });
    }
    await page('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
  }
  async function typeKeys(text, opts) {
    for (const ch of text) await press(ch, opts);
    await new Promise((r) => setTimeout(r, 50));
  }
  async function undo() {
    const modifiers = process.platform === 'darwin' ? 4 : 2;
    await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers, commands: ['undo'] });
    await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers });
    await new Promise((r) => setTimeout(r, 50));
  }

  async function close() {
    ws.close();
    chrome.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  return { page, evaluate, close, typeKeys, undo };
}
