// Automated in-browser tests. Simulates typing the way a browser does it:
// a keydown, then (unless cancelled) the text is inserted via the editing
// pipeline, which fires beforeinput/input like real typing.
(function () {
  const NS = window.BasicAutocorrect;
  const $ = (id) => document.getElementById(id);
  const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
  const results = [];

  function placeCaretAtEnd(el) {
    el.focus();
    if (el.isContentEditable) {
      const sel = getSelection();
      let node = el;
      while (node.lastChild) node = node.lastChild;
      if (node.nodeType === 3) sel.collapse(node, node.data.length);
      else if (node.tagName === 'BR') sel.collapse(node.parentNode, 0);
      else sel.collapse(node, node.childNodes.length);
    } else if (el.type !== 'email') {
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }

  // fast: no pause between keys, like a busy page that runs key events
  // ahead of timers.
  async function type(el, text, { fast = false } = {}) {
    placeCaretAtEnd(el);
    for (const ch of text) {
      const key = ch === '\n' ? 'Enter' : ch;
      const ok = el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true }));
      if (ok) document.execCommand('insertText', false, ch);
      if (!fast) await tick(5);
    }
    await tick();
  }

  async function undo() {
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    document.execCommand('undo');
    await tick();
  }

  const read = (el) => (el.isContentEditable ? el.textContent : el.value).replace(/\u00A0/g, ' ');

  function reset(el, html) {
    if (el.isContentEditable) el.innerHTML = html || '';
    else el.value = '';
    NS.content.state.rejected = new WeakMap();
    NS.content.state.last = null;
  }

  async function check(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, msg: e.message });
    }
  }

  function eq(actual, expected) {
    if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }

  async function run() {
    results.length = 0;
    await NS.settings.save({ ...NS.settings.DEFAULTS });
    await tick();
    const fields = { input: $('input'), textarea: $('textarea'), contenteditable: $('ce') };

    for (const [kind, el] of Object.entries(fields)) {
      await check(`${kind}: dont<space>`, async () => { reset(el); await type(el, 'dont '); eq(read(el), "don't "); });
      await check(`${kind}: sentence`, async () => {
        reset(el); await type(el, 'im sure teh cat isnt wierd.'); eq(read(el), "I'm sure the cat isn't weird.");
      });
      await check(`${kind}: fast typing`, async () => {
        reset(el); await type(el, 'dont im sure teh cat ', { fast: true }); eq(read(el), "don't I'm sure the cat ");
      });
      await check(`${kind}: capitalization`, async () => { reset(el); await type(el, 'Dont DONT Teh '); eq(read(el), "Don't DON'T The "); });
      await check(`${kind}: punctuation kept`, async () => { reset(el); await type(el, '(dont) teh, '); eq(read(el), "(don't) the, "); });
      await check(`${kind}: no correction mid-word`, async () => { reset(el); await type(el, 'tehran dontx '); eq(read(el), 'tehran dontx '); });
      await check(`${kind}: undo restores typed word`, async () => {
        reset(el); await type(el, 'dont '); eq(read(el), "don't "); await undo(); eq(read(el), 'dont ');
      });
      await check(`${kind}: undone word not re-corrected in same field`, async () => {
        reset(el); await type(el, 'teh '); await undo(); await type(el, 'and teh '); eq(read(el), 'teh and teh ');
      });
    }

    await check('focus moves before a pending correction settles', async () => {
      const ta = $('textarea'), ce = $('ce'); reset(ta); reset(ce);
      await type(ta, 'teh', { fast: true });
      placeCaretAtEnd(ta);
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      document.execCommand('insertText', false, ' ');
      await type(ce, 'x', { fast: true }); // focus moved; next keydown settles the pending check
      eq(read(ce), 'x');
      eq(read(ta), 'teh ');
    });

    await check('textarea: Enter finishes a word', async () => {
      const el = $('textarea'); reset(el); await type(el, 'teh\n'); eq(read(el), 'the\n');
    });

    await check('contenteditable: word split across nodes', async () => {
      const el = $('ce'); reset(el, 'so do<b>n</b>t'); await type(el, ' '); eq(read(el), "so don't ");
    });

    await check('contenteditable: separate paragraphs are separate words', async () => {
      const el = $('ce2'); reset(el, '<p>teh</p><p>cat</p>'); await type(el, ' '); eq(el.innerText.replace(/\u00A0/g, ' ').trim(), 'teh\n\ncat');
    });

    await check('contenteditable: correction in second paragraph', async () => {
      const el = $('ce2'); reset(el, '<p>first</p><p>dont</p>'); await type(el, ' ');
      eq(el.querySelectorAll('p')[1].textContent.replace(/\u00A0/g, ' '), "don't ");
      eq(el.querySelectorAll('p')[0].textContent, 'first');
    });

    for (const id of ['password', 'email', 'code']) {
      await check(`${id}: never corrected`, async () => {
        const el = $(id); reset(el); await type(el, 'dont x'); eq(read(el), 'dont x');
      });
    }

    await check('custom correction', async () => {
      await NS.settings.save({ custom: { brianemail: 'brian@example.com', adress: 'address' } }); await tick();
      const el = $('input'); reset(el); await type(el, 'mail brianemail, Adress '); eq(read(el), 'mail brian@example.com, Address ');
    });

    await check('allowed word', async () => {
      await NS.settings.save({ allowed: ['teh'] }); await tick();
      const el = $('textarea'); reset(el); await type(el, 'teh dont '); eq(read(el), "teh don't ");
      await NS.settings.save({ allowed: [] }); await tick();
    });

    await check('recent corrections are recorded, undo is flagged', async () => {
      await NS.settings.save({ recent: [] }); await tick();
      const el = $('input'); reset(el); await type(el, 'wont '); await undo(); await tick(50);
      const { recent } = await NS.settings.load();
      eq(recent[0].from, 'wont'); eq(recent[0].undone, true);
    });

    await check('turned off', async () => {
      await NS.settings.save({ enabled: false }); await tick();
      const el = $('input'); reset(el); await type(el, 'dont '); eq(read(el), 'dont ');
      await NS.settings.save({ enabled: true }); await tick();
    });

    await check('disabled on this site', async () => {
      await NS.settings.save({ disabledSites: [location.hostname] }); await tick();
      const el = $('input'); reset(el); await type(el, 'dont '); eq(read(el), 'dont ');
      await NS.settings.save({ disabledSites: [] }); await tick();
    });

    await NS.settings.save({ ...NS.settings.DEFAULTS });
    const failed = results.filter((r) => !r.ok);
    $('results').innerHTML = results
      .map((r) => `<span class="${r.ok ? 'pass' : 'fail'}">${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ' \u2014 ' + r.msg}</span>`)
      .join('\n') + `\n\n${results.length - failed.length}/${results.length} passed`;
    window.testResults = { passed: results.length - failed.length, failed };
    return window.testResults;
  }

  $('run').addEventListener('click', run);
  window.runTests = run;
})();
