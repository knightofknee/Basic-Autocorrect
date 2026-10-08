// Tiny Firefox driver over WebDriver BiDi (no dependencies). Launches a
// separate Firefox instance with its own profile and the extension installed
// as a temporary add-on, exactly as about:debugging would.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const FIREFOX = process.env.FIREFOX || {
  darwin: '/Applications/Firefox.app/Contents/MacOS/firefox',
  linux: 'firefox',
  win32: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
}[process.platform];

export async function launch({ profile, extensionPath, headless = false }) {
  await mkdir(profile, { recursive: true });
  const args = ['-no-remote', '-profile', profile, '--remote-debugging-port=0'];
  if (headless) args.push('-headless');
  const ff = spawn(FIREFOX, args);
  const wsBase = await new Promise((resolve, reject) => {
    let buf = '';
    const onData = (d) => {
      buf += d;
      const m = buf.match(/WebDriver BiDi listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    };
    ff.stderr.on('data', onData);
    ff.stdout.on('data', onData);
    ff.on('exit', () => reject(new Error('Firefox exited:\n' + buf)));
    setTimeout(() => reject(new Error('Firefox did not start:\n' + buf)), 30000);
  });

  const ws = new WebSocket(wsBase.replace(/\/$/, '') + '/session');
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
  });
  let nextId = 1;
  const waiting = new Map();
  const listeners = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.type === 'error' ? reject(new Error(`${msg.error}: ${msg.message}`)) : resolve(msg.result);
    } else if (msg.type === 'event') {
      listeners.forEach((fn) => fn(msg));
    }
  });
  const send = (method, params = {}) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
  };

  await send('session.new', { capabilities: { alwaysMatch: { webSocketUrl: true, 'moz:firefoxOptions': {} } } });
  let extension = null;
  if (extensionPath) {
    extension = await send('webExtension.install', { extensionData: { type: 'path', path: extensionPath } });
  }
  const { contexts } = await send('browsingContext.getTree', {});
  const context = contexts[0].context;

  async function evaluate(expression) {
    const r = await send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' });
    if (r.type === 'exception') throw new Error(r.exceptionDetails.text);
    return deserialize(r.result);
  }

  function deserialize(v) {
    if (!v) return v;
    switch (v.type) {
      case 'string': case 'number': case 'boolean': return v.value;
      case 'undefined': case 'null': return null;
      case 'array': return v.value.map(deserialize);
      case 'object': return Object.fromEntries(v.value.map(([k, val]) => [typeof k === 'string' ? k : deserialize(k), deserialize(val)]));
      default: return v.value ?? v.type;
    }
  }

  // Real, trusted key presses. `keys` is a string; '\n' is Enter, '\b' Backspace.
  const SPECIAL = { '\n': '\uE007', '\b': '\uE003' };
  async function typeKeys(keys, { modifier } = {}) {
    const actions = [];
    if (modifier) actions.push({ type: 'keyDown', value: modifier });
    for (const ch of keys) {
      const value = SPECIAL[ch] || ch;
      actions.push({ type: 'keyDown', value }, { type: 'keyUp', value });
    }
    if (modifier) actions.push({ type: 'keyUp', value: modifier });
    await send('input.performActions', { context, actions: [{ type: 'key', id: 'kb', actions }] });
  }
  const CMD = process.platform === 'darwin' ? '\uE03D' : '\uE009';
  const undo = () => typeKeys('z', { modifier: CMD });

  async function navigate(url) {
    await send('browsingContext.navigate', { context, url, wait: 'complete' });
  }

  async function screenshot() {
    const { data } = await send('browsingContext.captureScreenshot', { context });
    return Buffer.from(data, 'base64');
  }

  async function close() {
    try { await send('browser.close', {}); } catch (_) { /* already gone */ }
    ws.close();
    ff.kill();
  }

  return { send, evaluate, typeKeys, undo, navigate, screenshot, close, context, extension, onEvent: (fn) => listeners.push(fn) };
}
