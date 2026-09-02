/**
 * Isolated-world content script for https://www.wtrl.racing/zrl/myteams/
 *
 * Injects a "Report" control, walks every team panel on the page, collects the
 * team-detail JSON for each one, and assembles a single report of all teams and
 * their riders. Team data is obtained by cooperating with the MAIN-world
 * interceptor (src/interceptor.js): the first team is collected by expanding its
 * accordion panel and capturing the request the site itself makes, which teaches
 * us the endpoint URL; every team after that is fetched directly.
 */
(() => {
  'use strict';

  if (window.__wtrlReportContentLoaded) return;
  window.__wtrlReportContentLoaded = true;

  const VERSION = chrome.runtime.getManifest().version;
  const STORAGE_KEY_TEMPLATE = 'endpointTemplate';
  const DEFAULT_TIMEOUT_MS = 30000;
  const POLITE_DELAY_MS = 400;
  // Bootstrap ignores a toggle click while a collapse transition is running
  // (~350ms), so accordion clicks need a wider gap than the politeness delay.
  const TOGGLE_DELAY_MS = 600;

  // A long roster is a burst of sequential requests, and WTRL starts refusing
  // or stalling part-way through. Retry transient failures, and slow the whole
  // run down as soon as the server shows strain rather than charging on.
  const MAX_ATTEMPTS = 3;
  const RETRY_BASE_MS = 2000;
  const MAX_RETRY_WAIT_MS = 30000;
  const MAX_PACE_MS = 4000;

  const state = {
    endpointTemplate: null,
    captured: new Map(), // trc -> payload
    waiters: new Map(), // trc -> resolve fn
    pendingFetches: new Map(), // request id -> resolve fn
    running: false,
    lastReport: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    paceMs: POLITE_DELAY_MS
  };

  // ===========================================================================
  // Bridge to the MAIN-world interceptor
  // ===========================================================================

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.__wtrlReport !== true) return;

    if (msg.kind === 'team-data') {
      const trc = Number(msg.data?.meta?.trc);
      if (!Number.isFinite(trc)) return;
      state.captured.set(trc, msg.data);
      learnTemplate(msg.url, msg.data);
      const waiter = state.waiters.get(trc);
      if (waiter) {
        state.waiters.delete(trc);
        waiter(msg.data);
      }
      return;
    }

    if (msg.kind === 'fetch-result') {
      const resolve = state.pendingFetches.get(msg.id);
      if (resolve) {
        state.pendingFetches.delete(msg.id);
        resolve(msg);
      }
    }
  });

  function requestId() {
    return 'wtrl-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  /** Ask the MAIN world to fetch a same-origin URL with the page's cookies. */
  function pageFetch(url, timeoutMs) {
    return new Promise((resolve) => {
      const id = requestId();
      const timer = setTimeout(() => {
        state.pendingFetches.delete(id);
        resolve({ ok: false, timedOut: true, error: `Timed out after ${Math.round(timeoutMs / 1000)}s` });
      }, timeoutMs || state.timeoutMs);

      state.pendingFetches.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });

      window.postMessage(
        { __wtrlReportCmd: true, kind: 'fetch', id, url },
        window.location.origin
      );
    });
  }

  // ===========================================================================
  // Endpoint template learning
  // ===========================================================================

  function learnTemplate(url, data) {
    if (state.endpointTemplate) return;
    const template = WTRLFormat.deriveTemplate(url, data);
    if (!template) return;

    state.endpointTemplate = template;
    try {
      chrome.storage.local.set({ [STORAGE_KEY_TEMPLATE]: template });
    } catch (_) {}
    log('Learned endpoint template: ' + template);
  }

  // ===========================================================================
  // Team discovery
  // ===========================================================================

  function discoverTeams() {
    const container = document.querySelector('#teamManagement');
    const panels = (container || document).querySelectorAll('.panel[id^="trc"]');
    const teams = [];

    panels.forEach((panel) => {
      const body = panel.querySelector('.panel-body');
      const heading = panel.querySelector('.panel-heading');
      const titleEl = panel.querySelector('.z-title');

      const trc = Number(
        (body && body.dataset.trc) || panel.id.replace(/[^0-9]/g, '')
      );
      if (!Number.isFinite(trc) || trc === 0) return;

      const seasonRaw = body && body.dataset.season;
      teams.push({
        trc,
        season: seasonRaw !== undefined && seasonRaw !== '' ? Number(seasonRaw) : null,
        name: titleEl ? titleEl.textContent.trim() : 'Team ' + trc,
        panel,
        heading,
        body
      });
    });

    return teams;
  }

  function isExpanded(team) {
    if (team.heading && team.heading.getAttribute('aria-expanded') === 'true') return true;
    const collapse = team.panel.querySelector('.collapse');
    return !!(collapse && collapse.classList.contains('in'));
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ===========================================================================
  // Collection
  // ===========================================================================

  /**
   * Expand a team's accordion panel and wait for the site's own request to be
   * intercepted. Restores the panel's original expanded/collapsed state.
   */
  async function collectByClick(team) {
    if (!team.heading) return { ok: false, error: 'No panel heading found' };

    const wasExpanded = isExpanded(team);
    const settled = new Promise((resolve) => state.waiters.set(team.trc, resolve));

    if (wasExpanded) {
      // Already open: collapse then re-open so the site re-requests the data.
      team.heading.click();
      await wait(TOGGLE_DELAY_MS);
    }
    team.heading.click();

    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), state.timeoutMs);
    });
    const data = await Promise.race([settled, timeout]);
    clearTimeout(timer);
    state.waiters.delete(team.trc);

    // Put the accordion back the way we found it.
    try {
      await wait(TOGGLE_DELAY_MS);
      if (isExpanded(team) !== wasExpanded) team.heading.click();
    } catch (_) {}

    if (!data) return { ok: false, error: 'Timed out waiting for team data' };
    return { ok: true, data };
  }

  /** How long to wait before attempt N+1, honouring Retry-After when given. */
  function retryDelay(attempt, result) {
    if (result && Number.isFinite(result.retryAfter) && result.retryAfter > 0) {
      return Math.min(result.retryAfter * 1000, MAX_RETRY_WAIT_MS);
    }
    const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 500; // avoid lock-step retries
    return Math.min(backoff + jitter, MAX_RETRY_WAIT_MS);
  }

  /** Back the whole run off once the server shows strain; recover gradually. */
  function slowDown() {
    state.paceMs = Math.min(Math.round(state.paceMs * 2), MAX_PACE_MS);
  }

  function speedUp() {
    if (state.paceMs > POLITE_DELAY_MS) {
      state.paceMs = Math.max(POLITE_DELAY_MS, Math.round(state.paceMs * 0.75));
    }
  }

  async function collectTeam(team) {
    if (state.captured.has(team.trc)) {
      return { ok: true, data: state.captured.get(team.trc) };
    }

    let last = null;

    if (state.endpointTemplate) {
      const url = WTRLFormat.renderTemplate(state.endpointTemplate, team);

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const result = await pageFetch(url, state.timeoutMs);
        if (result.ok && result.data) {
          state.captured.set(team.trc, result.data);
          if (attempt > 1) log(`${team.name}: recovered on attempt ${attempt}.`);
          return { ok: true, data: result.data };
        }

        last = result;
        if (!WTRLFormat.isRetryableFailure(result) || attempt === MAX_ATTEMPTS) break;

        slowDown();
        const delay = retryDelay(attempt, result);
        log(
          `${team.name}: ${result.error} — retrying in ${Math.round(delay / 1000)}s ` +
            `(attempt ${attempt + 1} of ${MAX_ATTEMPTS}).`
        );
        setProgress(null, null, `${team.name} failed; waiting ${Math.round(delay / 1000)}s…`);
        await wait(delay);
      }

      log(`${team.name}: direct fetch gave up (${last && last.error}); trying the panel.`);
      slowDown();
    }

    const clicked = await collectByClick(team);
    if (clicked.ok) return clicked;

    // Report whichever failure is more informative.
    return { ok: false, error: last && last.error ? `${last.error} (panel: ${clicked.error})` : clicked.error };
  }

  // ===========================================================================
  // UI
  // ===========================================================================

  // The on-page control is a shortcut to the report table, not a workbench:
  // it opens the table, building one first if none exists yet. Exports live in
  // the toolbar popup, and rebuilding lives in the table itself.

  let ui = null;

  function log(message) {
    if (ui) {
      const line = document.createElement('div');
      line.className = 'wr-log-line';
      line.textContent = message;
      ui.logEl.appendChild(line);
      ui.logEl.scrollTop = ui.logEl.scrollHeight;
    }
    console.log('[WTRL Report]', message);
  }

  function buildUi() {
    const host = document.createElement('div');
    host.id = 'wtrl-report-root';
    const root = host.attachShadow({ mode: 'open' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('src/content.css');
    root.appendChild(link);

    const wrap = document.createElement('div');
    wrap.className = 'wr-wrap';
    wrap.innerHTML = `
      <button class="wr-launcher" type="button" title="Open your team report">
        <span class="wr-launcher-dot"></span> Report
      </button>
      <section class="wr-panel" hidden>
        <header class="wr-panel-head">
          <h2>Team Report</h2>
          <button class="wr-close" type="button" aria-label="Close">&times;</button>
        </header>
        <div class="wr-panel-body">
          <div class="wr-progress" hidden>
            <div class="wr-bar"><div class="wr-bar-fill"></div></div>
            <div class="wr-status">Starting…</div>
          </div>
          <div class="wr-summary" hidden></div>
          <div class="wr-actions" hidden>
            <button class="wr-open wr-btn wr-btn-primary" type="button">Open report</button>
            <button class="wr-retry-failed wr-btn" type="button" hidden>Retry failed teams</button>
            <button class="wr-retry wr-btn" type="button">Rebuild all</button>
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

    const $ = (selector) => wrap.querySelector(selector);
    ui = {
      host,
      wrap,
      panel: $('.wr-panel'),
      launcher: $('.wr-launcher'),
      progress: $('.wr-progress'),
      barFill: $('.wr-bar-fill'),
      statusEl: $('.wr-status'),
      summaryEl: $('.wr-summary'),
      actionsEl: $('.wr-actions'),
      openBtn: $('.wr-open'),
      retryBtn: $('.wr-retry'),
      retryFailedBtn: $('.wr-retry-failed'),
      logEl: $('.wr-log')
    };

    ui.launcher.addEventListener('click', onLauncherClick);
    $('.wr-close').addEventListener('click', () => {
      ui.panel.hidden = true;
    });
    $('.wr-options').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'open-options' });
    });
    ui.openBtn.addEventListener('click', openReport);
    ui.retryBtn.addEventListener('click', () => buildThenOpen());
    ui.retryFailedBtn.addEventListener('click', () => retryFailed());

    return ui;
  }

  function showPanel() {
    if (ui) ui.panel.hidden = false;
  }

  function setProgress(done, total, message) {
    if (!ui) return;
    ui.progress.hidden = false;
    // done/total omitted means "same progress, new status" — don't zero the bar.
    if (done !== null && done !== undefined && total) {
      ui.barFill.style.width = Math.round((done / total) * 100) + '%';
    }
    ui.statusEl.textContent = message;
  }

  function setSummary(text, tone) {
    if (!ui) return;
    ui.summaryEl.hidden = false;
    ui.summaryEl.className = 'wr-summary' + (tone ? ' wr-' + tone : '');
    ui.summaryEl.textContent = text;
  }

  /** Walk a list of teams, collecting each and pacing between them. */
  async function collectAll(teams) {
    const entries = [];
    const failures = [];

    try {
      for (let i = 0; i < teams.length; i += 1) {
        const team = teams[i];
        setProgress(i, teams.length, `Reading ${team.name} (${i + 1} of ${teams.length})…`);

        let result;
        try {
          result = await collectTeam(team);
        } catch (error) {
          result = { ok: false, error: String(error && error.message ? error.message : error) };
        }

        if (result.ok) {
          const riderCount = (result.data.riders || []).length;
          entries.push({ team, data: result.data });
          log(`${team.name}: ${riderCount} rider${riderCount === 1 ? '' : 's'}.`);
          speedUp();
        } else {
          failures.push({ trc: team.trc, teamName: team.name, error: result.error });
          log(`${team.name}: FAILED — ${result.error}`);
        }

        if (i < teams.length - 1) await wait(state.paceMs);
      }
    } finally {
      state.running = false;
      if (ui) ui.launcher.disabled = false;
    }

    setProgress(teams.length, teams.length, 'Done.');
    return { entries, failures };
  }

  // ===========================================================================
  // Actions
  // ===========================================================================

  async function loadRunSettings() {
    state.paceMs = POLITE_DELAY_MS;
    try {
      const stored = await chrome.storage.local.get(['requestTimeoutSeconds']);
      const seconds = Number(stored.requestTimeoutSeconds);
      state.timeoutMs = Number.isFinite(seconds) && seconds >= 5 && seconds <= 180
        ? seconds * 1000
        : DEFAULT_TIMEOUT_MS;
    } catch (_) {
      state.timeoutMs = DEFAULT_TIMEOUT_MS;
    }
  }

  async function hasStoredReport() {
    try {
      const stored = await chrome.storage.local.get(['lastReport']);
      const entry = stored.lastReport;
      return !!(entry && entry.report && (entry.report.riders || []).length);
    } catch (_) {
      return false;
    }
  }

  function openReport() {
    chrome.runtime.sendMessage({ type: 'open-results' });
  }

  /** Build a report, then show it. Used when nothing has been built yet. */
  async function buildThenOpen() {
    showPanel();
    const result = await run();
    if (!result || !result.ok) return; // the panel already explains why

    if (ui) {
      ui.actionsEl.hidden = false;
      ui.retryFailedBtn.hidden = !(result.report.failures || []).length;
    }

    // A partial report is worth showing, but not worth hiding the warning for.
    if (!(result.report.failures || []).length) {
      openReport();
      setTimeout(() => {
        if (ui && !state.running) ui.panel.hidden = true;
      }, 1500);
    }
  }

  async function onLauncherClick() {
    if (state.running) {
      showPanel();
      return;
    }
    if (await hasStoredReport()) {
      openReport();
      return;
    }
    await buildThenOpen();
  }

  async function run() {
    if (state.running) return { ok: false, error: 'A report is already running.' };

    const teams = discoverTeams();
    if (!teams.length) {
      showPanel();
      setSummary(
        'No teams found on this page. Open https://www.wtrl.racing/zrl/myteams/ and try again.',
        'error'
      );
      if (ui) ui.actionsEl.hidden = true;
      return { ok: false, error: 'No teams found on this page' };
    }

    state.running = true;
    state.captured.clear();
    if (ui) {
      ui.panel.hidden = false;
      ui.launcher.disabled = true;
      ui.summaryEl.hidden = true;
      ui.actionsEl.hidden = true;
      ui.logEl.textContent = '';
    }

    await loadRunSettings();

    const stored = await chrome.storage.local.get([STORAGE_KEY_TEMPLATE]);
    if (stored[STORAGE_KEY_TEMPLATE] && !state.endpointTemplate) {
      state.endpointTemplate = stored[STORAGE_KEY_TEMPLATE];
      log('Using saved endpoint template: ' + state.endpointTemplate);
    }

    log(`Found ${teams.length} team${teams.length === 1 ? '' : 's'}.`);

    const { entries, failures } = await collectAll(teams);

    const report = WTRLFormat.buildReport(entries, { failures, extensionVersion: VERSION });
    state.lastReport = report;

    try {
      await chrome.runtime.sendMessage({ type: 'store-report', report });
    } catch (_) {}

    setSummary(
      `${report.teamCount} team${report.teamCount === 1 ? '' : 's'}, ` +
        `${report.riderCount} rider${report.riderCount === 1 ? '' : 's'}` +
        (failures.length ? ` — ${failures.length} team(s) failed, see log.` : '.'),
      failures.length ? 'warn' : 'ok'
    );

    const settings = await chrome.storage.local.get(['autoUpload']);
    if (settings.autoUpload) await sendReport();

    return { ok: true, report };
  }

  /**
   * Re-collect only the teams that failed, folding the results into the report
   * that already exists. Someone who got 18 of 21 teams should not have to
   * re-read all 21 to pick up the missing 3.
   */
  async function retryFailed() {
    if (state.running) return { ok: false, error: 'A report is already running.' };

    const stored = await chrome.storage.local.get(['lastReport']);
    const previous = stored.lastReport && stored.lastReport.report;
    const outstanding = (previous && previous.failures) || [];

    if (!previous) return { ok: false, error: 'No report to retry — build one first.' };
    if (!outstanding.length) return { ok: true, report: previous, retried: 0 };

    const wanted = new Set(outstanding.map((failure) => failure.trc));
    const onPage = discoverTeams();
    const teams = onPage.filter((team) => wanted.has(team.trc));

    if (!teams.length) {
      return {
        ok: false,
        error: 'The failed teams are not on this page — reload My Teams and try again.'
      };
    }

    state.running = true;
    showPanel();
    if (ui) {
      ui.launcher.disabled = true;
      ui.summaryEl.hidden = true;
      ui.actionsEl.hidden = true;
      ui.logEl.textContent = '';
    }

    await loadRunSettings();
    // Start gently: these teams already failed once under normal pacing.
    state.paceMs = Math.min(POLITE_DELAY_MS * 4, MAX_PACE_MS);

    const stored2 = await chrome.storage.local.get([STORAGE_KEY_TEMPLATE]);
    if (stored2[STORAGE_KEY_TEMPLATE] && !state.endpointTemplate) {
      state.endpointTemplate = stored2[STORAGE_KEY_TEMPLATE];
    }

    log(`Retrying ${teams.length} failed team${teams.length === 1 ? '' : 's'}.`);

    const { entries, failures } = await collectAll(teams);

    const addition = WTRLFormat.buildReport(entries, { failures, extensionVersion: VERSION });
    const report = WTRLFormat.mergeReports(
      previous,
      addition,
      onPage.map((team) => team.trc)
    );
    state.lastReport = report;

    try {
      await chrome.runtime.sendMessage({ type: 'store-report', report });
    } catch (_) {}

    const recovered = teams.length - failures.length;
    setSummary(
      `Recovered ${recovered} of ${teams.length} team${teams.length === 1 ? '' : 's'} — ` +
        `${report.teamCount} teams, ${report.riderCount} riders in total` +
        (report.failures.length ? `, ${report.failures.length} still failing.` : '.'),
      report.failures.length ? 'warn' : 'ok'
    );
    if (ui) {
      ui.actionsEl.hidden = false;
      ui.retryFailedBtn.hidden = !report.failures.length;
    }

    return { ok: true, report, retried: teams.length, recovered };
  }

  /**
   * Upload honours the popup's "include rider stats" setting: the stored report
   * always carries the stats (the table needs them), so shape it on the way out.
   */
  async function sendReport() {
    if (!state.lastReport) return;
    log('Sending report to the Coalition app…');

    const settings = await chrome.storage.local.get(['includeStats']);
    const payload = settings.includeStats
      ? state.lastReport
      : WTRLFormat.stripStats(state.lastReport);

    const response = await chrome.runtime.sendMessage({ type: 'upload', report: payload });
    if (response && response.ok) {
      log(`Sent successfully (HTTP ${response.status}).`);
    } else {
      log(`Send failed: ${(response && response.error) || 'unknown error'}`);
    }
  }

  // ===========================================================================
  // Wiring
  // ===========================================================================

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'ping') {
      sendResponse({ ok: true, teams: discoverTeams().length });
      return true;
    }
    if (message?.type === 'run-report') {
      run().then(sendResponse);
      return true; // async response
    }
    if (message?.type === 'retry-failed') {
      retryFailed().then(sendResponse);
      return true; // async response
    }
    return false;
  });

  // The teams accordion is rendered after page load, so watch for it and stop
  // watching as soon as the UI is mounted.
  const observer = new MutationObserver(() => init());

  function init() {
    if (ui) {
      observer.disconnect();
      return;
    }
    if (!document.querySelector('#teamManagement, .panel[id^="trc"]')) return;
    buildUi();
    observer.disconnect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
