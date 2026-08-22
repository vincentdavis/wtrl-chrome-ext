/** Options page: Coalition API configuration and WTRL endpoint template. */

import { DEFAULTS, getSettings, setSettings, originPattern, uploadUrl } from './settings.js';

const $ = (id) => document.getElementById(id);

function showNote(id, text, kind) {
  const el = $(id);
  el.textContent = text;
  el.className = 'note' + (kind ? ' ' + kind : '');
  el.hidden = false;
}

function currentApiSettings() {
  return {
    apiBaseUrl: $('apiBaseUrl').value.trim() || DEFAULTS.apiBaseUrl,
    apiPath: $('apiPath').value.trim() || DEFAULTS.apiPath,
    apiKey: $('apiKey').value,
    authScheme: $('authScheme').value,
    autoUpload: $('autoUpload').checked
  };
}

async function load() {
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;

  const settings = await getSettings();
  $('apiBaseUrl').value = settings.apiBaseUrl;
  $('apiPath').value = settings.apiPath;
  $('apiKey').value = settings.apiKey;
  $('authScheme').value = settings.authScheme;
  $('autoUpload').checked = settings.autoUpload;
  $('endpointTemplate').value = settings.endpointTemplate || '';

  await refreshPermissionState();
}

async function refreshPermissionState() {
  const settings = currentApiSettings();
  const pattern = originPattern(settings);
  if (!pattern) {
    showNote('apiStatus', 'Base URL is not a valid URL.', 'error');
    return;
  }
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (granted) {
    showNote('apiStatus', `Access to ${pattern} granted. Uploads will POST to ${uploadUrl(settings)}.`, 'ok');
  } else {
    showNote('apiStatus', `Access to ${pattern} not granted yet — press "Connect".`, 'warn');
  }
}

$('save').addEventListener('click', async () => {
  await setSettings(currentApiSettings());
  showNote('apiStatus', 'Settings saved.', 'ok');
  setTimeout(refreshPermissionState, 900);
});

// chrome.permissions.request must be called from a user gesture, hence the button.
$('connect').addEventListener('click', async () => {
  const pattern = originPattern(currentApiSettings());
  if (!pattern) {
    showNote('apiStatus', 'Enter a valid base URL first.', 'error');
    return;
  }
  try {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    showNote(
      'apiStatus',
      granted ? `Access to ${pattern} granted.` : 'Permission request was declined.',
      granted ? 'ok' : 'warn'
    );
  } catch (error) {
    showNote('apiStatus', 'Permission request failed: ' + error.message, 'error');
  }
});

$('test').addEventListener('click', async () => {
  await setSettings(currentApiSettings());
  showNote('apiStatus', 'Testing…', null);
  const probe = {
    generatedAt: new Date().toISOString(),
    source: 'extension-connection-test',
    extensionVersion: chrome.runtime.getManifest().version,
    test: true,
    teamCount: 0,
    riderCount: 0,
    teams: [],
    riders: []
  };
  const response = await chrome.runtime.sendMessage({ type: 'upload', report: probe });
  if (response && response.ok) {
    showNote('apiStatus', `Connection OK (HTTP ${response.status}).`, 'ok');
  } else {
    showNote('apiStatus', (response && response.error) || 'Test failed.', 'error');
  }
});

$('saveTemplate').addEventListener('click', async () => {
  const value = $('endpointTemplate').value.trim();
  await setSettings({ endpointTemplate: value || null });
  showNote('templateStatus', value ? 'Template saved.' : 'Template cleared.', 'ok');
});

$('clearTemplate').addEventListener('click', async () => {
  await setSettings({ endpointTemplate: null });
  $('endpointTemplate').value = '';
  showNote('templateStatus', 'Template forgotten — it will be relearned on the next report.', 'ok');
});

$('clearReport').addEventListener('click', async () => {
  await chrome.storage.local.remove('lastReport');
  showNote('templateStatus', 'Stored report cleared.', 'ok');
});

load();
