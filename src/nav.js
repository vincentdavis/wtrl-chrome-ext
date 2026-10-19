/**
 * Shared navigation across the extension's pages.
 *
 * There are several places to be — the roster report, a race's power table,
 * settings — plus the two WTRL pages the data comes from. Without this, each
 * page was a dead end reachable only from the toolbar popup.
 *
 * Each entry says whether its data exists yet, so the nav doubles as an answer
 * to "have I collected this?" rather than leading to an empty page.
 */
(function (root) {
  'use strict';

  const WTRL_MYTEAMS = 'https://www.wtrl.racing/zrl/myteams/';
  const WTRL_RESULTS = 'https://www.wtrl.racing/zrl/results/';

  const PAGES = [
    {
      key: 'roster',
      label: 'Team roster',
      page: 'src/results.html',
      storageKey: 'lastReport',
      empty: 'Not built yet — open My Teams and press Report',
      describe: (entry) =>
        `${entry.teamCount} team${entry.teamCount === 1 ? '' : 's'}, ${entry.riderCount} riders`
    },
    {
      key: 'race',
      label: 'Race power',
      page: 'src/race.html',
      storageKey: 'lastRace',
      empty: 'Not collected yet — open a race and press Power',
      describe: (entry) => {
        const race = entry.race || {};
        return `${race.class || 'division'} round ${race.round ?? '?'}`;
      }
    }
  ];

  function timeAgo(iso) {
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return '';
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  async function mount(container, activeKey) {
    if (!container) return;

    const stored = await chrome.storage.local.get(PAGES.map((p) => p.storageKey));

    const nav = document.createElement('nav');
    nav.className = 'wtrl-nav';

    PAGES.forEach((page) => {
      const entry = stored[page.storageKey];
      const has = !!(entry && entry.report);

      const item = document.createElement(page.key === activeKey ? 'span' : 'button');
      item.className = 'nav-item' + (page.key === activeKey ? ' active' : '');
      if (!has) item.classList.add('nav-empty');

      item.innerHTML =
        `<span class="nav-label">${page.label}</span>` +
        `<span class="nav-sub">${
          has ? `${escapeHtml(page.describe(entry))} · ${timeAgo(entry.generatedAt)}` : page.empty
        }</span>`;

      if (page.key !== activeKey) {
        item.type = 'button';
        item.addEventListener('click', () => {
          chrome.tabs.create({ url: chrome.runtime.getURL(page.page) });
        });
      }
      nav.appendChild(item);
    });

    const spacer = document.createElement('span');
    spacer.className = 'nav-spacer';
    nav.appendChild(spacer);

    // Where the data comes from, so a stale page has an obvious next step.
    [
      { label: 'My Teams ↗', url: WTRL_MYTEAMS, title: 'Build or rebuild the team roster' },
      { label: 'Results ↗', url: WTRL_RESULTS, title: 'Pick a race to collect power for' }
    ].forEach((link) => {
      const a = document.createElement('button');
      a.type = 'button';
      a.className = 'nav-link';
      a.textContent = link.label;
      a.title = link.title;
      a.addEventListener('click', () => chrome.tabs.create({ url: link.url }));
      nav.appendChild(a);
    });

    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'nav-link' + (activeKey === 'settings' ? ' active' : '');
    settings.textContent = 'Settings';
    settings.addEventListener('click', () => chrome.runtime.openOptionsPage());
    nav.appendChild(settings);

    container.appendChild(nav);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  }

  root.WTRLNav = { mount, PAGES, WTRL_MYTEAMS, WTRL_RESULTS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
