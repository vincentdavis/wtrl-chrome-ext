/**
 * Joining WTRL race results to ZwiftPower event results.
 *
 * WTRL's results API zeroes out `zwid` and abbreviates rider names
 * ("S. Joneström"), so it cannot be joined to ZwiftPower directly. What it does
 * carry is `zid`, the Zwift event id — and ZwiftPower publishes the same event
 * with real zwids and a full power curve per rider. So `zid` is the bridge, and
 * riders are matched by name within that one event.
 *
 * Pure functions only, no chrome.* or DOM, so this is unit-testable in Node.
 */
(function (root) {
  'use strict';

  // ZwiftPower returns most numbers as [value, flag], where the flag marks a
  // personal best / highlighted figure. Everything here wants the value.
  function zpNum(value) {
    const raw = Array.isArray(value) ? value[0] : value;
    // Number('') is 0, which would show a missing reading as a real 0 w/kg.
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function zpFlag(value) {
    return Array.isArray(value) && value[1] ? 1 : 0;
  }

  /** The durations ZwiftPower reports, shortest first. */
  const DURATIONS = [
    { key: 5, label: '5s' },
    { key: 15, label: '15s' },
    { key: 30, label: '30s' },
    { key: 60, label: '1m' },
    { key: 120, label: '2m' },
    { key: 300, label: '5m' },
    { key: 1200, label: '20m' }
  ];

  /** Power curve for one ZwiftPower result row. */
  function powerCurve(row) {
    return DURATIONS.map((d) => ({
      seconds: d.key,
      label: d.label,
      watts: zpNum(row['w' + d.key]),
      wkg: zpNum(row['wkg' + d.key]),
      best: zpFlag(row['wkg' + d.key])
    }));
  }

  // Letters with no Unicode decomposition, so NFD leaves them intact and the
  // a-z filter would delete them mid-surname (Fiałkowski -> "fia kowski").
  const LETTER_MAP = {
    'ł': 'l', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss',
    'đ': 'd', 'ð': 'd', 'þ': 'th', 'ħ': 'h', 'ı': 'i', 'ŀ': 'l'
  };

  /**
   * Strip a display name down to what both sides share: no "[TEAM]" tag (WTRL
   * sometimes carries one too), no accents, no punctuation.
   */
  function normalizeName(value) {
    const lowered = String(value || '')
      // ZwiftPower stores emoji as HTML entities ("Martin Nohammar&#129512;").
      // Left in, the digits survive the a-z filter and become the surname.
      .replace(/&#?[0-9a-z]+;/gi, ' ')
      .replace(/\[[^\]]*\]/g, ' ')   // "[Team]"
      .replace(/\[[^\]]*$/, ' ')    // truncated "[Team"
      .replace(/\([^)]*\)/g, ' ')
      .toLowerCase();

    const latinised = lowered.replace(
      /[łøæœßđðþħıŀ]/g,
      (c) => LETTER_MAP[c] || c
    );

    return latinised
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')  // accents: Catalão -> Catalao
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * WTRL shows "S. Joneström" and ZwiftPower "Stefan Jonestrom[eSRT]", so the
   * surname plus the first initial is the most either side reliably shares.
   */
  function nameKey(value) {
    const parts = normalizeName(value)
      .split(' ')
      // Drop bare numbers; a stray badge or year is never the surname.
      .filter((part) => part && !/^[0-9]+$/.test(part));
    if (!parts.length) return null;
    const last = parts[parts.length - 1];
    const initial = parts[0].charAt(0);
    return { initial, last, key: initial + '|' + last };
  }

  /** Flatten the WTRL results payload into rider rows tagged with their team. */
  function wtrlRiders(payload) {
    const teams = (payload && payload.payload) || [];
    const out = [];
    teams.forEach((team) => {
      (team.a || []).forEach((rider) => {
        out.push({
          name: rider.name,
          zrlTeam: team.teamname || null,
          zrlPosition: rider.p1 ?? null,
          category: rider.category ?? null,
          wtrlWatts: rider.watts ?? null,
          wtrlWkg: rider.wkg ?? null,
          finished: rider.finished,
          timeResult: rider.timeResult ?? null,
          gap: rider.gap ?? null,
          zid: rider.zid ?? null,
          activity: rider.activity ?? null,
          dq: rider.dq || null
        });
      });
    });
    return out;
  }

  /** The Zwift event id shared by every rider row, if they agree on one. */
  function eventIdFrom(payload) {
    const ids = new Set(
      wtrlRiders(payload)
        .map((r) => Number(r.zid))
        .filter((z) => Number.isFinite(z) && z > 0)
    );
    return ids.size === 1 ? Array.from(ids)[0] : (Array.from(ids)[0] ?? null);
  }

  /**
   * A ZwiftPower display name fit to show: no "[Team]" tag and no raw HTML
   * entities (names routinely carry emoji as "&#129512;").
   */
  function displayName(value) {
    return String(value || '')
      .replace(/&#?[0-9a-z]+;/gi, '')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\[[^\]]*$/, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function mapZpRider(row) {
    return {
      zwid: Number(row.zwid) || null,
      zpName: displayName(row.name),
      zpTeam: row.tname || null,
      zpTeamId: row.tid || null,
      position: row.pos ?? null,
      positionInCategory: row.position_in_cat ?? null,
      category: row.category || null,
      division: row.div ?? null,
      time: zpNum(row.time),
      gap: zpNum(row.gap),
      weightKg: zpNum(row.weight),
      heightCm: zpNum(row.height),
      age: row.age ?? null,
      flag: row.flag || null,
      verified: Number(row.zada) === 1,
      profileFtpW: zpNum(row.ftp),
      raceFtpW: zpNum(row.wftp),
      raceFtpWkg: zpNum(row.wkg_ftp),
      normalisedPowerW: zpNum(row.np),
      avgPowerW: zpNum(row.avg_power),
      avgWkg: zpNum(row.avg_wkg),
      avgHr: zpNum(row.avg_hr),
      maxHr: zpNum(row.max_hr),
      powerCurve: powerCurve(row)
    };
  }

  /**
   * Join WTRL rider rows to ZwiftPower rows for the same event.
   *
   * ZwiftPower lists the whole event; WTRL lists only the teams in the division
   * being viewed. So every WTRL rider should find a ZwiftPower row, but not the
   * other way round — extras are expected, misses are not and are reported.
   */
  function joinRiders(wtrlRows, zpRows) {
    const byKey = new Map();
    zpRows.forEach((row) => {
      const key = nameKey(row.name);
      if (!key) return;
      if (!byKey.has(key.key)) byKey.set(key.key, []);
      byKey.get(key.key).push(row);
    });

    // A surname alone, as a looser second pass for awkward names.
    const bySurname = new Map();
    zpRows.forEach((row) => {
      const key = nameKey(row.name);
      if (!key) return;
      if (!bySurname.has(key.last)) bySurname.set(key.last, []);
      bySurname.get(key.last).push(row);
    });

    const used = new Set();
    const riders = [];
    const unmatched = [];

    wtrlRows.forEach((wtrl) => {
      const key = nameKey(wtrl.name);
      let candidates = (key && byKey.get(key.key)) || [];
      if (!candidates.length && key) {
        // Only trust a surname-only match when it is unambiguous.
        const loose = bySurname.get(key.last) || [];
        if (loose.length === 1) candidates = loose;
      }

      const row = candidates.find((c) => !used.has(c));
      if (!row) {
        unmatched.push({ name: wtrl.name, zrlTeam: wtrl.zrlTeam, reason: 'No ZwiftPower row matched' });
        riders.push(Object.assign({ matched: false }, wtrl));
        return;
      }

      used.add(row);
      riders.push(Object.assign({ matched: true }, wtrl, mapZpRider(row)));
    });

    return { riders, unmatched, zpRowCount: zpRows.length, zpUnused: zpRows.length - used.size };
  }

  /**
   * Build the race report: WTRL's ZRL team structure plus ZwiftPower's power.
   *
   * @param options { wtrlPayload, zpRows, race, extensionVersion, generatedAt }
   */
  function buildRaceReport(options) {
    const opts = options || {};
    const wtrlRows = wtrlRiders(opts.wtrlPayload || {});
    const zpRows = (opts.zpRows || []).filter((r) => Number(r.zwid) > 0);
    const joined = joinRiders(wtrlRows, zpRows);

    return {
      generatedAt: opts.generatedAt || new Date().toISOString(),
      source: 'wtrl.racing/zrl/results + zwiftpower.com',
      extensionVersion: opts.extensionVersion || null,
      race: Object.assign(
        { zid: eventIdFrom(opts.wtrlPayload || {}) },
        opts.race || {}
      ),
      riderCount: joined.riders.length,
      matchedCount: joined.riders.filter((r) => r.matched).length,
      unmatched: joined.unmatched,
      fieldSize: joined.zpRowCount,
      riders: joined.riders
    };
  }

  /** Best power at each duration across a rider's whole result history. */
  function careerBests(historyRows) {
    const rows = historyRows || [];
    return DURATIONS.map((d) => {
      let bestWkg = null;
      let bestW = null;
      rows.forEach((row) => {
        const wkg = zpNum(row['wkg' + d.key]);
        const w = zpNum(row['w' + d.key]);
        if (wkg !== null && (bestWkg === null || wkg > bestWkg)) bestWkg = wkg;
        if (w !== null && (bestW === null || w > bestW)) bestW = w;
      });
      return { seconds: d.key, label: d.label, wkg: bestWkg, watts: bestW };
    });
  }

  /** Flat rows for CSV: one per rider, power curve spread across columns. */
  function raceToCsvRows(report) {
    return (report.riders || []).map((r) => {
      const row = {
        zrlTeam: r.zrlTeam,
        name: r.zpName || r.name,
        zwid: r.zwid ?? '',
        matched: r.matched,
        position: r.position ?? r.zrlPosition ?? '',
        category: r.category ?? '',
        weightKg: r.weightKg ?? '',
        raceFtpW: r.raceFtpW ?? '',
        normalisedPowerW: r.normalisedPowerW ?? '',
        avgWkg: r.avgWkg ?? '',
        verified: r.verified === undefined ? '' : r.verified
      };
      (r.powerCurve || []).forEach((p) => {
        row['wkg_' + p.label] = p.wkg ?? '';
        row['w_' + p.label] = p.watts ?? '';
      });
      return row;
    });
  }

  root.WTRLRace = {
    DURATIONS,
    displayName,
    zpNum,
    zpFlag,
    normalizeName,
    nameKey,
    powerCurve,
    wtrlRiders,
    eventIdFrom,
    mapZpRider,
    joinRiders,
    buildRaceReport,
    careerBests,
    raceToCsvRows
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
