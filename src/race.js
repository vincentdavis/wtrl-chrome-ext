/** Race power table: every rider in the race with their ZwiftPower curve. */

const $ = (id) => document.getElementById(id);
const ZWIFTPOWER_PROFILE = 'https://zwiftpower.com/profile.php?z=';

const state = {
  report: null,
  filters: { search: '', team: '', cat: '', matchedOnly: true },
  showWatts: false,
  sortKey: 'position',
  sortDir: 1,
  careerCache: new Map(),
  palette: WTRLHeat.DEFAULT_PALETTE,
  view: 'rider',          // 'rider' | 'team'
  teamSort: 'position',
  teamSortDir: 1,
  leagueSort: 'rank',
  leagueSortDir: 1,
  expanded: new Set()
};

/**
 * Team view: WTRL's own scoring beside ZwiftPower averages for the same team.
 *
 * Averages cover only the riders who matched a ZwiftPower row — the Power
 * column says how many that was, so a thin average is visible rather than
 * silently flattering or penalising a team.
 */
const TEAM_COLUMNS = [
  { key: 'position', label: '#', type: 'number', align: 'right' },
  { key: 'teamName', label: 'Team', type: 'text' },
  { key: 'riderCount', label: 'Riders', type: 'number', align: 'right' },
  { key: 'matchedCount', label: 'Power', type: 'number', align: 'right' },
  { key: 'points.total', label: 'Points', type: 'number', align: 'right', heat: true },
  { key: 'avg.avgWkg', label: 'Avg w/kg', type: 'number', align: 'right' },
  { key: 'avg.wkg20m', label: 'Avg 20m', type: 'number', align: 'right' },
  { key: 'avg.wkg5m', label: 'Avg 5m', type: 'number', align: 'right' },
  { key: 'avg.wkg1m', label: 'Avg 1m', type: 'number', align: 'right' },
  { key: 'avg.wkg15s', label: 'Avg 15s', type: 'number', align: 'right' },
  { key: 'best.wkg20m', label: 'Best 20m', type: 'number', align: 'right' },
  { key: 'avg.ftpW', label: 'Avg FTP', type: 'number', align: 'right' },
  { key: 'avg.weightKg', label: 'Avg kg', type: 'number', align: 'right' }
];

const dig = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

/**
 * League table: the division's season standings.
 *
 * The per-round columns are built from however many rounds have been raced,
 * so an early season does not show a wall of empty columns.
 */
function leagueColumns() {
  const rounds = WTRLRace.roundsPlayed(state.report ? state.report.league : []);
  const roundCols = [];
  for (let i = 0; i < rounds; i += 1) {
    roundCols.push({
      key: 'round.' + i,
      label: 'R' + (i + 1),
      type: 'number',
      align: 'right',
      heat: true,
      round: i,
      title: `League points from round ${i + 1}`
    });
  }

  return [
    { key: 'rank', label: '#', type: 'number', align: 'right' },
    { key: 'teamName', label: 'Team', type: 'text' },
    { key: 'roundsRaced', label: 'Raced', type: 'number', align: 'right' }
  ]
    .concat(roundCols)
    .concat([
      { key: 'leaguePoints', label: 'League pts', type: 'number', align: 'right', heat: true,
        title: 'Standing points, after any penalty' },
      { key: 'penalty', label: 'Pen', type: 'number', align: 'right',
        title: 'Points deducted' },
      { key: 'falPoints', label: 'FAL', type: 'number', align: 'right', heat: true,
        title: 'Season first-across-the-line points' },
      { key: 'ftsPoints', label: 'FTS', type: 'number', align: 'right', heat: true,
        title: 'Season fastest-through-segment points' },
      { key: 'finPoints', label: 'FIN', type: 'number', align: 'right', heat: true,
        title: 'Season finish points' },
      { key: 'pbpPoints', label: 'PBP', type: 'number', align: 'right', heat: true },
      { key: 'racePoints', label: 'Race pts', type: 'number', align: 'right', heat: true,
        title: 'FAL + FTS + FIN + PBP across the season' }
    ]);
}

const leagueValue = (row, column) =>
  column.round !== undefined ? row.roundPoints[column.round] : dig(row, column.key);

const BASE_COLUMNS = [
  { key: 'position', label: '#', type: 'number', align: 'right' },
  { key: 'name', label: 'Rider', type: 'text' },
  { key: 'zrlTeam', label: 'ZRL team', type: 'text' },
  { key: 'category', label: 'Cat', type: 'text', align: 'center' },
  { key: 'falPoints', label: 'FAL', type: 'number', align: 'right', heat: true,
    title: 'First across the line' },
  { key: 'ftsPoints', label: 'FTS', type: 'number', align: 'right', heat: true,
    title: 'Fastest through segment' },
  { key: 'finPoints', label: 'FIN', type: 'number', align: 'right', heat: true,
    title: 'Finish' },
  { key: 'pbpPoints', label: 'PBP', type: 'number', align: 'right', heat: true,
    title: 'Points by position' },
  { key: 'totalPoints', label: 'Pts', type: 'number', align: 'right', heat: true,
    title: 'Total ZRL points for this race' },
  // kg is shaded on request. Unlike the rest, its colour reads as magnitude,
  // not merit — a heavier rider is not a better one.
  { key: 'weightKg', label: 'kg', type: 'number', align: 'right', heat: true,
    title: 'Weight — colour shows heavier vs lighter, not better vs worse' },
  { key: 'raceFtpW', label: 'FTP W', type: 'number', align: 'right', heat: true,
    title: 'FTP for this race, from ZwiftPower' },
  { key: 'normalisedPowerW', label: 'NP', type: 'number', align: 'right', heat: true,
    title: 'Normalised power' },
  { key: 'avgWkg', label: 'Avg w/kg', type: 'number', align: 'right', heat: true,
    title: 'Average watts per kilogram across the race' }
];

const durations = () => (window.WTRLRace ? WTRLRace.DURATIONS : []);

function columns() {
  return BASE_COLUMNS.concat(
    durations().map((d) => ({
      key: 'curve_' + d.key,
      label: d.label,
      type: 'number',
      align: 'right',
      heat: true,
      duration: d.key
    }))
  );
}

const displayName = (r) => r.zpName || r.name;
const curveAt = (r, seconds) => (r.powerCurve || []).find((p) => p.seconds === seconds) || null;

function valueFor(rider, column) {
  if (column.duration) {
    const p = curveAt(rider, column.duration);
    if (!p) return null;
    return state.showWatts ? p.watts : p.wkg;
  }
  if (column.key === 'name') return displayName(rider);
  return rider[column.key];
}

// ============================================================ data loading ===

async function load() {
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
  WTRLNav.mount(document.getElementById('navHost'), 'race');

  const stored = await chrome.storage.local.get(['lastRace', 'heatPalette']);
  if (stored.heatPalette && WTRLHeat.paletteNames().includes(stored.heatPalette)) {
    state.palette = stored.heatPalette;
  }
  buildPalettePicker();

  const entry = stored.lastRace;

  const has = !!(entry && entry.report && (entry.report.riders || []).length);
  $('empty').hidden = has;
  ['.tiles', '.toolbar', '.table-wrap'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.hidden = !has;
  });
  if (!has) return;

  state.report = entry.report;
  const race = state.report.race || {};
  $('raceMeta').textContent =
    `${race.class || 'division'} · round ${race.round ?? '?'} · Zwift event ${race.zid ?? '?'} · ` +
    new Date(state.report.generatedAt).toLocaleString();

  const missed = state.report.unmatched || [];
  $('unmatched').hidden = !missed.length;
  if (missed.length) {
    $('unmatched').textContent =
      `${missed.length} rider(s) have no ZwiftPower row for this event and so have no power data: ` +
      missed.map((u) => u.name).join(', ') + '.';
  }

  $('viewLeague').disabled = !(state.report.league || []).length;
  $('viewLeague').title = $('viewLeague').disabled
    ? 'No league standings collected for this division'
    : 'Season standings for this division';

  buildFilters();
  renderTiles();
  renderHead();
  render();
}

function buildFilters() {
  const riders = state.report.riders || [];

  const teams = [...new Set(riders.map((r) => r.zrlTeam).filter(Boolean))].sort();
  $('teamFilter').innerHTML =
    '<option value="">All teams</option>' +
    teams.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');

  const cats = [...new Set(riders.map((r) => r.category).filter(Boolean))].sort();
  $('catFilter').innerHTML =
    '<option value="">All categories</option>' +
    cats.map((c) => `<option value="${escapeHtml(String(c))}">${escapeHtml(String(c))}</option>`).join('');
}

// =================================================================== tiles ===

function renderTiles() {
  const riders = state.report.riders || [];
  const matched = riders.filter((r) => r.matched);
  const avg = (fn) => {
    const vals = matched.map(fn).filter((v) => typeof v === 'number' && Number.isFinite(v));
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : '—';
  };
  const best = (seconds) => {
    const vals = matched.map((r) => (curveAt(r, seconds) || {}).wkg).filter((v) => typeof v === 'number');
    return vals.length ? Math.max(...vals).toFixed(1) : '—';
  };

  const tiles = [
    { value: riders.length, label: 'Riders' },
    { value: matched.length, label: 'With power' },
    { value: state.report.fieldSize ?? '—', label: 'Full field' },
    { value: avg((r) => r.avgWkg), label: 'Avg w/kg' },
    { value: best(300), label: 'Best 5m w/kg' },
    { value: best(1200), label: 'Best 20m w/kg' }
  ];

  $('tiles').innerHTML = tiles
    .map((t) => `<div class="stat"><div class="value">${t.value}</div><div class="label">${t.label}</div></div>`)
    .join('');
}

// =================================================================== table ===

function renderHead() {
  if (state.view === 'league') return renderLeagueHead();
  if (state.view === 'team') return renderTeamHead();
  const row = $('head');
  row.innerHTML = '';
  columns().forEach((column) => {
    const th = document.createElement('th');
    th.className = 'sortable' + (column.align ? ' align-' + column.align : '');
    th.textContent =
      column.label + (state.sortKey === column.key ? (state.sortDir === 1 ? ' ▲' : ' ▼') : '');
    if (column.title) th.title = column.title;
    if (state.sortKey === column.key) th.classList.add('sorted');
    th.addEventListener('click', () => {
      if (state.sortKey === column.key) state.sortDir *= -1;
      else {
        state.sortKey = column.key;
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
  if (f.matchedOnly && !rider.matched) return false;
  if (f.team && rider.zrlTeam !== f.team) return false;
  if (f.cat && String(rider.category) !== f.cat) return false;
  if (f.search) {
    const hay = [displayName(rider), rider.zrlTeam, rider.zpTeam, rider.zwid]
      .map((v) => String(v ?? '').toLowerCase())
      .join(' ');
    if (!hay.includes(f.search.toLowerCase())) return false;
  }
  return true;
}

function sortRows(rows) {
  const column = columns().find((c) => c.key === state.sortKey) || columns()[0];
  return rows.slice().sort((a, b) => {
    const av = valueFor(a, column);
    const bv = valueFor(b, column);
    if (column.type === 'number') {
      // Missing values sort last regardless of direction.
      const an = typeof av === 'number' ? av : null;
      const bn = typeof bv === 'number' ? bv : null;
      if (an === null && bn === null) return 0;
      if (an === null) return 1;
      if (bn === null) return -1;
      return (an - bn) * state.sortDir;
    }
    return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { sensitivity: 'base' }) * state.sortDir;
  });
}

/**
 * Paint a cell against the spread of its own column.
 *
 * Each column is scaled separately — a 5s w/kg and a 20m w/kg are not
 * comparable numbers, so colouring them on one scale would be nonsense.
 */
function paintHeat(td, scale, value) {
  td.classList.add('heat');
  const style = scale ? WTRLHeat.cellStyle(scale(value), state.palette) : null;
  if (!style) {
    td.style.background = '';
    td.style.color = '';
    return;
  }
  td.style.background = style.background;
  td.style.color = style.color;
}

function render() {
  if (state.view === 'league') return renderLeague();
  if (state.view === 'team') return renderTeams();
  const rows = (state.report.riders || []).filter(matches);
  const sorted = sortRows(rows);
  const cols = columns();
  const body = $('body');
  body.innerHTML = '';

  const total = (state.report.riders || []).length;
  $('count').textContent =
    rows.length === total ? `${total} riders` : `${rows.length} of ${total} riders`;

  if (!sorted.length) {
    body.innerHTML = `<tr><td class="empty-row" colspan="${cols.length}">Nothing matches these filters.</td></tr>`;
    return;
  }

  // One scale per column, built from the rows actually on screen.
  const scales = new Map();
  cols.filter((c) => c.heat).forEach((column) => {
    scales.set(column.key, WTRLHeat.scaleFor(sorted.map((r) => valueFor(r, column))));
  });

  sorted.forEach((rider) => {
    const tr = document.createElement('tr');
    if (!rider.matched) tr.className = 'unmatched';
    else {
      tr.className = 'clickable';
      tr.addEventListener('click', () => showCareer(rider));
    }

    cols.forEach((column) => {
      const td = document.createElement('td');
      if (column.align) td.className = 'align-' + column.align;
      const value = valueFor(rider, column);

      if (column.key === 'name') {
        td.className = 'rider-cell';
        const span = document.createElement('span');
        span.className = 'rider-name';
        span.textContent = displayName(rider);
        td.appendChild(span);
        if (rider.verified) {
          const b = document.createElement('span');
          b.className = 'badge';
          b.textContent = 'verified';
          td.appendChild(b);
        }
        if (rider.zwid) {
          const a = document.createElement('a');
          a.href = ZWIFTPOWER_PROFILE + encodeURIComponent(rider.zwid);
          a.target = '_blank';
          a.rel = 'noreferrer noopener';
          a.textContent = rider.zwid;
          a.style.marginLeft = '8px';
          a.addEventListener('click', (e) => e.stopPropagation());
          td.appendChild(a);
        }
      } else if (column.duration) {
        const p = curveAt(rider, column.duration);
        td.className = 'curve-cell' + (column.align ? ' align-' + column.align : '');
        paintHeat(td, scales.get(column.key), value);
        if (p && p.best) td.classList.add('best');
        td.textContent = typeof value === 'number' ? value.toFixed(state.showWatts ? 0 : 1) : '—';
      } else {
        if (scales.has(column.key)) paintHeat(td, scales.get(column.key), value);
        td.textContent = value === null || value === undefined || value === '' ? '—' : value;
      }
      tr.appendChild(td);
    });

    body.appendChild(tr);
  });
}

function renderLeagueHead() {
  const row = $('head');
  row.innerHTML = '';
  leagueColumns().forEach((column) => {
    const th = document.createElement('th');
    th.className = 'sortable' + (column.align ? ' align-' + column.align : '');
    th.textContent =
      column.label + (state.leagueSort === column.key ? (state.leagueSortDir === 1 ? ' ▲' : ' ▼') : '');
    if (column.title) th.title = column.title;
    if (state.leagueSort === column.key) th.classList.add('sorted');
    th.addEventListener('click', () => {
      if (state.leagueSort === column.key) state.leagueSortDir *= -1;
      else {
        state.leagueSort = column.key;
        state.leagueSortDir = column.type === 'number' ? -1 : 1;
      }
      renderLeagueHead();
      renderLeague();
    });
    row.appendChild(th);
  });
}

function renderLeague() {
  const cols = leagueColumns();
  const body = $('body');
  body.innerHTML = '';

  const search = state.filters.search.toLowerCase();
  const rows = (state.report.league || []).filter(
    (r) => !search || String(r.teamName || '').toLowerCase().includes(search)
  );

  $('count').textContent = `${rows.length} teams`;

  if (!rows.length) {
    body.innerHTML =
      `<tr><td class="empty-row" colspan="${cols.length}">` +
      (state.report.league && state.report.league.length
        ? 'No team matches that search.'
        : 'No league standings were collected for this division. Rebuild from the results page.') +
      '</td></tr>';
    return;
  }

  const sorted = rows.slice().sort((a, b) => {
    const column = cols.find((c) => c.key === state.leagueSort) || cols[0];
    const av = leagueValue(a, column);
    const bv = leagueValue(b, column);
    if (column.type === 'number') {
      const an = typeof av === 'number' ? av : null;
      const bn = typeof bv === 'number' ? bv : null;
      if (an === null && bn === null) return 0;
      if (an === null) return 1;
      if (bn === null) return -1;
      return (an - bn) * state.leagueSortDir;
    }
    return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { sensitivity: 'base' }) *
      state.leagueSortDir;
  });

  const scales = new Map();
  cols.filter((c) => c.heat).forEach((column) => {
    scales.set(column.key, WTRLHeat.scaleFor(sorted.map((r) => leagueValue(r, column))));
  });

  // Which teams appear in the race on screen, so ours stand out in the table.
  const inThisRace = new Set((state.report.teams || []).map((t) => t.teamName));

  sorted.forEach((row) => {
    const tr = document.createElement('tr');
    if (inThisRace.has(row.teamName)) tr.className = 'in-race';

    cols.forEach((column) => {
      const td = document.createElement('td');
      if (column.align) td.className = 'align-' + column.align;
      const value = leagueValue(row, column);

      if (column.key === 'teamName') {
        td.className = 'rider-cell';
        const span = document.createElement('span');
        span.className = 'rider-name';
        span.textContent = value || '—';
        td.appendChild(span);
        if (inThisRace.has(row.teamName)) {
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = 'in this race';
          td.appendChild(badge);
        }
      } else if (column.key === 'penalty') {
        td.textContent = value ? '-' + value : '';
        if (value) td.classList.add('penalty');
      } else {
        if (scales.has(column.key)) paintHeat(td, scales.get(column.key), value);
        td.textContent = value === null || value === undefined || value === '' ? '—' : value;
      }
      tr.appendChild(td);
    });

    body.appendChild(tr);
  });
}

function renderTeamHead() {
  const row = $('head');
  row.innerHTML = '';
  TEAM_COLUMNS.forEach((column) => {
    const th = document.createElement('th');
    th.className = 'sortable' + (column.align ? ' align-' + column.align : '');
    th.textContent =
      column.label + (state.teamSort === column.key ? (state.teamSortDir === 1 ? ' ▲' : ' ▼') : '');
    if (state.teamSort === column.key) th.classList.add('sorted');
    th.addEventListener('click', () => {
      if (state.teamSort === column.key) state.teamSortDir *= -1;
      else {
        state.teamSort = column.key;
        state.teamSortDir = column.type === 'number' ? -1 : 1;
      }
      renderTeamHead();
      renderTeams();
    });
    row.appendChild(th);
  });
}

/** Teams whose name or any rider matches the active search. */
function teamMatches(team) {
  const f = state.filters;
  if (f.cat && !Object.keys(team.categories || {}).includes(f.cat)) return false;
  if (f.team && team.teamName !== f.team) return false;
  if (f.search) {
    const needle = f.search.toLowerCase();
    const inName = String(team.teamName || '').toLowerCase().includes(needle);
    const inRiders = (team.riders || []).some((r) =>
      [displayName(r), r.zwid].some((v) => String(v ?? '').toLowerCase().includes(needle))
    );
    if (!inName && !inRiders) return false;
  }
  return true;
}

function renderTeams() {
  const teams = (state.report.teams || []).filter(teamMatches);
  const body = $('body');
  body.innerHTML = '';

  const total = (state.report.teams || []).length;
  $('count').textContent =
    teams.length === total ? `${total} teams` : `${teams.length} of ${total} teams`;

  if (!teams.length) {
    body.innerHTML =
      `<tr><td class="empty-row" colspan="${TEAM_COLUMNS.length}">Nothing matches these filters.</td></tr>`;
    return;
  }

  const sorted = teams.slice().sort((a, b) => {
    const av = dig(a, state.teamSort);
    const bv = dig(b, state.teamSort);
    const column = TEAM_COLUMNS.find((c) => c.key === state.teamSort);
    if (column && column.type === 'number') {
      const an = typeof av === 'number' ? av : null;
      const bn = typeof bv === 'number' ? bv : null;
      if (an === null && bn === null) return 0;
      if (an === null) return 1;
      if (bn === null) return -1;
      return (an - bn) * state.teamSortDir;
    }
    return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { sensitivity: 'base' }) *
      state.teamSortDir;
  });

  const heatCols = TEAM_COLUMNS.filter((c) => c.heat || /^(avg|best|median)\./.test(c.key));
  const teamScales = new Map();
  heatCols.forEach((column) => {
    teamScales.set(column.key, WTRLHeat.scaleFor(sorted.map((t) => dig(t, column.key))));
  });

  sorted.forEach((team) => {
    const open = state.expanded.has(team.teamName);
    const tr = document.createElement('tr');
    tr.className = 'team-summary';

    TEAM_COLUMNS.forEach((column) => {
      const td = document.createElement('td');
      if (column.align) td.className = 'align-' + column.align;
      const value = dig(team, column.key);

      if (column.key === 'teamName') {
        td.innerHTML =
          `<span class="team-toggle">${open ? '▾' : '▸'}</span>` +
          `<span>${escapeHtml(value || '—')}</span> ` +
          `<span class="cat-mix">${escapeHtml(
            Object.entries(team.categories || {})
              .sort()
              .map(([c, n]) => `${n}${c}`)
              .join(' ')
          )}</span>`;
      } else if (column.key === 'matchedCount') {
        const partial = team.matchedCount < team.riderCount;
        td.innerHTML =
          `<span class="coverage${partial ? ' partial' : ''}">${team.matchedCount}/${team.riderCount}</span>`;
        if (partial) {
          td.title = `${team.riderCount - team.matchedCount} rider(s) have no ZwiftPower data; averages exclude them`;
        }
      } else {
        if (teamScales.has(column.key)) paintHeat(td, teamScales.get(column.key), value);
        td.textContent =
          typeof value === 'number'
            ? (column.key.includes('wkg') || column.key.includes('Wkg')
                ? value.toFixed(2)
                : Math.round(value * 10) / 10)
            : value === null || value === undefined || value === ''
              ? '—'
              : value;
      }
      tr.appendChild(td);
    });

    // The whole row toggles, not just the name — a wider target to hit.
    tr.addEventListener('click', () => {
      if (state.expanded.has(team.teamName)) state.expanded.delete(team.teamName);
      else state.expanded.add(team.teamName);
      renderTeams();
    });

    body.appendChild(tr);

    if (!open) return;

    // Expanded riders, reusing the rider columns so the two views agree.
    (team.riders || [])
      .slice()
      .sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999))
      .forEach((rider) => {
        const rtr = document.createElement('tr');
        rtr.className = 'team-rider' + (rider.matched ? ' clickable' : ' unmatched');
        if (rider.matched) rtr.addEventListener('click', () => showCareer(rider));

        const cells = [
          rider.position ?? rider.zrlPosition ?? '',
          displayName(rider),
          rider.category ?? '',
          rider.matched ? '✓' : '—',
          rider.totalPoints,
          rider.avgWkg,
          curveAt(rider, 1200)?.wkg,
          curveAt(rider, 300)?.wkg,
          curveAt(rider, 60)?.wkg,
          curveAt(rider, 15)?.wkg,
          '',
          rider.raceFtpW,
          rider.weightKg
        ];

        cells.forEach((value, i) => {
          const td = document.createElement('td');
          const column = TEAM_COLUMNS[i];
          if (column.align) td.className = 'align-' + column.align;
          td.textContent =
            typeof value === 'number'
              ? (column.key.includes('wkg') || column.key.includes('Wkg')
                  ? value.toFixed(1)
                  : Math.round(value * 10) / 10)
              : value === null || value === undefined || value === ''
                ? ''
                : value;
          rtr.appendChild(td);
        });
        body.appendChild(rtr);
      });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// ================================================================== career ===

async function showCareer(rider) {
  if (!rider.zwid) return;
  $('career').hidden = false;
  $('careerName').textContent = displayName(rider);
  $('careerNote').textContent = 'Loading career bests from ZwiftPower…';
  $('careerBody').innerHTML = '';

  let bests = state.careerCache.get(rider.zwid);
  if (!bests) {
    const res = await chrome.runtime.sendMessage({ type: 'zp-rider-history', zwid: rider.zwid });
    if (!res || !res.ok) {
      $('careerNote').textContent = (res && res.error) || 'Could not load career bests.';
      return;
    }
    const rows = (res.data && res.data.data) || [];
    bests = { curve: WTRLRace.careerBests(rows), races: rows.length };
    state.careerCache.set(rider.zwid, bests);
  }

  $('careerNote').textContent = `best ever across ${bests.races} races · red = this race`;
  $('careerBody').innerHTML =
    '<div class="career-grid">' +
    bests.curve
      .map((b) => {
        const raceP = curveAt(rider, b.seconds);
        const raceVal = raceP && typeof raceP.wkg === 'number' ? raceP.wkg : null;
        const isRaceBest = raceVal !== null && b.wkg !== null && raceVal >= b.wkg - 0.01;
        return (
          `<div class="career-cell${isRaceBest ? ' race-value' : ''}">` +
          `<div class="d">${b.label}</div>` +
          `<div class="v">${b.wkg === null ? '—' : b.wkg.toFixed(1)}</div>` +
          `<div class="w">${b.watts === null ? '' : b.watts + ' W'}` +
          (raceVal !== null ? ` · race ${raceVal.toFixed(1)}` : '') +
          '</div></div>'
        );
      })
      .join('') +
    '</div>';
}

$('careerClose').addEventListener('click', () => { $('career').hidden = true; });

/** Palette picker, remembered across sessions. */
function buildPalettePicker() {
  const select = $('palette');
  select.innerHTML = WTRLHeat.paletteNames()
    .map((name) => {
      const info = WTRLHeat.paletteInfo(name);
      return `<option value="${name}">${escapeHtml(info.label)}${info.safe ? '' : ' *'}</option>`;
    })
    .join('');
  select.value = state.palette;
  select.title = paletteHint();

  select.addEventListener('change', async (event) => {
    state.palette = event.target.value;
    select.title = paletteHint();
    try {
      await chrome.storage.local.set({ heatPalette: state.palette });
    } catch (_) {}
    render();
  });
}

function paletteHint() {
  const info = WTRLHeat.paletteInfo(state.palette);
  return info.safe
    ? info.note
    : info.note + ' — starred palettes are not safe for red-green colour blindness';
}

function setView(view) {
  state.view = view;
  $('viewTeam').classList.toggle('active', view === 'team');
  $('viewRider').classList.toggle('active', view === 'rider');
  $('viewLeague').classList.toggle('active', view === 'league');

  // Rider-only controls make no sense against team or league rows.
  ['matchedOnly', 'showWatts'].forEach((id) => {
    const label = $(id).closest('label');
    if (label) label.hidden = view !== 'rider';
  });
  // The league table is season-wide, so per-race filters do not apply to it.
  [$('teamFilter'), $('catFilter')].forEach((el) => {
    if (el) el.hidden = view === 'league';
  });

  renderHead();
  render();
}

$('viewTeam').addEventListener('click', () => setView('team'));
$('viewRider').addEventListener('click', () => setView('rider'));
$('viewLeague').addEventListener('click', () => setView('league'));

// ================================================================ controls ===

$('search').addEventListener('input', (e) => { state.filters.search = e.target.value.trim(); render(); });
$('teamFilter').addEventListener('change', (e) => { state.filters.team = e.target.value; render(); });
$('catFilter').addEventListener('change', (e) => { state.filters.cat = e.target.value; render(); });
$('matchedOnly').addEventListener('change', (e) => { state.filters.matchedOnly = e.target.checked; render(); });
$('showWatts').addEventListener('change', (e) => { state.showWatts = e.target.checked; renderHead(); render(); });
$('reset').addEventListener('click', () => {
  state.filters = { search: '', team: '', cat: '', matchedOnly: true };
  $('search').value = '';
  $('teamFilter').value = '';
  $('catFilter').value = '';
  $('matchedOnly').checked = true;
  render();
});

// ================================================================= exports ===

$('exportCsv').addEventListener('click', () => {
  if (!state.report) return;
  const zid = (state.report.race || {}).zid || 'race';

  // Export what is on screen: team aggregates in team view, riders otherwise.
  const rows =
    state.view === 'team'
      ? WTRLRace.teamsToCsvRows(
          Object.assign({}, state.report, {
            teams: (state.report.teams || []).filter(teamMatches)
          })
        )
      : WTRLRace.raceToCsvRows(
          Object.assign({}, state.report, {
            riders: sortRows((state.report.riders || []).filter(matches))
          })
        );

  chrome.runtime.sendMessage({
    type: 'download',
    filename: `wtrl-race-${state.view === 'team' ? 'teams' : 'power'}-${zid}.csv`,
    mime: 'text/csv',
    body: WTRLFormat.toCsv({ riders: rows })
  });
});

$('exportJson').addEventListener('click', () => {
  if (!state.report) return;
  chrome.runtime.sendMessage({
    type: 'download',
    filename: `wtrl-race-power-${(state.report.race || {}).zid || 'race'}.json`,
    mime: 'application/json',
    body: JSON.stringify(state.report, null, 2)
  });
});

load();
