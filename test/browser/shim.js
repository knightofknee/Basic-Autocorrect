// Minimal in-memory stand-in for the extension storage/runtime APIs so the
// content scripts can run on a plain web page for testing.
(function () {
  const data = {};
  const listeners = [];
  window.chrome = {
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const k of keys) if (k in data) out[k] = structuredClone(data[k]);
          return out;
        },
        async set(patch) {
          const changes = {};
          for (const [k, v] of Object.entries(patch)) {
            changes[k] = { oldValue: data[k], newValue: v };
            data[k] = structuredClone(v);
          }
          listeners.forEach((fn) => fn(changes, 'local'));
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    runtime: { onMessage: { addListener() {} }, openOptionsPage() {} },
    tabs: {
      async query() { return [{ id: 1 }]; },
      async sendMessage() { return { host: 'docs.google.com' }; },
    },
  };
})();
