/** Race power table: every rider in the race with their ZwiftPower curve. */

const $ = (id) => document.getElementById(id);
const ZWIFTPOWER_PROFILE = 'https://zwiftpower.com/profile.php?z=';

const state = {
  report: null,
  filters: { search: '', team: '', cat: '', matchedOnly: true },
  showWatts: false,
  sortKey: 'position',
  sortDir: 1,
  careerCache: new Map()
};

const BASE_COLUMNS = [
  { key: 'position', label: '#', type: 'number', align: 'right' },
  { key: 'name', label: 'Rider', type: 'text' },
  { key: 'zrlTeam', label: 'ZRL team', type: 'text' },
  { key: 'category', label: 'Cat', type: 'text', align: 'center' },
  { key: 'weightKg', label: 'kg', type: 'number', align: 'right' },
  { key: 'raceFtpW', label: 'FTP W', type: 'number', align: 'right' },
  { key: 'normalisedPowerW', label: 'NP', type: 'number', align: 'right' },
  { key: 'avgWkg', label: 'Avg w/kg', type: 'number', align: 'right' }
];

const durations = () => (window.WTRLRace ? WTRLRace.DURATIONS : []);

function columns() {
  return BASE_COLUMNS.concat(
    durations().map((d) => ({
      key: 'curve_' + d.key,
      label: d.label,
      type: 'number',
      align: 'right',
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
  const stored = await chrome.storage.local.get(['lastRace']);
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
  const row = $('head');
  row.innerHTML = '';
  columns().forEach((column) => {
    const th = document.createElement('th');
    th.className = 'sortable' + (column.align ? ' align-' + column.align : '');
    th.textContent =
      column.label + (state.sortKey === column.key ? (state.sortDir === 1 ? ' ▲' : ' ▼') : '');
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

/** Rank a curve value against the field so a column reads at a glance. */
function levelFor(rows, column, value) {
  if (typeof value !== 'number') return '0';
  const vals = rows.map((r) => valueFor(r, column)).filter((v) => typeof v === 'number');
  if (vals.length < 3) return '2';
  const sorted = vals.slice().sort((a, b) => a - b);
  const q = (p) => sorted[Math.floor((sorted.length - 1) * p)];
  if (value >= q(0.9)) return '3';
  if (value >= q(0.5)) return '2';
  return '1';
}

function render() {
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
        td.dataset.level = levelFor(sorted, column, value);
        if (p && p.best) td.classList.add('best');
        td.textContent = typeof value === 'number' ? value.toFixed(state.showWatts ? 0 : 1) : '—';
      } else {
        td.textContent = value === null || value === undefined || value === '' ? '—' : value;
      }
      tr.appendChild(td);
    });

    body.appendChild(tr);
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
  const filtered = Object.assign({}, state.report, {
    riders: sortRows((state.report.riders || []).filter(matches))
  });
  chrome.runtime.sendMessage({
    type: 'download',
    filename: `wtrl-race-power-${(state.report.race || {}).zid || 'race'}.csv`,
    mime: 'text/csv',
    body: WTRLFormat.toCsv({ riders: WTRLRace.raceToCsvRows(filtered) })
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
