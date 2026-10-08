/*
 * Settings live in browser.storage.local only — on this device, never synced,
 * never sent anywhere.
 */
(function (root) {
  const NS = (root.BasicAutocorrect = root.BasicAutocorrect || {});
  const api = root.browser || root.chrome;

  const DEFAULTS = Object.freeze({
    enabled: true,
    custom: {},          // { typo: replacement }
    allowed: [],         // words never to correct
    disabledSites: [],   // hostnames where autocorrect is off
    builtins: true,      // use the built-in correction lists
    aggressive: false,   // also fix other misspelled words (dictionary-based)
    apostrophe: 'straight', // 'straight' (') or 'curly' (’)
    recent: [],          // last few corrections made: [{ from, to, at, undone }]
  });
  const RECENT_LIMIT = 10;

  async function load() {
    const stored = await api.storage.local.get(Object.keys(DEFAULTS));
    return { ...DEFAULTS, ...stored };
  }

  function save(patch) {
    return api.storage.local.set(patch);
  }

  function onChange(callback) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') callback(changes);
    });
  }

  async function addRecent(from, to) {
    const { recent } = await load();
    const next = [{ from, to, at: Date.now() }, ...recent.filter((r) => r.from !== from)];
    await save({ recent: next.slice(0, RECENT_LIMIT) });
  }

  async function markRecentUndone(from) {
    const { recent } = await load();
    await save({ recent: recent.map((r) => (r.from === from ? { ...r, undone: true } : r)) });
  }

  NS.settings = { DEFAULTS, load, save, onChange, addRecent, markRecentUndone, api };
})(globalThis);
