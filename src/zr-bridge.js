/**
 * Content script on zwiftracing.app.
 *
 * Rider data is only available at /_next/data/<buildId>/riders/<zwid>.json,
 * served solely with the `x-nextjs-data: 1` header — /api/riders/<zwid>
 * answers 403 — and only to a signed-in session. So the fetch has to happen on
 * a zwiftracing.app page, as it does for WTRL and ZwiftPower.
 *
 * The buildId changes on every deploy of theirs, so it is read from the live
 * page rather than hardcoded; a stale one would 404 silently.
 */
(() => {
  'use strict';

  if (window.__wtrlZrBridgeLoaded) return;
  window.__wtrlZrBridgeLoaded = true;

  const TIMEOUT_MS = 20000;
  const MAX_ATTEMPTS = 3;
  const RETRY_BASE_MS = 1500;
  // One request per rider, against someone else's site: pace it.
  const PACE_MS = 250;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** The Next.js build id, from whichever the page exposes. */
  function buildId() {
    try {
      const el = document.getElementById('__NEXT_DATA__');
      if (el) {
        const parsed = JSON.parse(el.textContent);
        if (parsed && parsed.buildId) return parsed.buildId;
      }
    } catch (_) {}
    try {
      if (window.__NEXT_DATA__ && window.__NEXT_DATA__.buildId) return window.__NEXT_DATA__.buildId;
    } catch (_) {}
    // Last resort: lift it out of a /_next/static/<buildId>/ script URL.
    const script = [...document.querySelectorAll('script[src*="/_next/static/"]')]
      .map((s) => (s.getAttribute('src') || '').match(/\/_next\/static\/([^/]+)\/_buildManifest/))
      .find(Boolean);
    return script ? script[1] : null;
  }

  function retryable(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  /** Fetch one rider, retrying transient failures with backoff. */
  async function fetchRider(zwid) {
    const id = buildId();
    if (!id) return { ok: false, zwid, error: 'Could not read the ZwiftRacing build id' };

    const url = `/_next/data/${id}/riders/${encodeURIComponent(zwid)}.json`;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        response = await fetch(url, {
          credentials: 'include',
          headers: { 'x-nextjs-data': '1', Accept: 'application/json' },
          signal: controller.signal
        });
        clearTimeout(timer);
      } catch (error) {
        if (attempt === MAX_ATTEMPTS) {
          return { ok: false, zwid, error: String((error && error.message) || error) };
        }
        await sleep(RETRY_BASE_MS * attempt);
        continue;
      }

      if (response.ok) {
        try {
          const json = await response.json();
          const rider = json && json.pageProps && json.pageProps.rider;
          if (!rider) return { ok: false, zwid, error: 'No rider in the response' };
          return { ok: true, zwid, rider };
        } catch (_) {
          return { ok: false, zwid, error: 'Response was not JSON' };
        }
      }

      if (response.status === 404) {
        return { ok: false, zwid, status: 404, error: 'No ZwiftRacing profile' };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false, zwid, status: response.status,
          error: 'ZwiftRacing refused the request — sign in at zwiftracing.app and retry'
        };
      }
      if (!retryable(response.status) || attempt === MAX_ATTEMPTS) {
        return { ok: false, zwid, status: response.status, error: 'HTTP ' + response.status };
      }
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1));
    }
    return { ok: false, zwid, error: 'Gave up' };
  }

  /** Fetch a batch sequentially, pacing between riders. */
  async function fetchRiders(zwids) {
    const riders = [];
    const failures = [];
    const list = Array.isArray(zwids) ? zwids : [];

    for (let i = 0; i < list.length; i += 1) {
      const result = await fetchRider(list[i]);
      if (result.ok) riders.push(result.rider);
      else failures.push({ zwid: list[i], error: result.error, status: result.status });

      // A 401/403 will fail for every rider; stop rather than hammer them.
      if (result.status === 401 || result.status === 403) {
        return { ok: false, riders, failures, error: result.error, aborted: true };
      }
      if (i < list.length - 1) await sleep(PACE_MS);
    }
    return { ok: true, riders, failures };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'zr-ping') {
      sendResponse({ ok: true, buildId: buildId(), origin: window.location.origin });
      return true;
    }
    if (message?.type === 'zr-riders') {
      fetchRiders(message.zwids).then(sendResponse);
      return true; // async
    }
    return false;
  });
})();
