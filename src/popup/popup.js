(function () {
  const NS = window.BasicAutocorrect;
  const { settings, engine } = NS;
  const api = settings.api;
  const $ = (id) => document.getElementById(id);
  const isFullPage = new URLSearchParams(location.search).has('page');
  document.body.classList.toggle('page', isFullPage);
  let current = null;
  let siteHost = null;

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const c of children) node.append(c);
    return node;
  }

  function removeButton(label, onClick) {
    return el('button', { type: 'button', className: 'remove', title: label, ariaLabel: label, textContent: '\u00D7', onclick: onClick });
  }

  // ---- rendering ------------------------------------------------------------------

  function render() {
    const s = current;
    $('enabled').checked = s.enabled;
    document.body.classList.toggle('off', !s.enabled);
    $('builtins').checked = s.builtins;
    for (const radio of document.querySelectorAll('input[name="mode"]')) radio.checked = radio.value === (s.aggressive ? 'aggressive' : 'basic');
    $('mode-hint').textContent = s.aggressive
      ? 'Also fixes other misspelled words when the intended word is clear (wrok \u2192 work).'
      : 'Fixes common typos and contractions (dont \u2192 don\u2019t, teh \u2192 the).';
    $('curly').checked = s.apostrophe === 'curly';
    $('builtin-count').textContent = (Object.keys(NS.builtinCorrections).length +
      Object.keys(NS.commonCorrections).length).toLocaleString();

    if (siteHost) {
      const off = s.disabledSites.includes(siteHost);
      $('site').hidden = false;
      $('site-status').textContent = off ? `Off on ${siteHost}` : `On for ${siteHost}`;
      $('site-toggle').textContent = off ? 'Turn on' : 'Turn off here';
    }

    const customList = $('custom-list');
    customList.replaceChildren();
    const entries = Object.entries(s.custom).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) customList.append(el('li', { className: 'empty', textContent: 'e.g. myemail \u2192 me@example.com' }));
    for (const [from, to] of entries) {
      const edit = el('button', { type: 'button', className: 'entry', title: 'Edit' },
        el('span', { className: 'from', textContent: from }),
        el('span', { className: 'arrow', textContent: '\u2192' }),
        el('span', { className: 'to', textContent: to }));
      edit.onclick = () => {
        $('custom-from').value = from;
        $('custom-to').value = to;
        $('custom-to').focus();
        $('custom-to').select();
      };
      customList.append(el('li', {}, edit, removeButton(`Delete ${from}`, () => {
        const custom = { ...current.custom };
        delete custom[from];
        settings.save({ custom });
      })));
    }

    const allowList = $('allow-list');
    allowList.replaceChildren();
    if (!s.allowed.length) allowList.append(el('li', { className: 'empty', textContent: 'Words here are never changed.' }));
    for (const word of [...s.allowed].sort()) {
      allowList.append(el('li', { className: 'chip' }, el('span', { textContent: word }),
        removeButton(`Allow correcting ${word}`, () => settings.save({ allowed: current.allowed.filter((w) => w !== word) }))));
    }

    const recent = s.recent.filter((r) => !s.allowed.includes(engine.normalizeKey(r.from)));
    $('recent-section').hidden = !recent.length;
    const recentList = $('recent-list');
    recentList.replaceChildren();
    for (const r of recent) {
      recentList.append(el('li', { className: r.undone ? 'undone' : '' },
        el('span', { className: 'entry static' },
          el('span', { className: 'from', textContent: r.from }),
          el('span', { className: 'arrow', textContent: '\u2192' }),
          el('span', { className: 'to', textContent: r.to }),
          r.undone ? el('span', { className: 'tag', textContent: 'undone' }) : ''),
        el('button', { type: 'button', className: 'link', textContent: 'Never correct', onclick: () => allow(r.from) })));
    }
  }

  function allow(word) {
    const key = engine.normalizeKey(word.trim());
    if (!key || current.allowed.includes(key)) return;
    settings.save({ allowed: [...current.allowed, key] });
  }

  function showError(id, message) {
    $(id).textContent = message || '';
    $(id).hidden = !message;
  }

  // ---- events -------------------------------------------------------------------

  $('enabled').onchange = (e) => settings.save({ enabled: e.target.checked });
  $('builtins').onchange = (e) => settings.save({ builtins: e.target.checked });
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.onchange = () => settings.save({ aggressive: radio.value === 'aggressive' });
  }
  $('curly').onchange = (e) => settings.save({ apostrophe: e.target.checked ? 'curly' : 'straight' });

  $('site-toggle').onclick = () => {
    const sites = current.disabledSites;
    settings.save({
      disabledSites: sites.includes(siteHost) ? sites.filter((h) => h !== siteHost) : [...sites, siteHost],
    });
  };

  $('custom-form').onsubmit = (e) => {
    e.preventDefault();
    const from = engine.normalizeKey($('custom-from').value.trim());
    const to = $('custom-to').value.trim();
    if (!engine.isValidCustomKey(from)) {
      showError('custom-error', 'The typed word can\u2019t contain spaces or punctuation like . , ! ? ; : " ( )');
      return;
    }
    if (!to) return;
    showError('custom-error', '');
    settings.save({ custom: { ...current.custom, [from]: to }, allowed: current.allowed.filter((w) => w !== from) });
    $('custom-from').value = '';
    $('custom-to').value = '';
    $('custom-from').focus();
  };

  $('allow-form').onsubmit = (e) => {
    e.preventDefault();
    allow($('allow-word').value);
    $('allow-word').value = '';
  };

  $('export').onclick = () => {
    const data = { app: 'basic-autocorrect', version: 1, custom: current.custom, allowed: current.allowed };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    el('a', { href: url, download: 'basic-autocorrect.json' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  $('import').onclick = () => {
    // Popups close when a file picker opens (Firefox), so import from the full page.
    if (!isFullPage) api.runtime.openOptionsPage();
    else $('import-file').click();
  };

  $('import-file').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const custom = { ...current.custom };
      let added = 0;
      for (const [k, v] of Object.entries(data.custom || {})) {
        const key = engine.normalizeKey(String(k).trim());
        if (engine.isValidCustomKey(key) && typeof v === 'string' && v.trim()) {
          custom[key] = v.trim();
          added++;
        }
      }
      const words = (Array.isArray(data.allowed) ? data.allowed : []).filter((w) => typeof w === 'string' && w.trim());
      const allowed = [...new Set([...current.allowed, ...words.map((w) => engine.normalizeKey(w.trim()))])];
      await settings.save({ custom, allowed });
      showError('import-status', `Imported ${added} corrections and ${words.length} words.`);
    } catch (_) {
      showError('import-status', 'That file isn\u2019t a Basic Autocorrect export.');
    }
  };

  // ---- startup ------------------------------------------------------------------

  async function findSite() {
    if (isFullPage) return;
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      const reply = await api.tabs.sendMessage(tab.id, { type: 'basic-autocorrect:site' }, { frameId: 0 });
      if (reply && reply.host) siteHost = reply.host;
    } catch (_) {
      // Not a web page (or the page loaded before the extension): nothing to show.
    }
  }

  settings.onChange(async () => {
    current = await settings.load();
    render();
  });

  (async () => {
    current = await settings.load();
    await findSite();
    render();
  })();
})();
