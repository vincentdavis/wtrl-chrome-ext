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
        case 'upload':
          sendResponse(await handleUpload(message.report));
          break;
        case 'open-options':
          chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
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
