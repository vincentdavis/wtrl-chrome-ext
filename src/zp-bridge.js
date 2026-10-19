/**
 * Isolated-world bridge on zwiftpower.com.
 *
 * ZwiftPower's JSON endpoints return 403 to anyone without the signed-in
 * session, and the extension's own service worker cannot borrow that session
 * (its requests count as cross-site, so the session cookie is withheld). So the
 * fetch has to happen on a zwiftpower.com page, exactly as it does on WTRL.
 *
 * This script takes requests from the background worker and hands them to the
 * MAIN-world fetcher in interceptor.js, which issues them as the page itself.
 */
(() => {
  'use strict';

  if (window.__wtrlZpBridgeLoaded) return;
  window.__wtrlZpBridgeLoaded = true;

  const FETCH_TIMEOUT_MS = 30000;
  const pending = new Map();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.__wtrlReport !== true || msg.kind !== 'fetch-result') return;

    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  function pageFetch(path) {
    return new Promise((resolve) => {
      const id = 'zp-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, timedOut: true, error: 'Timed out after 30s' });
      }, FETCH_TIMEOUT_MS);

      pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });

      window.postMessage(
        { __wtrlReportCmd: true, kind: 'fetch', id, url: path, expect: 'json' },
        window.location.origin
      );
    });
  }

  /** Results for one Zwift event: every rider, with real zwids and power. */
  function eventResults(zid) {
    return pageFetch(`/cache3/results/${encodeURIComponent(zid)}_view.json`);
  }

  /** A single rider's full result history, used for career-best power. */
  function riderHistory(zwid) {
    return pageFetch(`/cache3/profile/${encodeURIComponent(zwid)}_all.json`);
  }

  /** Every member of a ZwiftPower club, in one request. */
  function teamRoster(teamId) {
    return pageFetch(`/cache3/teams/${encodeURIComponent(teamId)}_riders.json`);
  }

  /**
   * The signed-in user's own club and Zwift id, read from the site nav.
   *
   * The navbar's "Team" and "Profile" links point at that user's own team and
   * profile, so the ids can be lifted straight out of them. Other team links on
   * the page belong to the event listings, hence the exact-text match.
   */
  function ownContext() {
    const findId = (label, param) => {
      const link = [...document.querySelectorAll('a')].find((a) => {
        const text = (a.textContent || '').trim().toLowerCase();
        const href = a.getAttribute('href') || '';
        return text === label && new RegExp(param + '=\\d+').test(href);
      });
      if (!link) return null;
      const match = (link.getAttribute('href') || '').match(new RegExp(param + '=(\\d+)'));
      return match ? Number(match[1]) : null;
    };

    const teamId = findId('team', 'id');
    const zwid = findId('profile', 'z');
    const teamLink = [...document.querySelectorAll('a')].find(
      (a) => (a.textContent || '').trim().toLowerCase() === 'team'
    );

    return {
      ok: !!teamId,
      teamId,
      zwid,
      teamName: teamLink ? (teamLink.getAttribute('title') || '').trim() || null : null,
      error: teamId ? null : 'No team found on your ZwiftPower account — set the team id in Settings.'
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'zp-ping') {
      sendResponse({ ok: true, origin: window.location.origin });
      return true;
    }
    if (message?.type === 'zp-event-results') {
      eventResults(message.zid).then(sendResponse);
      return true; // async
    }
    if (message?.type === 'zp-rider-history') {
      riderHistory(message.zwid).then(sendResponse);
      return true; // async
    }
    if (message?.type === 'zp-team-roster') {
      teamRoster(message.teamId).then(sendResponse);
      return true; // async
    }
    if (message?.type === 'zp-my-team') {
      sendResponse(ownContext());
      return true;
    }
    return false;
  });
})();
