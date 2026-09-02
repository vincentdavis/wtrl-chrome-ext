/**
 * Table view over the stored report: search, filter, sort, and group by team.
 *
 * Reads the last report from extension storage; it never talks to WTRL itself.
 */

const $ = (id) => document.getElementById(id);
const MYTEAMS_URL = 'https://www.wtrl.racing/zrl/myteams/';
const ZWIFTPOWER = 'https://zwiftpower.com/profile.php?z=';

/** Column definitions: `get` pulls the sort/filter value, `cell` renders it. */
const COLUMNS = [
  { key: 'name', label: 'Rider', type: 'text' },
  { key: 'zwid', label: 'zwid', type: 'number' },
  { key: 'teamName', label: 'Team', type: 'text', hideWhenGrouped: true },
  { key: 'category', label: 'Cat', type: 'text', align: 'center' },
  { key: 'memberStatus', label: 'Status', type: 'text' },
  { key: 'signedup', label: 'Signed up', type: 'bool', align: 'center' },
  { key: 'appearancesRound', label: 'Races (rd)', type: 'number', align: 'right' },
  { key: 'appearancesSeason', label: 'Races (szn)', type: 'number', align: 'right' },
  { key: 'riderpoints', label: 'Points', type: 'number', align: 'right' },
  { key: 'zftpw', label: 'zFTP W', type: 'number', align: 'right' },
  { key: 'zmapw', label: 'zMAP W', type: 'number', align: 'right' },
  { key: 'teams', label: 'Teams', type: 'number', align: 'right' }
];

const state = {
  report: null,
  multiTeam: new Set(),
  sortKey: 'name',
  sortDir: 1,
  filters: {
    search: '',
    team: '',
    status: '',
    signup: '',
    races: '',
    multiOnly: false
  },
  grouped: true
};

// ============================================================ data loading ===

async function load() {
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
  await loadReport();
}

/** Read the stored report and render it, preserving any active filters. */
async function loadReport() {
  const stored = await chrome.storage.local.get(['lastReport']);
  const entry = stored.lastReport;

  const hasReport = !!(entry && entry.report && (entry.report.riders || []).length);
  $('empty').hidden = hasReport;
  document.querySelector('.tiles').hidden = !hasReport;
  document.querySelector('.toolbar').hidden = !hasReport;
  document.querySelector('.table-wrap').hidden = !hasReport;
  if (!hasReport) return false;

  state.report = entry.report;
  state.multiTeam = WTRLFormat.multiTeamZwids(state.report);

  $('generatedAt').textContent =
    'built ' + new Date(state.report.generatedAt).toLocaleString();

  const failures = state.report.failures || [];
  $('partial').hidden = !failures.length;
  if (failures.length) {
    $('partialText').textContent =
      `Partial report — ${failures.length} team(s) could not be read: ` +
      failures.map((f) => `${f.teamName} (${f.error})`).join('; ') + '. ';
  }

  buildTeamFilter();
  renderTiles();
  renderHead();
  render();
  return true;
}

function buildTeamFilter() {
  const select = $('teamFilter');
  const previous = state.filters.team;
  select.innerHTML = '<option value="">All teams</option>';
  (state.report.teams || []).forEach((team) => {
    const option = document.createElement('option');
    option.value = String(team.trc);
    option.textContent = `${team.teamName} (${team.riders.length})`;
    select.appendChild(option);
  });
  // Keep the chosen team selected across a refresh if it still exists.
  if (previous && select.querySelector(`option[value="${previous}"]`)) {
    select.value = previous;
  } else {
    state.filters.team = '';
    select.value = '';
  }
}

// =================================================================== tiles ===

/** Tiles double as one-click filters for the thing they count. */
const TILES = [
  { key: 'teams', label: 'Teams' },
  { key: 'rosterSpots', label: 'Roster spots' },
  { key: 'uniqueRiders', label: 'Unique riders' },
  { key: 'invited', label: 'Invited, pending', filter: { status: 'INVITED' }, tone: 'warn' },
  { key: 'notSignedUp', label: 'Not signed up', filter: { signup: 'no' } },
  { key: 'noRacesThisSeason', label: 'No races yet', filter: { races: 'none' } },
  { key: 'multiTeam', label: 'On 2+ teams', filter: { multiOnly: true } }
];

function renderTiles() {
  const summary = WTRLFormat.summarise(state.report);
  const container = $('tiles');
  container.innerHTML = '';

  TILES.forEach((tile) => {
    const value = summary[tile.key];
    const el = document.createElement(tile.filter ? 'button' : 'div');
    el.className = 'stat' + (tile.tone ? ' ' + tile.tone : '') + (tile.filter ? ' clickable' : '');
    el.innerHTML = `<div class="value">${value}</div><div class="label">${tile.label}</div>`;
    if (tile.filter) {
      el.title = 'Filter to these';
      el.addEventListener('click', () => {
        resetFilters();
        Object.assign(state.filters, tile.filter);
        syncControls();
        render();
      });
    }
    container.appendChild(el);
  });
}

// =================================================================== table ===

function visibleColumns() {
  return COLUMNS.filter((column) => !(state.grouped && column.hideWhenGrouped));
}

function renderHead() {
  const row = $('head');
  row.innerHTML = '';
  visibleColumns().forEach((column) => {
    const th = document.createElement('th');
    th.textContent = column.label;
    th.className = 'sortable' + (column.align ? ' align-' + column.align : '');
    if (state.sortKey === column.key) {
      th.classList.add('sorted');
      th.textContent = column.label + (state.sortDir === 1 ? ' ▲' : ' ▼');
    }
    th.addEventListener('click', () => {
      if (state.sortKey === column.key) state.sortDir *= -1;
      else {
        state.sortKey = column.key;
        // Numbers are most useful highest-first on the first click.
        state.sortDir = column.type === 'number' ? -1 : 1;
      }
      renderHead();
      render();
    });
    row.appendChild(th);
  });
}

function matches(rider) {
  const f = state.filters;

  if (f.search) {
    const needle = f.search.toLowerCase();
    const haystack = [rider.name, rider.zwid, rider.userId, rider.teamName]
      .map((v) => String(v === undefined || v === null ? '' : v).toLowerCase())
      .join(' ');
    if (!haystack.includes(needle)) return false;
  }
  if (f.team && String(rider.trc) !== f.team) return false;
  if (f.status && rider.memberStatus !== f.status) return false;
  if (f.signup === 'yes' && rider.signedup !== true) return false;
  if (f.signup === 'no' && rider.signedup === true) return false;
  if (f.races === 'none' && rider.appearancesSeason) return false;
  if (f.races === 'some' && !rider.appearancesSeason) return false;
  if (f.multiOnly && !state.multiTeam.has(rider.zwid)) return false;
  return true;
}

function sortRows(rows) {
  const column = COLUMNS.find((c) => c.key === state.sortKey) || COLUMNS[0];
  return rows.slice().sort((a, b) => {
    let av = a[column.key];
    let bv = b[column.key];

    if (column.type === 'number') {
      av = Number(av) || 0;
      bv = Number(bv) || 0;
      return (av - bv) * state.sortDir;
    }
    if (column.type === 'bool') {
      return ((av === true ? 1 : 0) - (bv === true ? 1 : 0)) * state.sortDir;
    }
    return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { sensitivity: 'base' }) * state.sortDir;
  });
}

function cellFor(rider, column) {
  const td = document.createElement('td');
  if (column.align) td.className = 'align-' + column.align;
  const value = rider[column.key];

  if (column.key === 'name') {
    td.className = 'rider-cell';
    const name = document.createElement('span');
    name.className = 'rider-name';
    name.textContent = value ?? '';
    td.appendChild(name);
    if (state.multiTeam.has(rider.zwid)) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'multi-team';
      badge.title = 'This rider is on more than one of your teams';
      td.appendChild(badge);
    }
    return td;
  }

  if (column.key === 'zwid') {
    const link = document.createElement('a');
    link.href = ZWIFTPOWER + encodeURIComponent(String(value));
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = value ?? '';
    td.appendChild(link);
    return td;
  }

  if (column.key === 'memberStatus') {
    const pill = document.createElement('span');
    pill.className = 'pill ' + (value === 'INVITED' ? 'pill-warn' : 'pill-ok');
    pill.textContent = value ?? '—';
    td.appendChild(pill);
    return td;
  }

  if (column.type === 'bool') {
    td.textContent = value === true ? 'yes' : 'no';
    td.classList.add(value === true ? 'yes' : 'no');
    return td;
  }

  td.textContent = value === undefined || value === null || value === '' ? '—' : value;
  return td;
}

function rowFor(rider) {
  const tr = document.createElement('tr');
  if (rider.memberStatus === 'INVITED') tr.className = 'invited';
  visibleColumns().forEach((column) => tr.appendChild(cellFor(rider, column)));
  return tr;
}

function render() {
  const rows = (state.report.riders || []).filter(matches);
  const body = $('body');
  body.innerHTML = '';

  const total = (state.report.riders || []).length;
  $('count').textContent =
    rows.length === total
      ? `${total} roster spots`
      : `${rows.length} of ${total} roster spots`;

  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = visibleColumns().length;
    td.className = 'empty-row';
    td.textContent = 'Nothing matches these filters.';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  if (!state.grouped) {
    sortRows(rows).forEach((rider) => body.appendChild(rowFor(rider)));
    return;
  }

  (state.report.teams || []).forEach((team) => {
    const teamRows = rows.filter((r) => r.trc === team.trc);
    if (!teamRows.length) return;

    const header = document.createElement('tr');
    header.className = 'team-row';
    const cell = document.createElement('td');
    cell.colSpan = visibleColumns().length;
    const invited = teamRows.filter((r) => r.memberStatus === 'INVITED').length;
    cell.innerHTML =
      `<span class="team-name">${escapeHtml(team.teamName)}</span>` +
      `<span class="team-meta">${escapeHtml(team.division || '')}` +
      (team.competitionDivision ? ` · div ${escapeHtml(team.competitionDivision)}` : '') +
      ` · ${teamRows.length} shown` +
      (invited ? ` · ${invited} invited` : '') +
      `</span>`;
    header.appendChild(cell);
    body.appendChild(header);

    sortRows(teamRows).forEach((rider) => body.appendChild(rowFor(rider)));
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// ================================================================ controls ===

function resetFilters() {
  state.filters = { search: '', team: '', status: '', signup: '', races: '', multiOnly: false };
}

function syncControls() {
  $('search').value = state.filters.search;
  $('teamFilter').value = state.filters.team;
  $('statusFilter').value = state.filters.status;
  $('signupFilter').value = state.filters.signup;
  $('racesFilter').value = state.filters.races;
  $('multiOnly').checked = state.filters.multiOnly;
  $('groupByTeam').checked = state.grouped;
}

$('search').addEventListener('input', (e) => {
  state.filters.search = e.target.value.trim();
  render();
});
$('teamFilter').addEventListener('change', (e) => {
  state.filters.team = e.target.value;
  render();
});
$('statusFilter').addEventListener('change', (e) => {
  state.filters.status = e.target.value;
  render();
});
$('signupFilter').addEventListener('change', (e) => {
  state.filters.signup = e.target.value;
  render();
});
$('racesFilter').addEventListener('change', (e) => {
  state.filters.races = e.target.value;
  render();
});
$('multiOnly').addEventListener('change', (e) => {
  state.filters.multiOnly = e.target.checked;
  render();
});
$('groupByTeam').addEventListener('change', (e) => {
  state.grouped = e.target.checked;
  renderHead();
  render();
});
$('reset').addEventListener('click', () => {
  resetFilters();
  syncControls();
  render();
});

// Keyboard: "/" focuses search, Escape clears it.
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== $('search')) {
    event.preventDefault();
    $('search').focus();
  } else if (event.key === 'Escape' && document.activeElement === $('search')) {
    state.filters.search = '';
    syncControls();
    render();
  }
});

// ================================================================= exports ===

function download(filename, mime, body) {
  chrome.runtime.sendMessage({ type: 'download', filename, mime, body });
}

$('exportCsv').addEventListener('click', () => {
  if (!state.report) return;
  const rows = sortRows((state.report.riders || []).filter(matches));
  download(
    WTRLFormat.downloadName(state.report, 'view.csv'),
    'text/csv',
    WTRLFormat.toCsv({ riders: rows })
  );
});

// ================================================================= refresh ===

const MYTEAMS_PATTERNS = [
  'https://www.wtrl.racing/zrl/myteams*',
  'https://wtrl.racing/zrl/myteams*'
];

function setRefreshStatus(text, tone) {
  const el = $('refreshStatus');
  if (!text) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = 'note' + (tone ? ' ' + tone : '');
  el.textContent = text;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until the content script on `tabId` answers, i.e. the page is usable. */
async function waitForContentScript(tabId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
      if (pong && pong.ok && pong.teams) return true;
    } catch (_) {
      // Content script not injected yet — keep waiting.
    }
    await sleep(500);
  }
  return false;
}

/**
 * Drive the content script on a My Teams tab.
 *
 * `kind` is 'run-report' for a full rebuild or 'retry-failed' to re-read only
 * the teams that failed and fold them into the existing report.
 */
async function runOnMyTeamsTab(kind, labels) {
  const buttons = [$('refresh'), $('retryFailed')];
  if (buttons.some((b) => b && b.disabled)) return;
  buttons.forEach((b) => b && (b.disabled = true));

  let openedTab = null;
  try {
    setRefreshStatus('Looking for your WTRL My Teams tab…');
    const existing = await chrome.tabs.query({ url: MYTEAMS_PATTERNS });
    let tab = existing[0] || null;

    if (!tab) {
      setRefreshStatus('Opening WTRL My Teams in the background…');
      // Opened inactive so the user keeps looking at the table.
      tab = await chrome.tabs.create({ url: MYTEAMS_URL, active: false });
      openedTab = tab;
    }

    setRefreshStatus('Waiting for the page to be ready…');
    if (!(await waitForContentScript(tab.id))) {
      setRefreshStatus(
        'Could not reach the My Teams page. Make sure you are signed in to WTRL, then try again.',
        'error'
      );
      return;
    }

    setRefreshStatus(labels.working);
    const result = await chrome.tabs.sendMessage(tab.id, { type: kind });

    if (!result || !result.ok) {
      setRefreshStatus((result && result.error) || labels.failed, 'error');
      return;
    }

    await loadReport();
    syncControls();

    const failed = (result.report.failures || []).length;
    setRefreshStatus(labels.done(result, failed), failed ? 'warn' : 'ok');
  } catch (error) {
    setRefreshStatus(
      labels.failed + ' ' + (error && error.message ? error.message : error),
      'error'
    );
  } finally {
    buttons.forEach((b) => b && (b.disabled = false));
    // Only clean up a tab we opened ourselves.
    if (openedTab) {
      try {
        await chrome.tabs.remove(openedTab.id);
      } catch (_) {}
    }
  }
}

$('refresh').addEventListener('click', () =>
  runOnMyTeamsTab('run-report', {
    working: 'Rebuilding — reading each team in turn. This can take a moment…',
    failed: 'Rebuild failed.',
    done: (result, failed) =>
      `Refreshed — ${result.report.teamCount} teams, ${result.report.riderCount} riders` +
      (failed ? `, ${failed} team(s) still failing.` : '.')
  })
);

$('retryFailed').addEventListener('click', () =>
  runOnMyTeamsTab('retry-failed', {
    working: 'Retrying the failed teams, slowly — this backs off between attempts…',
    failed: 'Retry failed.',
    done: (result, failed) =>
      `Retried ${result.retried} team(s), recovered ${result.recovered ?? 0}` +
      (failed ? `; ${failed} still failing.` : '. Report is now complete.')
  })
);

load();
