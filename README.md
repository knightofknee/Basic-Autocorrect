# Basic Autocorrect

**Autocorrect for your browser.**
Free. Open source. Works locally. Your keystrokes never leave your browser.

Type `dont` and press Space, and it becomes `don't `. Phone-style autocorrect for obvious typos, with no popups, no suggestions to accept, and no AI.

- `dont` → `don't`, `cant` → `can't`, `im` → `I'm`, `ive` → `I've`, `i` → `I`
- `teh` → `the`, `recieve` → `receive`, `definately` → `definitely`, `alot` → `a lot`
- **Basic** (default): every common contraction plus about 4,300 high-confidence misspellings. Ambiguous words (`its`, `ill`, `were`, `well`, `wed`, …) are never touched.
- **Aggressive** (opt-in): also fixes misspellings that aren't on any list (`keybaord` → `keyboard`, `porgram` → `program`), using a 340k-word dictionary. It only corrects when one intended word clearly wins, and leaves names, slang and unknown-but-real words alone.
- Your own corrections (`myemail` → `me@example.com`) and a "never correct" list.
- Capitalization carries over (`Dont` → `Don't`, `DONT` → `DON'T`). Unusual casing like `tEh` or `iPhone` is left alone.
- Cmd/Ctrl-Z right after a correction restores what you typed, and that word won't be corrected again in that field.

## Install locally

**Firefox** (140+)
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…** and pick `manifest.json` in this folder.
3. Reload any Google Docs tabs that were already open.
4. If it doesn't correct anything, open the Extensions menu (puzzle icon) → Basic Autocorrect → allow it on all sites. Firefox can ask for site access separately for Manifest V3 add-ons.

Temporary add-ons are removed when Firefox restarts. To keep it installed, sign it through addons.mozilla.org. Self-distributed ("unlisted") signing is fine; see [Publishing](#publishing).

**Chrome / Edge / Brave**
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.

Then type `dont ` in any text field.

## Where it works

| Editor | Status |
|---|---|
| `<input>` (text, search) and `<textarea>` | ✅ Tested in Firefox and Chrome (automated, real key events, undo) |
| `contenteditable` editors | ✅ Tested on plain contenteditable in Firefox and Chrome (automated, real keys, undo) |
| Google Docs | ✅ Tested in Firefox (automated end-to-end, real keys, 16 checks). The approach was also verified by hand in Chrome. |
| Gmail, Slack, Notion, Reddit, other rich editors | Not yet verified. Most are contenteditable and should work, but some editors handle input their own way. |
| Password, email, URL, number fields; code editors (CodeMirror, Monaco, Ace) | Never corrected, on purpose |

**Google Docs.** This is the main target: the extension fills in what Docs' own autocorrect leaves out. Docs fixes some typos itself (`dont`), but it skips real-word contractions like `cant` and `wont`, most misspellings (`teh`), your own text shortcuts, and anything like aggressive correction.

- Docs draws text on a canvas, so the extension can't read the document. It remembers what you've typed since the caret last moved and corrects the word you just finished.
- After Home, Cmd/Ctrl+← or a click, the next word is corrected normally. After other arrow keys, a selection, paste or dictation, the extension waits for the next space before correcting again, so it never touches text it hasn't seen.
- **One** Cmd/Ctrl-Z right after a correction restores exactly what you typed, even for words Docs' own autocorrect would change again. That word then isn't corrected again in that document until you reload it.
- Docs then applies its own smart quotes and sentence capitals, so `cant` becomes "can’t".

## Privacy

This is the main promise, so the code is built to make it checkable:

- **No network access.** There's no XHR, WebSocket or beacon code. The only `fetch` loads aggressive mode's dictionary from inside the extension package. No network-related permissions are requested.
- **One permission:** `storage`, used for your settings, kept in `storage.local` on this device. Nothing is synced.
- **Typed text isn't stored.** The content script reads at most the 64 characters before the caret, checks the last word, and forgets it. The only typed data saved is the "recent corrections" list in the popup: the last 10 dictionary words that were corrected (e.g. `dont → don't`), so you can mark one "never correct". Surrounding text is never saved.
- **No remote code, no analytics, no accounts.** Everything ships in the package.
- Firefox's manifest declares `data_collection_permissions: none`.

The extension needs access to all sites only so its content script can run where you type.

## Settings

The toolbar popup has: on/off, Basic / Aggressive, turn off for the current site, my corrections (click one to edit, × to delete), never-correct words, and recent corrections with a one-click "Never correct". Under **More settings**: turn off the built-in list, curly apostrophes (`don’t`), and export/import of your lists as JSON.

## Development

No dependencies, no build step. The folder is the extension.

```
src/engine/data.js       hand-curated corrections (easy to edit; see format at top)
src/engine/data-common.js  generated common-misspellings list (scripts/build-data.mjs)
src/engine/engine.js     pure correction logic: word boundaries, casing, lookups
src/spell/               aggressive mode: speller + generated word data
src/content/fields.js    input/textarea/contenteditable adapters
src/content/gdocs.js     Google Docs adapter
src/content/content.js   wiring: key events -> engine -> adapter, undo tracking
src/shared/settings.js   storage
src/popup/               popup + settings page
```

```bash
npm test
```

```bash
npm run test:browser
```

`npm test` runs the engine, speller and word-list tests (Node 20+). `npm run test:browser` drives headless Chrome with real key events, including Cmd/Ctrl-Z.

`npm run test:chrome` loads the real extension in Chrome for Testing (one-time download: `npx @puppeteer/browsers install chrome@stable --path .dev/browsers`). It types into fields, checks aggressive mode, and checks that pages can't detect the extension.

`npm run test:firefox` installs the real extension in headless Firefox and types into inputs, textareas and contenteditable.

`npm run test:docs` runs the end-to-end Google Docs suite in real Firefox, using the real extension and real keys, and checks the document's saved text. It needs a one-time setup described at the top of `scripts/test-docs.mjs`: sign in to a dev Firefox profile, and point it at a scratch doc.

`node scripts/build-data.mjs` regenerates the word data from its public sources (see NOTICE.md).

The word-list test checks every built-in typo against the system dictionary (`/usr/share/dict/words`) so a real word can't slip in as a "typo".

**Adding corrections:** add a line to `src/engine/data.js` in the form `correction: typo typo`, then run `npm test`. Only add a typo that is never a real word and has a single obvious meaning.

### How it works

When you type a space, punctuation or Enter, the extension checks the word you just finished. If it's in the list, it replaces the word through the editor's normal editing path (`execCommand('insertText')`), so the change goes onto the browser's undo stack. The correction runs right *after* your keystroke lands, so the first Cmd-Z undoes only the correction. Google Docs ignores those APIs, so there the extension sends Docs the same key events you would type: Backspaces, then the corrected word.

## Publishing

```bash
npm run package
```

This builds `dist/basic-autocorrect-<version>.zip` (the same zip goes to addons.mozilla.org and the Chrome Web Store) and a source zip for Mozilla's reviewers. Step-by-step store instructions: [PUBLISHING.md](PUBLISHING.md).

## License

Code: MIT. Bundled word data: see [NOTICE.md](NOTICE.md) (SCOWL; Wikipedia and FrequencyWords under CC BY-SA 4.0).
