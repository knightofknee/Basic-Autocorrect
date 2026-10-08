// Development Firefox: launches a separate Firefox window with its own
// persistent profile (.dev/firefox-profile, so sign-ins are kept) and the
// extension loaded from this folder. Also exposes a tiny control API on
// 127.0.0.1 so tests can drive it:
//   POST /eval     body: JS expression        -> JSON result
//   POST /keys     body: text to type ('\n' Enter, '\b' Backspace)
//   POST /undo
//   POST /cmd      body: keys to press with Cmd (macOS) / Ctrl
//   POST /doc-text                            -> saved text of the open Google Doc
//   POST /reload-extension
//   POST /navigate body: URL
//   POST /logs     body: optional filter       -> console messages since last call
//   GET  /screenshot                          -> PNG
//
// Usage: node scripts/dev-firefox.mjs [port]
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/firefox.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2] || 8930);
let ff = await launch({ profile: ROOT + '.dev/firefox-profile', extensionPath: ROOT });
console.log(`Firefox running with Basic Autocorrect. Control API on http://127.0.0.1:${PORT}`);
// Console messages (including the extension's content scripts), for /logs.
const logs = [];
await ff.send('session.subscribe', { events: ['log.entryAdded'] });
ff.onEvent((msg) => {
  if (msg.method === 'log.entryAdded') logs.push(msg.params.text);
  if (logs.length > 500) logs.shift();
});

const read = (req) => new Promise((r) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => r(body));
});

createServer(async (req, res) => {
  try {
    const body = await read(req);
    const path = new URL(req.url, 'http://x').pathname;
    let out = null;
    if (path === '/eval') out = await ff.evaluate(body);
    else if (path === '/keys') await ff.typeKeys(body);
    else if (path === '/undo') await ff.undo();
    else if (path === '/cmd') await ff.typeKeys(body, { modifier: process.platform === 'darwin' ? '\uE03D' : '\uE009' });
    else if (path === '/doc-text') {
      // Google Docs only: the document's saved text, via Docs' own export.
      out = await ff.evaluate(`fetch(location.pathname.replace(/\\/edit.*$/, '/export?format=txt'), { cache: 'no-store' }).then((r) => r.text())`);
    }
    else if (path === '/navigate') await ff.navigate(body);
    else if (path === '/logs') out = logs.splice(0).filter((l) => !body || l.includes(body));
    else if (path === '/raise') {
      await ff.send('browsingContext.activate', { context: ff.context });
      const { clientWindows } = await ff.send('browser.getClientWindows', {});
      for (const w of clientWindows) await ff.send('browser.setClientWindowState', { clientWindow: w.clientWindow, state: 'maximized' }).catch(() => {});
    }
    else if (path === '/reload-extension') {
      await ff.send('webExtension.uninstall', { extension: ff.extension.extension });
      ff.extension = await ff.send('webExtension.install', { extensionData: { type: 'path', path: ROOT } });
    } else if (path === '/screenshot') {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(await ff.screenshot());
    } else return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e.stack || e));
  }
}).listen(PORT, '127.0.0.1');
