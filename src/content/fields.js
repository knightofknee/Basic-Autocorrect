/*
 * Editor adapters for standard fields. Each adapter exposes:
 *   textBefore()                    -> the text just before the caret (or null)
 *   replaceBeforeCaret(count, text) -> replace the last `count` characters before
 *                                      the caret with `text`; returns success
 *
 * Replacements go through document.execCommand('insertText') so they land on
 * the browser's native undo stack (Cmd/Ctrl-Z restores what you typed) and
 * editors see an ordinary input event.
 */
(function (root) {
  const NS = (root.BasicAutocorrect = root.BasicAutocorrect || {});
  const MAX = NS.engine.MAX_CONTEXT;

  const TEXT_INPUT_TYPES = new Set(['text', 'search', '']);
  // Code editors: autocorrecting code would be harmful.
  const CODE_EDITORS = '.cm-editor, .CodeMirror, .monaco-editor, .ace_editor';

  // execCommand edits whatever has focus, so only touch a field that still has it.
  function hasFocus(el) {
    return el.isConnected && el.getRootNode().activeElement === el;
  }

  function insertText(doc, text) {
    try {
      return doc.execCommand('insertText', false, text);
    } catch (_) {
      return false;
    }
  }

  // ---- <input> / <textarea> -------------------------------------------------

  function textControlAdapter(el) {
    return {
      el,
      textBefore() {
        if (!hasFocus(el)) return null;
        const { selectionStart: s, selectionEnd: e } = el;
        if (s === null || s !== e) return null;
        return el.value.slice(Math.max(0, s - MAX), s);
      },
      replaceBeforeCaret(count, text) {
        if (!hasFocus(el)) return false;
        const caret = el.selectionStart;
        const start = caret - count;
        if (start < 0) return false;
        const expected = el.value.slice(0, start) + text + el.value.slice(caret);
        el.setSelectionRange(start, caret);
        if (insertText(el.ownerDocument, text)) return el.value === expected;
        // execCommand unavailable: edit directly (not undoable, but correct).
        el.setRangeText(text, start, caret, 'end');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        return el.value === expected;
      },
      // Undo restores the selection we made around the word; put the caret
      // after it instead so the next keystroke doesn't overwrite it.
      collapseToEnd() {
        if (hasFocus(el) && el.selectionStart !== el.selectionEnd) el.setSelectionRange(el.selectionEnd, el.selectionEnd);
      },
    };
  }

  // ---- contenteditable --------------------------------------------------------

  function selectionFor(node) {
    const rootNode = node.getRootNode();
    if (rootNode !== node.ownerDocument && typeof rootNode.getSelection === 'function') {
      return rootNode.getSelection(); // shadow DOM (Chromium)
    }
    return node.ownerDocument.getSelection();
  }

  function editingHost(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || !el.isContentEditable) return null;
    while (el.parentElement && el.parentElement.isContentEditable) el = el.parentElement;
    return el;
  }

  // Elements that separate words visually: blocks, line breaks, embedded
  // objects, and non-editable islands (mentions, chips).
  function isSeparator(el) {
    if (el.tagName === 'BR' || el.tagName === 'IMG' || el.isContentEditable === false) return true;
    const display = el.ownerDocument.defaultView.getComputedStyle(el).display;
    return display !== 'inline' && display !== 'contents';
  }

  // Walk backwards from the caret, collecting text nodes in the same line.
  // Returns { text, pieces: [{ node, len }] (in document order) } or null.
  function collectBefore(sel, host) {
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
    let node = sel.focusNode;
    let offset = sel.focusOffset;
    if (!node || !host.contains(node)) return null;

    // Normalize an element caret position to the end of the preceding text.
    if (node.nodeType !== 3) {
      const before = node.childNodes[offset - 1];
      if (!before) return { text: '', pieces: [] };
      if (before.nodeType === 3) {
        node = before;
        offset = before.data.length;
      } else {
        if (before.nodeType === 1 && isSeparator(before)) return { text: '', pieces: [] };
        let last = before;
        while (last.lastChild) last = last.lastChild;
        if (last.nodeType !== 3) return { text: '', pieces: [] };
        node = last;
        offset = last.data.length;
      }
    }

    const doc = host.ownerDocument;
    const walker = doc.createTreeWalker(host, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    walker.currentNode = node;
    const pieces = [{ node, len: offset }];
    let length = offset;
    const block = (n) => {
      let el = n.parentElement;
      while (el && el !== host && !isSeparator(el)) el = el.parentElement;
      return el;
    };
    const startBlock = block(node);

    while (length < MAX) {
      const prev = walker.previousNode();
      if (!prev || prev === host) break;
      if (prev.nodeType === 1) {
        if (isSeparator(prev)) break;
        continue;
      }
      if (block(prev) !== startBlock) break;
      pieces.unshift({ node: prev, len: prev.data.length });
      length += prev.data.length;
    }

    const text = pieces.map((p) => p.node.data.slice(0, p.len)).join('');
    return { text, pieces };
  }

  // DOM position of the character `index` characters before the caret.
  function positionBack(collected, count) {
    let remaining = count;
    for (let i = collected.pieces.length - 1; i >= 0; i--) {
      const p = collected.pieces[i];
      if (remaining <= p.len) return { node: p.node, offset: p.len - remaining };
      remaining -= p.len;
    }
    return null;
  }

  function contentEditableAdapter(el) {
    const host = editingHost(el);
    if (!host) return null;
    return {
      el: host,
      textBefore() {
        if (!host.isConnected || !host.contains(host.getRootNode().activeElement)) return null;
        const collected = collectBefore(selectionFor(host), host);
        return collected ? collected.text.slice(-MAX) : null;
      },
      replaceBeforeCaret(count, text) {
        if (this.textBefore() === null) return false;
        const sel = selectionFor(host);
        const collected = collectBefore(sel, host);
        if (!collected) return false;
        const start = positionBack(collected, count);
        if (!start) return false;
        const focusNode = sel.focusNode;
        const focusOffset = sel.focusOffset;
        // Browsers render trailing spaces as nbsp in contenteditable themselves.
        const insert = text.replace(/\u00A0/g, ' ');
        sel.setBaseAndExtent(start.node, start.offset, focusNode, focusOffset);
        if (!insertText(host.ownerDocument, insert)) {
          sel.collapse(focusNode, focusOffset); // didn't take: restore the caret
          return false;
        }
        const after = this.textBefore();
        const norm = (s) => (s || '').replace(/\u00A0/g, ' ');
        return after !== null && norm(after).endsWith(norm(insert));
      },
      collapseToEnd() {
        const sel = selectionFor(host);
        if (sel && sel.rangeCount && !sel.isCollapsed && host.contains(sel.focusNode)) sel.collapseToEnd();
      },
    };
  }

  // ---- adapter selection ------------------------------------------------------

  function adapterFor(target) {
    if (!target || target.nodeType !== 1) return null;
    if (target.closest(CODE_EDITORS)) return null;
    if (target.tagName === 'TEXTAREA') {
      return target.readOnly || target.disabled ? null : textControlAdapter(target);
    }
    if (target.tagName === 'INPUT') {
      const type = (target.getAttribute('type') || '').toLowerCase();
      return TEXT_INPUT_TYPES.has(type) && !target.readOnly && !target.disabled ? textControlAdapter(target) : null;
    }
    if (target.isContentEditable) return contentEditableAdapter(target);
    return null;
  }

  NS.fields = { adapterFor, textControlAdapter, contentEditableAdapter, collectBefore };
})(globalThis);
