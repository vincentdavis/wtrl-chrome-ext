/**
 * Isolated-world bridge on zwiftpower.com.
 *
 * ZwiftPower's JSON endpoints return 403 to anyone without the signed-in
 * session, and the extension's own service worker cannot borrow that session
 * (its requests count as cross-site, so the session cookie is withheld). So the
 * fetch has to happen on a zwiftpower.com page, exactly as it does on WTRL.
 *
 * This script takes requests from the background worker and hands them to the
 * MAIN-world fetcher in interceptor.js, which issues them as the page itself.
 */
(() => {
  'use strict';

  if (window.__wtrlZpBridgeLoaded) return;
  window.__wtrlZpBridgeLoaded = true;

  const FETCH_TIMEOUT_MS = 30000;
  const pending = new Map();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.__wtrlReport !== true || msg.kind !== 'fetch-result') return;

    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  function pageFetch(path) {
    return new Promise((resolve) => {
      const id = 'zp-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, timedOut: true, error: 'Timed out after 30s' });
      }, FETCH_TIMEOUT_MS);

      pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });

      window.postMessage(
        { __wtrlReportCmd: true, kind: 'fetch', id, url: path, expect: 'json' },
        window.location.origin
      );
    });
  }

  /** Results for one Zwift event: every rider, with real zwids and power. */
  function eventResults(zid) {
    return pageFetch(`/cache3/results/${encodeURIComponent(zid)}_view.json`);
  }

  /** A single rider's full result history, used for career-best power. */
  function riderHistory(zwid) {
    return pageFetch(`/cache3/profile/${encodeURIComponent(zwid)}_all.json`);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'zp-ping') {
      sendResponse({ ok: true, origin: window.location.origin });
      return true;
    }
    if (message?.type === 'zp-event-results') {
      eventResults(message.zid).then(sendResponse);
      return true; // async
    }
    if (message?.type === 'zp-rider-history') {
      riderHistory(message.zwid).then(sendResponse);
      return true; // async
    }
    return false;
  });
})();
