/**
 * MV3 service worker.
 *
 * Holds the last report, performs downloads, and is the only place the
 * Coalition API key is ever read — it never enters the wtrl.racing page context.
 */

import { getSettings, uploadUrl, originPattern } from './settings.js';

const LAST_REPORT_KEY = 'lastReport';

/** data: URL for a text payload, chunked so large reports don't blow the stack. */
function toDataUrl(mime, text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};charset=utf-8;base64,${btoa(binary)}`;
}

async function handleDownload(message) {
  const url = toDataUrl(message.mime || 'application/json', message.body || '');
  const downloadId = await chrome.downloads.download({
    url,
    filename: message.filename || 'wtrl-team-report.json',
    saveAs: false
  });
  return { ok: true, downloadId };
}

async function handleStoreReport(report) {
  await chrome.storage.local.set({
    [LAST_REPORT_KEY]: {
      generatedAt: report.generatedAt,
      teamCount: report.teamCount,
      riderCount: report.riderCount,
      failures: report.failures || [],
      report
    }
  });
  return { ok: true };
}

/**
 * Show the report table, reusing a tab that already has it open.
 *
 * A run calls this twice — once when the first team lands, once when it
 * finishes — so creating a tab unconditionally would leave duplicates behind.
 */
const openResults = () => openPage('src/results.html');

async function openPage(relativePath) {
  const url = chrome.runtime.getURL(relativePath);
  const existing = await chrome.tabs.query({ url });

  if (existing.length) {
    const tab = existing[0];
    await chrome.tabs.update(tab.id, { active: true });
    try {
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch (_) {
      // Window may not be focusable (e.g. minimised); the tab is still selected.
    }
    return { ok: true, tabId: tab.id, reused: true };
  }

  const tab = await chrome.tabs.create({ url });
  return { ok: true, tabId: tab.id, reused: false };
}

// --------------------------------------------------------- ZwiftPower ------

const ZWIFTPOWER_PATTERNS = ['https://zwiftpower.com/*', 'https://www.zwiftpower.com/*'];
const ZWIFTPOWER_HOME = 'https://zwiftpower.com/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Get a zwiftpower.com tab whose bridge is answering.
 *
 * The WTRL results page cannot fetch ZwiftPower itself (different origin), and
 * this worker cannot either (its requests are cross-site, so ZwiftPower
 * withholds the session cookie and answers 403). A real ZwiftPower tab is the
 * only context that has the session, so we borrow one — reusing a tab the user
 * already has open, or opening a background one we clean up afterwards.
 */
async function ensureZwiftPowerTab() {
  const existing = await chrome.tabs.query({ url: ZWIFTPOWER_PATTERNS });

  for (const tab of existing) {
    try {
      const pong = await chrome.tabs.sendMessage(tab.id, { type: 'zp-ping' });
      if (pong && pong.ok) return { tabId: tab.id, opened: false };
    } catch (_) {
      // Tab exists but the bridge has not loaded; fall through and keep looking.
    }
  }

  const tab = await chrome.tabs.create({ url: ZWIFTPOWER_HOME, active: false });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await sleep(500);
    try {
      const pong = await chrome.tabs.sendMessage(tab.id, { type: 'zp-ping' });
      if (pong && pong.ok) return { tabId: tab.id, opened: true };
    } catch (_) {
      // Still loading.
    }
  }

  try {
    await chrome.tabs.remove(tab.id);
  } catch (_) {}
  return { error: 'Could not open ZwiftPower. Open zwiftpower.com, sign in, and try again.' };
}

/** Run one ZwiftPower request through a borrowed tab, then tidy up. */
async function viaZwiftPower(message) {
  const slot = await ensureZwiftPowerTab();
  if (slot.error) return { ok: false, error: slot.error };

  try {
    const result = await chrome.tabs.sendMessage(slot.tabId, message);
    if (result && result.ok) return result;

    const status = result && result.status;
    if (status === 403 || status === 401) {
      return {
        ok: false,
        status,
        error: 'ZwiftPower refused the request — open zwiftpower.com and sign in, then retry.'
      };
    }
    return result || { ok: false, error: 'No response from ZwiftPower.' };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  } finally {
    if (slot.opened) {
      try {
        await chrome.tabs.remove(slot.tabId);
      } catch (_) {}
    }
  }
}

async function handleUpload(report) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    return { ok: false, error: 'No API key set. Open the extension settings first.' };
  }

  const url = uploadUrl(settings);
  if (!url) return { ok: false, error: 'Incomplete API configuration.' };

  const pattern = originPattern(settings);
  if (pattern) {
    const granted = await chrome.permissions.contains({ origins: [pattern] });
    if (!granted) {
      return {
        ok: false,
        error: `Permission for ${pattern} has not been granted. Open settings and press "Connect".`
      };
    }
  }

  const headers = { 'Content-Type': 'application/json' };
  if (settings.authScheme === 'x-api-key') {
    headers['X-API-Key'] = settings.apiKey;
  } else {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(report)
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true, status: response.status, body: text.slice(0, 2000) };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'download':
          sendResponse(await handleDownload(message));
          break;
        case 'store-report':
          sendResponse(await handleStoreReport(message.report));
          break;
        case 'store-race':
          await chrome.storage.local.set({
            lastRace: {
              generatedAt: message.report.generatedAt,
              race: message.report.race,
              riderCount: message.report.riderCount,
              matchedCount: message.report.matchedCount,
              report: message.report
            }
          });
          sendResponse({ ok: true });
          break;
        case 'upload':
          sendResponse(await handleUpload(message.report));
          break;
        case 'open-options':
          chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          break;
        case 'open-results':
          sendResponse(await openResults());
          break;
        case 'zp-event-results':
          sendResponse(await viaZwiftPower({ type: 'zp-event-results', zid: message.zid }));
          break;
        case 'zp-rider-history':
          sendResponse(await viaZwiftPower({ type: 'zp-rider-history', zwid: message.zwid }));
          break;
        case 'open-race':
          sendResponse(await openPage('src/race.html'));
          break;
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (error) {
      sendResponse({ ok: false, error: String(error && error.message ? error.message : error) });
    }
  })();
  return true; // keep the channel open for the async response
});
