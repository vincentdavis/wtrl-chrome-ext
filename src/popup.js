/** Popup: run a report on the active My Teams tab and act on the last result. */

import { getSettings, setSettings } from './settings.js';

const $ = (id) => document.getElementById(id);
const MYTEAMS_URL = 'https://www.wtrl.racing/zrl/myteams/';

let activeTabId = null;
let lastReport = null;

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text;
  el.className = 'note' + (kind ? ' ' + kind : '');
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

/** Ask the content script whether it is present and how many teams it can see. */
async function pingContentScript(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'ping' });
  } catch (_) {
    return null;
  }
}

function renderLastReport(entry) {
  if (!entry || !entry.report) {
    $('last').hidden = true;
    return;
  }
  lastReport = entry.report;
  $('teamCount').textContent = entry.teamCount ?? 0;
  $('riderCount').textContent = entry.riderCount ?? 0;
  $('generatedAt').textContent = 'Generated ' + new Date(entry.generatedAt).toLocaleString();
  $('last').hidden = false;
}

async function init() {
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;

  const settings = await getSettings();
  $('includeStats').checked = !!settings.includeStats;
  $('includeStats').addEventListener('change', (event) => {
    setSettings({ includeStats: event.target.checked });
  });

  const stored = await chrome.storage.local.get(['lastReport']);
  renderLastReport(stored.lastReport);

  const tab = await activeTab();
  if (!tab) {
    setStatus('No active tab.', 'warn');
    return;
  }
  activeTabId = tab.id;

  const pong = await pingContentScript(tab.id);
  if (!pong) {
    setStatus('Open your WTRL My Teams page, then reopen this popup.', 'warn');
    return;
  }
  if (!pong.teams) {
    setStatus('Connected, but no team panels are visible on this page yet.', 'warn');
    $('run').disabled = false;
    return;
  }
  setStatus(`Ready — ${pong.teams} team${pong.teams === 1 ? '' : 's'} detected on this page.`, 'ok');
  $('run').disabled = false;
}

$('run').addEventListener('click', async () => {
  if (activeTabId === null) return;
  $('run').disabled = true;
  setStatus('Building report… you can watch progress on the page.', null);
  try {
    const result = await chrome.tabs.sendMessage(activeTabId, {
      type: 'run-report',
      includeStats: $('includeStats').checked
    });
    if (result && result.ok) {
      setStatus(
        `Done — ${result.report.teamCount} teams, ${result.report.riderCount} riders.`,
        'ok'
      );
      const stored = await chrome.storage.local.get(['lastReport']);
      renderLastReport(stored.lastReport);
    } else {
      setStatus((result && result.error) || 'Report failed.', 'error');
    }
  } catch (error) {
    setStatus('Report failed: ' + error.message, 'error');
  }
  $('run').disabled = false;
});

$('open').addEventListener('click', () => {
  chrome.tabs.create({ url: MYTEAMS_URL });
});

$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

/** The stored report always has stats; the toggle decides what leaves here. */
function exportable() {
  if (!lastReport) return null;
  return $('includeStats').checked ? lastReport : WTRLFormat.stripStats(lastReport);
}

$('table').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'open-results' });
  window.close();
});

$('json').addEventListener('click', () => {
  if (!lastReport) return;
  chrome.runtime.sendMessage({
    type: 'download',
    filename: WTRLFormat.downloadName(lastReport, 'json'),
    mime: 'application/json',
    body: JSON.stringify(exportable(), null, 2)
  });
});

$('csv').addEventListener('click', () => {
  if (!lastReport) return;
  chrome.runtime.sendMessage({
    type: 'download',
    filename: WTRLFormat.downloadName(lastReport, 'csv'),
    mime: 'text/csv',
    body: WTRLFormat.toCsv(exportable())
  });
});

$('copy').addEventListener('click', async () => {
  if (!lastReport) return;
  await navigator.clipboard.writeText(JSON.stringify(exportable(), null, 2));
  setStatus('Report JSON copied to clipboard.', 'ok');
});

$('send').addEventListener('click', async () => {
  if (!lastReport) return;
  setStatus('Sending to the Coalition app…', null);
  const response = await chrome.runtime.sendMessage({ type: 'upload', report: exportable() });
  if (response && response.ok) {
    setStatus(`Sent successfully (HTTP ${response.status}).`, 'ok');
  } else {
    setStatus((response && response.error) || 'Send failed.', 'error');
  }
});

init();
