/*
 * Google Docs adapter.
 *
 * Docs draws text on a canvas and receives keystrokes in a hidden iframe
 * (".docs-texteventtarget-iframe"), so the document text can't be read from the
 * page. Instead we keep a small buffer of what the user typed since the last
 * caret jump. When a boundary key would finish a word we'd correct, we first
 * send Docs a Backspace for each letter of the word and then "type" the
 * correction as key presses, before letting the real key through. Typing (vs.
 * pasting) keeps the surrounding formatting and lets Docs apply its own smart
 * quotes. Tested approaches that Docs ignores or mangles: execCommand, and
 * paste events (Docs trims their whitespace).
 *
 * Only the typed characters of the current line (at most ~64) are kept, in
 * memory, in this tab. Nothing is stored or sent anywhere.
 */
(function (root) {
  const NS = (root.BasicAutocorrect = root.BasicAutocorrect || {});
  const IFRAME = 'iframe.docs-texteventtarget-iframe';
  const MAX = () => NS.engine.MAX_CONTEXT;
  // Prefixing the buffer with this makes the engine treat its first word as
  // "glued to unknown text", so we never correct a word we only saw part of.
  const UNKNOWN_START = '\uFFFF';

  // Note: in Firefox content scripts `globalThis` is a sandbox, not the page's
  // `window`, so frame and DOM checks must go through `window` explicitly.
  function isTopFrame() {
    return window.top === window.self;
  }

  function isDocsPage() {
    return isTopFrame() && window.location.hostname === 'docs.google.com' &&
      window.location.pathname.startsWith('/document/');
  }

  // True inside Docs' hidden typing iframe, where the generic field handling
  // must stay out of the way.
  function isEventFrame() {
    try {
      return !!window.frameElement && window.frameElement.matches(IFRAME);
    } catch (_) {
      return false;
    }
  }

  function init(ctx) {
    if (!isDocsPage()) return;

    let frameWin = null;
    let buf = '';
    let known = true; // do we know where the current word started?
    let lastFix = null; // the correction just made: { from, to, boundary }
    let allSelected = false; // Cmd/Ctrl-A was the last key
    let pendingFix = null;

    const reset = (startKnown) => {
      buf = '';
      known = startKnown;
    };

    function target() {
      const doc = frameWin && frameWin.document;
      return doc && (doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : doc.querySelector('[contenteditable="true"]') || doc.body);
    }

    function sendKey(el, type, key, keyCode) {
      const init = { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true };
      el.dispatchEvent(new frameWin.KeyboardEvent(type, init));
    }

    function backspace(el, count) {
      for (let i = 0; i < count; i++) {
        sendKey(el, 'keydown', 'Backspace', 8);
        sendKey(el, 'keyup', 'Backspace', 8);
      }
    }

    function typeText(el, text) {
      for (const ch of text) {
        const code = ch.codePointAt(0);
        el.dispatchEvent(new frameWin.KeyboardEvent('keypress', {
          key: ch, keyCode: code, which: code, charCode: code, bubbles: true, cancelable: true,
        }));
      }
    }

    // A pseudo field for the shared correction pipeline.
    const field = {
      el: null,
      textBefore: () => (known ? '' : UNKNOWN_START) + buf,
      replaceBeforeCaret(count, text) {
        const el = target();
        if (!el) return false;
        // `count` and `text` include the boundary key, which hasn't reached
        // Docs yet: replace just the word.
        const word = count - 1;
        pendingFix = { from: buf.slice(buf.length - word), to: text.slice(0, -1), boundary: text.slice(-1) };
        backspace(el, word);
        typeText(el, pendingFix.to);
        buf = buf.slice(0, buf.length - word) + pendingFix.to;
        return true;
      },
      collapseToEnd() {},
    };

    // Docs' own undo would take two presses (it undoes our typing, then our
    // deletions). Instead, Cmd/Ctrl-Z right after a correction swaps the
    // original word straight back in. The caret steps over the space rather
    // than retyping it: typing a space would trigger Docs' own autocorrect,
    // which would "fix" the word again.
    function revert(fix) {
      const el = target();
      if (!el) return false;
      const step = fix.boundary.length;
      for (let i = 0; i < step; i++) sendKey(el, 'keydown', 'ArrowLeft', 37), sendKey(el, 'keyup', 'ArrowLeft', 37);
      backspace(el, fix.to.length);
      typeText(el, fix.from);
      for (let i = 0; i < step; i++) sendKey(el, 'keydown', 'ArrowRight', 39), sendKey(el, 'keyup', 'ArrowRight', 39);
      if (fix.boundary === '\n') reset(true);
      else buf = buf.slice(0, buf.length - fix.to.length - step) + fix.from + fix.boundary;
      return true;
    }

    const MODIFIERS = new Set(['Shift', 'CapsLock', 'Alt', 'Control', 'Meta', 'OS']);
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);

    // Where does a caret-moving key leave us? true = at a word start.
    function afterMove(e) {
      if (e.shiftKey) return false; // selecting
      const lineKey = mac ? e.metaKey : false;
      const wordKey = mac ? e.altKey : e.ctrlKey;
      switch (e.key) {
        case 'Home': return true;
        case 'ArrowLeft': return lineKey || wordKey; // line start, or start of a word
        case 'ArrowUp': return (mac && e.metaKey) || (!mac && e.ctrlKey); // document start
        default: return false;
      }
    }

    function onKeyDown(e) {
      if (!e.isTrusted) return; // our own synthetic keys
      const { key } = e;
      if (MODIFIERS.has(key)) return;
      ctx.wantSpeller();
      const isUndo = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && key.toLowerCase() === 'z';
      const fix = lastFix;
      lastFix = null;
      const wasAllSelected = allSelected;
      allSelected = false;
      ctx.trackUndo(e);
      if (!ctx.isActive()) return;
      if (isUndo && fix && revert(fix)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.isComposing || key === 'Process' || key === 'Dead' || key === 'Unidentified') return reset(false);
      if (key.startsWith('Arrow') || key === 'Home' || key === 'End' || key.startsWith('Page')) return reset(afterMove(e));
      if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'a' && !e.shiftKey && !e.altKey) {
        allSelected = true;
        return reset(false);
      }
      if (e.ctrlKey || e.metaKey) return reset(false);
      // Deleting or typing over everything: the document now starts here.
      if (wasAllSelected && (key === 'Backspace' || key === 'Delete')) return reset(true);
      if (wasAllSelected && key.length === 1) reset(true);
      if (key === 'Tab') return reset(true);
      if (key === 'Backspace') {
        if (e.altKey || !buf) reset(false);
        else buf = buf.slice(0, -1);
        return;
      }
      const ch = key === 'Enter' ? '\n' : key; // Enter finishes a word like Space
      if (ch.length !== 1) return reset(false); // Delete, Escape, F-keys, ...

      if (NS.engine.isBoundary(ch)) {
        field.el = frameWin.document;
        pendingFix = null;
        if (ctx.correct(field, (field.textBefore() + ch).slice(-MAX())) && pendingFix) {
          lastFix = { ...pendingFix, boundary: ch };
        }
      }
      if (ch === '\n') return reset(true); // new paragraph: a word starts here
      buf = (buf + ch).slice(-MAX());
    }

    function attach() {
      const iframe = window.document.querySelector(IFRAME);
      const win = iframe && iframe.contentWindow;
      if (!win || win === frameWin) return;
      frameWin = win;
      reset(true);
      win.addEventListener('keydown', onKeyDown, true);
      // Docs cancels normal key presses, so these only fire when text arrives
      // some other way (IME, dictation, autofill, paste): we can no longer
      // trust the buffer to match the document.
      for (const type of ['beforeinput', 'input', 'compositionstart', 'paste', 'drop']) {
        win.addEventListener(type, (e) => e.isTrusted && reset(false), true);
      }
    }

    // Clicking moves the caret somewhere we can't see; assume a word start.
    window.document.addEventListener('mousedown', () => reset(true), true);
    attach();
    // Docs can recreate its typing iframe; pick up a new one as soon as it
    // takes focus (and poll as a fallback).
    window.document.addEventListener('focusin', (e) => e.target.matches && e.target.matches(IFRAME) && attach(), true);
    setInterval(attach, 1000);
  }

  NS.gdocs = { init, isEventFrame, isTopFrame, isDocsPage };
})(globalThis);
