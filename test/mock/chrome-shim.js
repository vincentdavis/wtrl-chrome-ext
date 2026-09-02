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
    // Pretend a My Teams tab is already open, with a content script that can
    // rebuild — enough to exercise the table's Refresh flow end to end.
    query: async () => [{ id: 42, url: 'https://www.wtrl.racing/zrl/myteams/' }],
    create: async ({ url }) => ({ id: 99, url }),
    remove: async () => {},
    sendMessage: async (tabId, message) => {
      if (message.type === 'ping') return { ok: true, teams: 2 };
      if (message.type === 'run-report') {
        await new Promise((r) => setTimeout(r, 900));
        const entry = window.__MOCK_LAST_REPORT;
        entry.report.generatedAt = new Date().toISOString();
        entry.generatedAt = entry.report.generatedAt;
        return { ok: true, report: entry.report };
      }
      return null;
    }
  },
  permissions: {
    contains: async () => false,
    request: async () => false
  },
  storage: {
    onChanged: {
      _listeners: [],
      addListener(fn) {
        this._listeners.push(fn);
      }
    },
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

/** Test helper: publish a stored report and notify listeners, as Chrome would. */
window.__mockPushReport = (entry) => {
  window.__MOCK_LAST_REPORT = entry;
  chrome.storage.onChanged._listeners.forEach((fn) =>
    fn({ lastReport: { newValue: entry } }, 'local')
  );
};
