/*
 * Content script: watches for word-finishing keystrokes in text fields and
 * applies corrections. Runs entirely in the page's tab; there is no network
 * code anywhere in this extension.
 *
 * Flow: a boundary key (space, punctuation, Enter in a textarea) is about to be
 * typed -> snapshot the text before the caret -> let the page handle the key
 * normally -> on the next tick, confirm the key really landed after that text
 * -> ask the engine -> replace the word through the editor's own input path.
 * Correcting *after* the key lands means Cmd/Ctrl-Z first undoes just the
 * correction, like on a phone.
 */
(function (root) {
  const NS = root.BasicAutocorrect;
  const { engine, fields, settings } = NS;

  const state = {
    settings: null,
    corrector: null,
    pending: null,        // a boundary key waiting for the page to process it
    applying: false,      // true while we're inserting our own correction
    last: null,           // the most recent correction, for undo detection
    undoing: null,        // field whose correction is being undone
    rejected: new WeakMap(), // field element -> Set of words the user undid there
  };

  function siteHost() {
    try {
      return window.top.location.hostname;
    } catch (_) {
      return window.location.hostname;
    }
  }

  function isActive() {
    const s = state.settings;
    return !!s && s.enabled && !s.disabledSites.includes(siteHost());
  }

  function applySettings(next) {
    state.settings = next;
    state.corrector = engine.createCorrector(next);
    if (next.aggressive && isEditable(document.activeElement)) wantSpeller();
  }

  // Aggressive mode's dictionary (~750 KB) is loaded only in frames where the
  // user actually types, and only while the mode is on.
  function wantSpeller() {
    if (state.settings && state.settings.aggressive && !NS.spell.speller) {
      NS.spell.load((path) => settings.api.runtime.getURL(path)).catch(() => {});
    }
  }

  function isEditable(el) {
    return !!el && (el.tagName === 'IFRAME' ? NS.gdocs.isDocsPage() : !!fields.adapterFor(el));
  }

  // ---- correction pipeline ----------------------------------------------------

  const norm = (s) => s.replace(/\u00A0/g, ' ');

  const MAX_TRIES = 6;

  // source: 'key' (keydown) or 'input' (beforeinput). One keystroke usually
  // produces both; the second is ignored.
  function begin(target, ch, source) {
    if (state.applying || !isActive()) return;
    const p = state.pending;
    if (p) {
      if (source === 'input' && !p.sawInput) {
        p.sawInput = true; // same keystroke as the keydown we already saw
        return;
      }
      finish(false); // a new key arrived: settle the previous one first
    }
    const field = fields.adapterFor(target);
    if (!field) return;
    const before = field.textBefore();
    if (before === null) return;
    state.pending = {
      field,
      sawInput: source === 'input',
      before: norm(before).slice(-engine.MAX_CONTEXT),
      expected: norm(before + ch).slice(-engine.MAX_CONTEXT),
      tries: 0,
      timer: setTimeout(finish, 0),
    };
  }

  // Runs once the page has had a chance to insert the key. Browsers may deliver
  // a keystroke's keydown and its text insertion as separate tasks, so if the
  // text hasn't changed yet, check again shortly.
  function finish(retry = true) {
    const p = state.pending;
    if (!p) return;
    clearTimeout(p.timer);
    const now = isActive() ? p.field.textBefore() : null;
    const current = now === null ? null : norm(now).slice(-engine.MAX_CONTEXT);
    if (retry && current === p.before && ++p.tries < MAX_TRIES) {
      p.timer = setTimeout(finish, 10 * p.tries);
      return;
    }
    state.pending = null;
    // Only correct if exactly the expected key landed; otherwise the page
    // swallowed it or something else changed, so do nothing.
    if (current === p.expected) correct(p.field, now);
  }

  // textBefore ends with the boundary character. Normally that character is
  // already in the field; with `keyPending` it hasn't been inserted yet (Enter
  // in inputs and rich editors, where the word must be fixed before the key
  // acts), so only the word itself is replaced.
  function correct(field, textBefore, { keyPending = false } = {}) {
    const result = state.corrector.check(textBefore);
    if (!result) return false;
    const rejected = state.rejected.get(field.el);
    if (rejected && rejected.has(engine.normalizeKey(result.from))) return false;

    state.applying = true;
    let ok = false;
    try {
      ok = keyPending
        ? field.replaceBeforeCaret(textBefore.length - 1 - result.start, result.to)
        : field.replaceBeforeCaret(textBefore.length - result.start, result.insert);
    } finally {
      state.applying = false;
    }
    if (ok) {
      // After a pending key, the first Cmd-Z undoes the key, not the correction,
      // so don't treat it as rejecting the correction.
      state.last = keyPending ? null : { field, from: result.from, to: result.to };
      settings.addRecent(result.from, result.to).catch(() => {});
    }
    return ok;
  }

  // Enter in an input or rich editor: fix the word before the key acts (a new
  // paragraph, a form submit, a chat message being sent).
  function correctBeforeEnter(target) {
    if (state.applying || !isActive()) return;
    const field = fields.adapterFor(target);
    const before = field && field.textBefore();
    if (before) correct(field, before + '\n', { keyPending: true });
  }

  // The user undid our correction right away: respect that.
  function rejectLast() {
    const last = state.last;
    state.last = null;
    if (!last) return;
    const key = engine.normalizeKey(last.from);
    const el = last.field.el;
    if (!state.rejected.has(el)) state.rejected.set(el, new Set());
    state.rejected.get(el).add(key);
    state.undoing = last.field;
    setTimeout(() => (state.undoing = null), 500);
    settings.markRecentUndone(last.from).catch(() => {});
  }

  // ---- event listeners ----------------------------------------------------------

  const targetOf = (e) => (e.composedPath ? e.composedPath()[0] : e.target);
  const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

  // Cmd/Ctrl-Z straight after a correction means "I meant what I typed".
  function trackUndo(e) {
    if (state.last && !MODIFIER_KEYS.has(e.key)) {
      const isUndo = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
      if (isUndo) rejectLast();
      else state.last = null;
    }
  }

  function onKeyDown(e) {
    // Settle the previous boundary key before this key changes anything. On
    // busy pages browsers run key events ahead of timers, so don't wait.
    if (state.pending) finish(false);
    trackUndo(e);
    if (e.isComposing || e.ctrlKey || e.metaKey) return;
    const target = targetOf(e);
    if (e.key === 'Enter') {
      if (target.tagName === 'TEXTAREA') begin(target, '\n', 'key');
      else correctBeforeEnter(target);
      return;
    }
    if (e.key.length === 1 && engine.isBoundary(e.key)) begin(target, e.key, 'key');
  }

  // Also covers input without usable key events (on-screen keyboards, some
  // input methods). begin() ignores the duplicate from a normal keystroke.
  function onBeforeInput(e) {
    if (state.applying) return;
    if (e.inputType === 'historyUndo') {
      if (state.last) rejectLast();
      return;
    }
    if (e.isComposing) return;
    if (e.inputType === 'insertText' && e.data && e.data.length === 1 && engine.isBoundary(e.data)) {
      begin(targetOf(e), e.data, 'input');
    }
  }

  function onInput(e) {
    if (e.inputType === 'historyUndo' && state.undoing) {
      state.undoing.collapseToEnd();
      state.undoing = null;
    }
  }

  // Popup asks which site this tab is on (so it can offer "disable on this site").
  settings.api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'basic-autocorrect:site' && NS.gdocs.isTopFrame()) {
      sendResponse({ host: window.location.hostname });
    }
  });

  async function init() {
    applySettings(await settings.load());
    settings.onChange(async () => applySettings(await settings.load()));
    if (NS.gdocs.isEventFrame()) return; // handled from the Docs page itself
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('beforeinput', onBeforeInput, true);
    window.addEventListener('input', onInput, true);
    window.addEventListener('focusin', (e) => isEditable(targetOf(e)) && wantSpeller(), true);
    NS.gdocs.init({ isActive, correct, trackUndo, wantSpeller });
  }

  // Exposed for the browser test page.
  NS.content = { state, correct, begin };
  init();
})(globalThis);
