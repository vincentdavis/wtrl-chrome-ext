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
  const TEAM_TIMEOUT_MS = 20000;
  const POLITE_DELAY_MS = 350;
  // Bootstrap ignores a toggle click while a collapse transition is running
  // (~350ms), so accordion clicks need a wider gap than the politeness delay.
  const TOGGLE_DELAY_MS = 600;

  const state = {
    endpointTemplate: null,
    captured: new Map(), // trc -> payload
    waiters: new Map(), // trc -> resolve fn
    pendingFetches: new Map(), // request id -> resolve fn
    running: false,
    lastReport: null
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
  function pageFetch(url, timeoutMs = TEAM_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const id = requestId();
      const timer = setTimeout(() => {
        state.pendingFetches.delete(id);
        resolve({ ok: false, error: 'Timed out' });
      }, timeoutMs);

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
      timer = setTimeout(() => resolve(null), TEAM_TIMEOUT_MS);
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

  async function collectTeam(team) {
    if (state.captured.has(team.trc)) {
      return { ok: true, data: state.captured.get(team.trc) };
    }

    if (state.endpointTemplate) {
      const url = WTRLFormat.renderTemplate(state.endpointTemplate, team);
      const result = await pageFetch(url);
      if (result.ok && result.data) {
        state.captured.set(team.trc, result.data);
        return { ok: true, data: result.data };
      }
      log(`Direct fetch failed for ${team.name} (${result.error}); falling back to panel click.`);
    }

    return collectByClick(team);
  }

  // ===========================================================================
  // UI
  // ===========================================================================

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
      <button class="wr-launcher" type="button" title="Build a report of all your teams">
        <span class="wr-launcher-dot"></span> Report
      </button>
      <section class="wr-panel" hidden>
        <header class="wr-panel-head">
          <h2>Team Report</h2>
          <button class="wr-close" type="button" aria-label="Close">&times;</button>
        </header>
        <div class="wr-panel-body">
          <p class="wr-intro">Opens every team on this page and collects its riders into one report.</p>
          <label class="wr-check">
            <input type="checkbox" class="wr-stats"> Include rider stats (category, zFTP, zMAP, points)
          </label>
          <div class="wr-actions">
            <button class="wr-run wr-btn wr-btn-primary" type="button">Build report</button>
          </div>
          <div class="wr-progress" hidden>
            <div class="wr-bar"><div class="wr-bar-fill"></div></div>
            <div class="wr-status">Starting…</div>
          </div>
          <div class="wr-summary" hidden></div>
          <div class="wr-results" hidden>
            <div class="wr-actions">
              <button class="wr-copy wr-btn" type="button">Copy JSON</button>
              <button class="wr-json wr-btn" type="button">Download JSON</button>
              <button class="wr-csv wr-btn" type="button">Download CSV</button>
              <button class="wr-send wr-btn" type="button">Send to Coalition</button>
            </div>
            <pre class="wr-preview"></pre>
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
      runBtn: $('.wr-run'),
      statsToggle: $('.wr-stats'),
      progress: $('.wr-progress'),
      barFill: $('.wr-bar-fill'),
      statusEl: $('.wr-status'),
      summaryEl: $('.wr-summary'),
      resultsEl: $('.wr-results'),
      previewEl: $('.wr-preview'),
      logEl: $('.wr-log')
    };

    $('.wr-launcher').addEventListener('click', () => {
      ui.panel.hidden = !ui.panel.hidden;
    });
    $('.wr-close').addEventListener('click', () => {
      ui.panel.hidden = true;
    });
    $('.wr-options').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'open-options' });
    });
    ui.runBtn.addEventListener('click', () => {
      run({ includeStats: ui.statsToggle.checked });
    });
    $('.wr-copy').addEventListener('click', copyReport);
    $('.wr-json').addEventListener('click', () => downloadReport('json'));
    $('.wr-csv').addEventListener('click', () => downloadReport('csv'));
    $('.wr-send').addEventListener('click', sendReport);

    return ui;
  }

  function setProgress(done, total, message) {
    if (!ui) return;
    ui.progress.hidden = false;
    const pct = total ? Math.round((done / total) * 100) : 0;
    ui.barFill.style.width = pct + '%';
    ui.statusEl.textContent = message;
  }

  // ===========================================================================
  // Actions
  // ===========================================================================

  async function run(options = {}) {
    if (state.running) return { ok: false, error: 'A report is already running.' };

    const teams = discoverTeams();
    if (!teams.length) {
      if (ui) {
        ui.panel.hidden = false;
        ui.summaryEl.hidden = false;
        ui.summaryEl.className = 'wr-summary wr-error';
        ui.summaryEl.textContent =
          'No teams found on this page. Open https://www.wtrl.racing/zrl/myteams/ and try again.';
      }
      return { ok: false, error: 'No teams found on this page' };
    }

    state.running = true;
    state.captured.clear();
    if (ui) {
      ui.panel.hidden = false;
      ui.runBtn.disabled = true;
      ui.resultsEl.hidden = true;
      ui.summaryEl.hidden = true;
      ui.logEl.textContent = '';
    }

    const stored = await chrome.storage.local.get([STORAGE_KEY_TEMPLATE]);
    if (stored[STORAGE_KEY_TEMPLATE] && !state.endpointTemplate) {
      state.endpointTemplate = stored[STORAGE_KEY_TEMPLATE];
      log('Using saved endpoint template: ' + state.endpointTemplate);
    }

    log(`Found ${teams.length} team${teams.length === 1 ? '' : 's'}.`);

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
        } else {
          failures.push({ trc: team.trc, teamName: team.name, error: result.error });
          log(`${team.name}: FAILED — ${result.error}`);
        }

        if (i < teams.length - 1) await wait(POLITE_DELAY_MS);
      }
    } finally {
      state.running = false;
      if (ui) ui.runBtn.disabled = false;
    }

    setProgress(teams.length, teams.length, 'Done.');

    const report = WTRLFormat.buildReport(entries, {
      includeStats: !!options.includeStats,
      failures,
      extensionVersion: VERSION
    });
    state.lastReport = report;

    try {
      await chrome.runtime.sendMessage({ type: 'store-report', report });
    } catch (_) {}

    if (ui) {
      ui.summaryEl.hidden = false;
      ui.summaryEl.className = 'wr-summary' + (failures.length ? ' wr-warn' : ' wr-ok');
      ui.summaryEl.textContent =
        `${report.teamCount} team${report.teamCount === 1 ? '' : 's'}, ` +
        `${report.riderCount} rider${report.riderCount === 1 ? '' : 's'}` +
        (failures.length ? ` — ${failures.length} team(s) failed, see log.` : '.');
      ui.resultsEl.hidden = false;
      ui.previewEl.textContent = JSON.stringify(report, null, 2);
    }

    const settings = await chrome.storage.local.get(['autoUpload']);
    if (settings.autoUpload) await sendReport();

    return { ok: true, report };
  }

  async function copyReport() {
    if (!state.lastReport) return;
    const text = JSON.stringify(state.lastReport, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      log('Report copied to clipboard.');
    } catch (_) {
      // Clipboard API can be blocked; fall back to a hidden textarea.
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      log('Report copied to clipboard (fallback).');
    }
  }

  /** Last-resort save path if the downloads API rejects the payload. */
  function saveViaBlob(filename, mime, body) {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function downloadReport(format) {
    if (!state.lastReport) return;

    const isCsv = format === 'csv';
    const label = isCsv ? 'CSV' : 'JSON';
    const filename = WTRLFormat.downloadName(state.lastReport, isCsv ? 'csv' : 'json');
    const mime = isCsv ? 'text/csv' : 'application/json';
    const body = isCsv
      ? WTRLFormat.toCsv(state.lastReport)
      : JSON.stringify(state.lastReport, null, 2);

    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'download', filename, mime, body });
    } catch (error) {
      response = { ok: false, error: String(error && error.message ? error.message : error) };
    }

    if (response && response.ok) {
      log(`Download started (${label}).`);
      return;
    }
    log(`Downloads API failed (${(response && response.error) || 'unknown'}); saving directly.`);
    saveViaBlob(filename, mime, body);
  }

  async function sendReport() {
    if (!state.lastReport) return;
    log('Sending report to the Coalition app…');
    const response = await chrome.runtime.sendMessage({
      type: 'upload',
      report: state.lastReport
    });
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
      run({ includeStats: !!message.includeStats }).then(sendResponse);
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
