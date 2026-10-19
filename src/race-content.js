/**
 * Content script for https://www.wtrl.racing/zrl/results/
 *
 * Adds a "Power" control that pairs the race you are looking at with its
 * ZwiftPower results. WTRL's results API zeroes out `zwid`, so the only usable
 * link is `zid` (the Zwift event id) carried on every rider row; ZwiftPower
 * publishes the same event with real zwids and a full power curve.
 *
 * The ZwiftPower fetch cannot happen here (different origin), so it is brokered
 * by the background worker through a zwiftpower.com tab.
 */
(() => {
  'use strict';

  if (window.__wtrlRaceContentLoaded) return;
  window.__wtrlRaceContentLoaded = true;

  const VERSION = chrome.runtime.getManifest().version;

  const state = {
    resultsUrl: null,
    resultsPayload: null,
    running: false,
    lastRace: null
  };

  // ======================================================= interceptor feed ===

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.__wtrlReport !== true || msg.kind !== 'results-data') return;

    // Whatever the page last loaded is the race the user is looking at.
    state.resultsUrl = msg.url || null;
    state.resultsPayload = msg.data;
    if (ui) {
      ui.launcher.disabled = false;
      refreshHint();
    }
  });

  /** Season / class / round, read back out of the results API path. */
  function raceMetaFromUrl(url) {
    try {
      const parts = new URL(url, window.location.href).pathname.split('/').filter(Boolean);
      const i = parts.indexOf('results');
      if (i === -1) return {};
      return {
        season: parts[i + 1] ? Number(parts[i + 1]) : null,
        class: parts[i + 2] || null,
        round: parts[i + 3] ? Number(parts[i + 3]) : null
      };
    } catch (_) {
      return {};
    }
  }

  // ===================================================================== UI ===

  let ui = null;

  function log(message) {
    if (ui) {
      const line = document.createElement('div');
      line.className = 'wr-log-line';
      line.textContent = message;
      ui.logEl.appendChild(line);
      ui.logEl.scrollTop = ui.logEl.scrollHeight;
    }
    console.log('[WTRL Race]', message);
  }

  function refreshHint() {
    if (!ui) return;
    const meta = state.resultsUrl ? raceMetaFromUrl(state.resultsUrl) : {};
    ui.hintEl.textContent = state.resultsPayload
      ? `Ready — ${meta.class || 'division'} round ${meta.round ?? '?'}.`
      : 'Choose a league, division and round on the page first.';
  }

  function buildUi() {
    const host = document.createElement('div');
    host.id = 'wtrl-race-root';
    const root = host.attachShadow({ mode: 'open' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('src/content.css');
    root.appendChild(link);

    const wrap = document.createElement('div');
    wrap.className = 'wr-wrap';
    wrap.innerHTML = `
      <button class="wr-launcher" type="button" title="Power profiles for this race" disabled>
        <span class="wr-launcher-dot"></span> Power
      </button>
      <section class="wr-panel" hidden>
        <header class="wr-panel-head">
          <h2>Race Power</h2>
          <button class="wr-close" type="button" aria-label="Close">&times;</button>
        </header>
        <div class="wr-panel-body">
          <div class="wr-summary wr-hint"></div>
          <div class="wr-progress" hidden>
            <div class="wr-bar"><div class="wr-bar-fill"></div></div>
            <div class="wr-status">Starting…</div>
          </div>
          <div class="wr-summary wr-result" hidden></div>
          <div class="wr-actions" hidden>
            <button class="wr-open wr-btn wr-btn-primary" type="button">Open power table</button>
            <button class="wr-retry wr-btn" type="button">Try again</button>
          </div>
          <details class="wr-log-wrap">
            <summary>Activity log</summary>
            <div class="wr-log"></div>
          </details>
        </div>
        <footer class="wr-panel-foot">
          <span>v${VERSION}</span>
          <button class="wr-options wr-link" type="button">Settings</button>
        </footer>
      </section>
    `;
    root.appendChild(wrap);
    document.body.appendChild(host);

    const $ = (sel) => wrap.querySelector(sel);
    ui = {
      panel: $('.wr-panel'),
      launcher: $('.wr-launcher'),
      hintEl: $('.wr-hint'),
      progress: $('.wr-progress'),
      barFill: $('.wr-bar-fill'),
      statusEl: $('.wr-status'),
      resultEl: $('.wr-result'),
      actionsEl: $('.wr-actions'),
      logEl: $('.wr-log')
    };

    ui.launcher.addEventListener('click', onLauncherClick);
    $('.wr-close').addEventListener('click', () => { ui.panel.hidden = true; });
    $('.wr-options').addEventListener('click', () =>
      chrome.runtime.sendMessage({ type: 'open-options' })
    );
    $('.wr-open').addEventListener('click', () =>
      chrome.runtime.sendMessage({ type: 'open-race' })
    );
    $('.wr-retry').addEventListener('click', () => collect());

    refreshHint();
    return ui;
  }

  function setProgress(pct, message) {
    if (!ui) return;
    ui.progress.hidden = false;
    if (pct !== null) ui.barFill.style.width = pct + '%';
    ui.statusEl.textContent = message;
  }

  function setResult(text, tone) {
    if (!ui) return;
    ui.resultEl.hidden = false;
    ui.resultEl.className = 'wr-summary wr-result' + (tone ? ' wr-' + tone : '');
    ui.resultEl.textContent = text;
  }

  // ================================================================ collect ===

  async function onLauncherClick() {
    if (state.running) { ui.panel.hidden = false; return; }
    if (state.lastRace) {
      chrome.runtime.sendMessage({ type: 'open-race' });
      return;
    }
    await collect();
  }

  async function collect() {
    if (state.running) return { ok: false, error: 'Already running.' };

    if (!state.resultsPayload) {
      ui.panel.hidden = false;
      setResult('No race loaded yet. Pick a league, division and round on the page, then try again.', 'error');
      return { ok: false, error: 'No results payload seen yet' };
    }

    const zid = WTRLRace.eventIdFrom(state.resultsPayload);
    if (!zid) {
      ui.panel.hidden = false;
      setResult('This race has no Zwift event id, so it cannot be matched to ZwiftPower.', 'error');
      return { ok: false, error: 'No zid on the results payload' };
    }

    state.running = true;
    ui.panel.hidden = false;
    ui.launcher.disabled = true;
    ui.resultEl.hidden = true;
    ui.actionsEl.hidden = true;
    ui.logEl.textContent = '';

    const meta = raceMetaFromUrl(state.resultsUrl);
    const wtrlCount = WTRLRace.wtrlRiders(state.resultsPayload).length;
    log(`Race ${meta.class || '?'} round ${meta.round ?? '?'} — ${wtrlCount} riders, Zwift event ${zid}.`);

    try {
      setProgress(35, 'Asking ZwiftPower for this event…');
      const zp = await chrome.runtime.sendMessage({ type: 'zp-event-results', zid });

      if (!zp || !zp.ok) {
        const why = (zp && zp.error) || 'No response from ZwiftPower.';
        log('ZwiftPower request failed: ' + why);
        setResult(why, 'error');
        ui.actionsEl.hidden = false;
        return { ok: false, error: why };
      }

      const zpRows = (zp.data && zp.data.data) || [];
      log(`ZwiftPower returned ${zpRows.length} riders for this event.`);

      setProgress(75, 'Matching riders…');
      const report = WTRLRace.buildRaceReport({
        wtrlPayload: state.resultsPayload,
        zpRows,
        race: meta,
        extensionVersion: VERSION
      });

      state.lastRace = report;
      await chrome.runtime.sendMessage({ type: 'store-race', report });

      setProgress(100, 'Done.');
      const missed = report.unmatched.length;
      log(`Matched ${report.matchedCount} of ${report.riderCount}.`);
      if (missed) {
        log('No ZwiftPower row for: ' + report.unmatched.map((u) => u.name).join(', '));
      }
      setResult(
        `${report.matchedCount} of ${report.riderCount} riders matched` +
          (missed ? ` — ${missed} not on ZwiftPower.` : '.'),
        missed ? 'warn' : 'ok'
      );
      ui.actionsEl.hidden = false;

      chrome.runtime.sendMessage({ type: 'open-race' });
      return { ok: true, report };
    } catch (error) {
      const why = String(error && error.message ? error.message : error);
      log('Failed: ' + why);
      setResult('Failed: ' + why, 'error');
      ui.actionsEl.hidden = false;
      return { ok: false, error: why };
    } finally {
      state.running = false;
      if (ui) ui.launcher.disabled = false;
    }
  }

  // ================================================================= wiring ===

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'race-ping') {
      sendResponse({ ok: true, hasRace: !!state.resultsPayload });
      return true;
    }
    if (message?.type === 'collect-race') {
      collect().then(sendResponse);
      return true;
    }
    return false;
  });

  function onResultsPage() {
    return /\/zrl\/results/i.test(window.location.pathname);
  }

  function init() {
    if (!onResultsPage() || ui) return;
    buildUi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
