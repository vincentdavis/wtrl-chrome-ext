/**
 * Dev-only chrome.* shim so extension pages (results/popup/options) can be
 * opened from the mock server. Injected by test/mock/server.mjs; never shipped.
 */
window.chrome = {
  runtime: {
    getManifest: () => ({ version: '0.1.0-mock' }),
    getURL: (p) => '/' + p,
    openOptionsPage: () => window.open('/src/options.html', '_blank'),
    onMessage: { addListener() {} },
    sendMessage: async (message) => {
      console.log('[mock] sendMessage', message);
      window.__lastExtensionMessage = message;
      return { ok: true };
    }
  },
  tabs: {
    create: async ({ url }) => console.log('[mock] tabs.create', url),
    query: async () => [],
    sendMessage: async () => null
  },
  permissions: {
    contains: async () => false,
    request: async () => false
  },
  storage: {
    local: {
      get: async (keys) => {
        const store = { lastReport: window.__MOCK_LAST_REPORT || null };
        const out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
          if (store[k] !== undefined && store[k] !== null) out[k] = store[k];
        });
        return out;
      },
      set: async () => {},
      remove: async () => {}
    }
  }
};
