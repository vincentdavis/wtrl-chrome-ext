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
      if (message.type === 'zp-rider-history') {
        // Stand-in career history: a few races with varying bests.
        const race = (wkg5, wkg1200) => ({
          wkg5: [String(wkg5), 0], w5: [String(Math.round(wkg5 * 72)), 0],
          wkg15: [String(wkg5 - 0.8), 0], w15: [String(Math.round((wkg5 - 0.8) * 72)), 0],
          wkg30: [String(wkg5 - 1.1), 0], w30: [String(Math.round((wkg5 - 1.1) * 72)), 0],
          wkg60: [String(wkg5 - 1.6), 0], w60: [String(Math.round((wkg5 - 1.6) * 72)), 0],
          wkg120: [String(wkg5 - 2.2), 0], w120: [String(Math.round((wkg5 - 2.2) * 72)), 0],
          wkg300: [String(wkg1200 + 0.6), 0], w300: [String(Math.round((wkg1200 + 0.6) * 72)), 0],
          wkg1200: [String(wkg1200), 0], w1200: [String(Math.round(wkg1200 * 72)), 0]
        });
        return { ok: true, data: { data: [race(8.9, 4.4), race(7.6, 5.1), race(8.2, 4.8)] } };
      }
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
        const store = {
          lastReport: window.__MOCK_LAST_REPORT || null,
          lastRace: window.__MOCK_LAST_RACE || null
        };
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
