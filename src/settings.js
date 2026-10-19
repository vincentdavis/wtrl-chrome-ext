/** Shared settings shape for the background worker, popup and options page. */

export const DEFAULTS = {
  apiBaseUrl: 'https://app.coalitionracing.com',
  apiPath: '/api/wtrl/team-report',
  apiKey: '',
  authScheme: 'bearer', // 'bearer' | 'x-api-key'
  autoUpload: false,
  includeStats: false,
  endpointTemplate: null,
  requestTimeoutSeconds: 30,
  zwiftPowerTeamId: null,
  heatPalette: 'viridis'
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}

/** Full upload URL, or null when the configuration is incomplete. */
export function uploadUrl(settings) {
  const base = (settings.apiBaseUrl || '').trim().replace(/\/+$/, '');
  const path = (settings.apiPath || '').trim();
  if (!base || !path) return null;
  return base + (path.startsWith('/') ? path : '/' + path);
}

/** Origin pattern to request as an optional host permission. */
export function originPattern(settings) {
  try {
    return new URL(settings.apiBaseUrl).origin + '/*';
  } catch (_) {
    return null;
  }
}
