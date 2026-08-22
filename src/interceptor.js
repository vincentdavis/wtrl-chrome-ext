/**
 * MAIN-world interceptor.
 *
 * Runs inside the page's own JS context (not the isolated content-script world)
 * so it can wrap window.fetch / XMLHttpRequest and observe the very same
 * requests wtrl.racing makes when a team accordion panel is expanded.
 *
 * Two jobs:
 *   1. Capture any JSON response that looks like a team-detail payload
 *      ({ meta: { trc }, riders: [...] }) and forward it to the content script.
 *      This is how we learn the endpoint URL without hardcoding a guess.
 *   2. Serve "fetch this team directly" commands from the content script, using
 *      the page's own origin + cookies, so later teams don't need a UI click.
 *
 * Nothing here touches credentials: it only observes responses the page has
 * already requested, and only ever fetches same-origin URLs.
 */
(() => {
  'use strict';

  if (window.__wtrlReportInterceptorLoaded) return;
  window.__wtrlReportInterceptorLoaded = true;

  const ORIGIN = window.location.origin;

  /** True for the team-detail JSON shape shown in the WTRL myteams flow. */
  function looksLikeTeamPayload(data) {
    return !!(
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      data.meta &&
      typeof data.meta === 'object' &&
      data.meta.trc !== undefined &&
      Array.isArray(data.riders)
    );
  }

  function emit(message) {
    try {
      window.postMessage({ __wtrlReport: true, ...message }, ORIGIN);
    } catch (_) {
      /* structured-clone failure: nothing useful to do */
    }
  }

  function inspect(url, bodyText) {
    if (typeof bodyText !== 'string' || bodyText.length === 0) return;
    // Cheap pre-filter so we don't JSON.parse every page asset.
    if (bodyText.indexOf('"riders"') === -1 || bodyText.indexOf('"trc"') === -1) return;

    let data;
    try {
      data = JSON.parse(bodyText);
    } catch (_) {
      return;
    }
    if (!looksLikeTeamPayload(data)) return;

    let absolute = url;
    try {
      absolute = new URL(url, window.location.href).href;
    } catch (_) {
      /* keep the raw value */
    }
    emit({ kind: 'team-data', url: absolute, data });
  }

  // ---------------------------------------------------------------- fetch ---
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  if (nativeFetch) {
    window.fetch = function wtrlPatchedFetch(input, init) {
      const promise = nativeFetch(input, init);
      promise
        .then((response) => {
          try {
            if (response.__wtrlInternal) return;
            const type = response.headers.get('content-type') || '';
            if (!/json|javascript|text\/plain/i.test(type)) return;
            const requestUrl =
              response.url ||
              (typeof input === 'string' ? input : input && input.url) ||
              '';
            response
              .clone()
              .text()
              .then((text) => inspect(requestUrl, text))
              .catch(() => {});
          } catch (_) {}
        })
        .catch(() => {});
      return promise;
    };
  }

  // ------------------------------------------------------------------ XHR ---
  const XHR = XMLHttpRequest.prototype;
  const nativeOpen = XHR.open;
  const nativeSend = XHR.send;

  XHR.open = function wtrlPatchedOpen(method, url) {
    try {
      this.__wtrlUrl = url;
    } catch (_) {}
    return nativeOpen.apply(this, arguments);
  };

  XHR.send = function wtrlPatchedSend() {
    try {
      this.addEventListener('load', () => {
        try {
          // responseText throws unless responseType is '' or 'text'.
          if (this.responseType && this.responseType !== 'text') return;
          inspect(this.responseURL || this.__wtrlUrl || '', this.responseText);
        } catch (_) {}
      });
    } catch (_) {}
    return nativeSend.apply(this, arguments);
  };

  // ------------------------------------------- direct-fetch command server ---
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.__wtrlReportCmd !== true || typeof msg.id !== 'string') return;
    if (msg.kind !== 'fetch') return;

    const reply = (payload) =>
      emit({ kind: 'fetch-result', id: msg.id, ...payload });

    let target;
    try {
      target = new URL(String(msg.url), window.location.href);
    } catch (_) {
      reply({ ok: false, error: 'Invalid URL' });
      return;
    }
    // Hard same-origin guard: this helper must never become a generic,
    // credentialed cross-origin proxy for anything running on the page.
    if (target.origin !== ORIGIN) {
      reply({ ok: false, error: 'Refused: cross-origin request' });
      return;
    }

    const doFetch = nativeFetch || window.fetch;
    doFetch(target.href, {
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
      }
    })
      .then((response) => {
        try {
          response.__wtrlInternal = true;
        } catch (_) {}
        return response.text().then((text) => ({ response, text }));
      })
      .then(({ response, text }) => {
        if (!response.ok) {
          reply({ ok: false, status: response.status, error: 'HTTP ' + response.status });
          return;
        }
        let data;
        try {
          data = JSON.parse(text);
        } catch (_) {
          reply({ ok: false, error: 'Response was not JSON' });
          return;
        }
        if (!looksLikeTeamPayload(data)) {
          reply({ ok: false, error: 'Response was not a team payload' });
          return;
        }
        reply({ ok: true, url: response.url || target.href, data });
      })
      .catch((err) => reply({ ok: false, error: String((err && err.message) || err) }));
  });

  emit({ kind: 'interceptor-ready' });
})();
