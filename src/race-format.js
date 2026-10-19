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
          // WTRL sends this numerically (10, 20, …) on the same scale as
          // ZwiftPower's div. Converting here keeps `category` a letter for
          // every rider, so unmatched riders don't skew a team's category mix.
          category: categoryFromDiv(rider.category) ?? rider.category ?? null,
          categoryCode: rider.category ?? null,
          wtrlWatts: rider.watts ?? null,
          wtrlWkg: rider.wkg ?? null,
          // ZRL scoring, per rider. These sum exactly to the team row, and are
          // zero until a round is finalised rather than absent.
          falPoints: zpNum(rider.falrp),
          ftsPoints: zpNum(rider.ftsrp),
          finPoints: zpNum(rider.finrp),
          pbpPoints: zpNum(rider.pbprp),
          totalPoints: zpNum(rider.totrp),
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

  /**
   * ZwiftPower division codes -> category letters.
   *
   * Inferred from the club-wide distribution (0/5/10/20/30/40) and confirmed
   * against WTRL: every rider WTRL calls "B" sits at div 20. The team page
   * renders client-side from this same JSON, so there is no server-rendered
   * letter to check it against.
   */
  const DIVISIONS = { 5: 'A+', 10: 'A', 20: 'B', 30: 'C', 40: 'D', 50: 'E' };

  function categoryFromDiv(div) {
    const n = Number(div);
    if (!Number.isFinite(n) || n === 0) return null; // 0 means unranked
    return DIVISIONS[n] || null;
  }

  /** Team-level rows from the WTRL results payload, with its own scoring. */
  function wtrlTeams(payload) {
    return ((payload && payload.payload) || []).map((team) => ({
      teamName: team.teamname || null,
      position: team.p1 ?? null,
      division: team.zrldivision || null,
      riderCount: (team.a || []).length,
      points: {
        fal: team.falp ?? null,
        fts: team.ftsp ?? null,
        fin: team.finp ?? null,
        pbp: team.pbp ?? null,
        total: team.totp ?? null
      },
      timeResult: team.timeResult ?? null,
      gap: team.gap ?? null,
      wtrlWatts: team.watts ?? null,
      wtrlWkg: team.wkg ?? null,
      speed: team.speed ?? null
    }));
  }

  const mean = (values) => {
    const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (!nums.length) return null;
    return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
  };

  const median = (values) => {
    const nums = values
      .filter((v) => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    if (!nums.length) return null;
    const mid = Math.floor(nums.length / 2);
    const m = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    return Math.round(m * 100) / 100;
  };

  const maxOf = (values) => {
    const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
    return nums.length ? Math.max(...nums) : null;
  };

  const curveValue = (rider, seconds) => {
    const point = (rider.powerCurve || []).find((p) => p.seconds === seconds);
    return point ? point.wkg : null;
  };

  /**
   * Per-team ZwiftPower aggregates, alongside WTRL's own team scoring.
   *
   * Averages cover only riders who matched a ZwiftPower row, so a team with
   * missing riders is not quietly dragged down by counting them as zero;
   * `matchedCount` says how many riders each average is actually based on.
   */
  function teamAggregates(riders, wtrlTeamRows) {
    const byTeam = new Map();
    (wtrlTeamRows || []).forEach((team) => byTeam.set(team.teamName, { meta: team, riders: [] }));

    riders.forEach((rider) => {
      const key = rider.zrlTeam;
      if (!byTeam.has(key)) {
        byTeam.set(key, { meta: { teamName: key, riderCount: 0 }, riders: [] });
      }
      byTeam.get(key).riders.push(rider);
    });

    return Array.from(byTeam.values()).map(({ meta, riders: teamRiders }) => {
      const withPower = teamRiders.filter((r) => r.matched);
      const pick = (fn) => withPower.map(fn);

      const categories = {};
      teamRiders.forEach((r) => {
        const cat = r.category || r.zpCategory || '?';
        categories[cat] = (categories[cat] || 0) + 1;
      });

      return Object.assign({}, meta, {
        riderCount: teamRiders.length,
        matchedCount: withPower.length,
        categories,
        avg: {
          wkg15s: mean(pick((r) => curveValue(r, 15))),
          wkg1m: mean(pick((r) => curveValue(r, 60))),
          wkg5m: mean(pick((r) => curveValue(r, 300))),
          wkg20m: mean(pick((r) => curveValue(r, 1200))),
          avgWkg: mean(pick((r) => r.avgWkg)),
          np: mean(pick((r) => r.normalisedPowerW)),
          ftpW: mean(pick((r) => r.raceFtpW)),
          weightKg: mean(pick((r) => r.weightKg))
        },
        median: {
          wkg20m: median(pick((r) => curveValue(r, 1200))),
          wkg5m: median(pick((r) => curveValue(r, 300)))
        },
        best: {
          wkg20m: maxOf(pick((r) => curveValue(r, 1200))),
          wkg5m: maxOf(pick((r) => curveValue(r, 300))),
          wkg15s: maxOf(pick((r) => curveValue(r, 15)))
        },
        riders: teamRiders
      });
    });
  }

  /**
   * Split a results class code into its league and division.
   *
   * WTRL builds it as "2" + league id (3 digits) + division + "0", so
   * "2120A10" is Cherry (120) division A1, and "2250B10" is Orange (250) B1.
   */
  function parseClassCode(code) {
    const text = String(code || '');
    const match = text.match(/^(\d)(\d{3})(.+?)0$/);
    if (!match) return null;
    return { prefix: match[1], leagueId: Number(match[2]), division: match[3] };
  }

  /**
   * Find a race in the results index, for its name and format.
   *
   * The format matters: a TTT is scored on team time and has no FAL, FTS or
   * FIN points at all, so a table of zeros there is the correct answer rather
   * than missing data, and should be labelled as such.
   */
  function findRaceMeta(index, classCode, round) {
    const parsed = parseClassCode(classCode);
    if (!parsed || !index) return null;

    const competitions = (index.payload && index.payload.competition) || index.competition || [];
    for (const competition of competitions) {
      for (const league of competition.leagues || []) {
        if (Number(league.value) !== parsed.leagueId) continue;
        for (const division of league.divisions || []) {
          if (String(division.value) !== parsed.division) continue;
          const race = (division.races || []).find((r) => Number(r.value) === Number(round));
          if (!race) continue;
          return {
            leagueName: league.text || null,
            division: parsed.division,
            raceName: race.text || null,
            format: race.format || null,
            finalized: /\(finalized\)/i.test(race.text || '')
          };
        }
      }
    }
    return null;
  }

  /** Formats that award FAL / FTS / FIN points to individual riders. */
  const POINTS_FORMATS = ['PTS', 'SCR'];

  function formatHasRiderPoints(format) {
    if (!format) return true; // unknown: assume normal scoring
    return POINTS_FORMATS.includes(String(format).toUpperCase());
  }

  /**
   * League standings for a division.
   *
   * WTRL serves this with single-letter keys. The mapping below was decoded by
   * summing the per-race team points across every round and matching them
   * against each field — e/k/i/pbp reconcile exactly with season FAL/FTS/FIN/PBP,
   * and r1..r8 are the placing points per round, which sum to j.
   */
  function mapLeagueStandings(payload) {
    const rows = (payload && payload.payload) || [];
    return rows.map((row) => {
      const roundPoints = [];
      for (let i = 1; i <= 8; i += 1) {
        const value = zpNum(row['r' + i]);
        roundPoints.push(value === null ? 0 : value);
      }
      const fal = zpNum(row.e);
      const fts = zpNum(row.k);
      const fin = zpNum(row.i);
      const pbp = zpNum(row.pbp);

      return {
        rank: zpNum(row.c),
        teamId: row.teamId || null,
        teamName: row.d || null,
        jersey: row.z || null,
        roundPoints,
        roundsRaced: zpNum(row.l),
        leaguePoints: zpNum(row.n) ?? zpNum(row.j),
        leaguePointsBeforePenalty: zpNum(row.j),
        penalty: zpNum(row.m),
        falPoints: fal,
        ftsPoints: fts,
        finPoints: fin,
        pbpPoints: pbp,
        // WTRL does not send a season race-points total; it is the four parts.
        racePoints: [fal, fts, fin, pbp].every((v) => v === null)
          ? null
          : [fal, fts, fin, pbp].reduce((n, v) => n + (v || 0), 0)
      };
    });
  }

  /** How many rounds any team in the division has actually raced. */
  function roundsPlayed(standings) {
    let played = 0;
    (standings || []).forEach((row) => {
      row.roundPoints.forEach((value, i) => {
        if (value) played = Math.max(played, i + 1);
      });
      if (row.roundsRaced) played = Math.max(played, row.roundsRaced);
    });
    return played;
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
      zpRaceCategory: row.category || null,
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
      teams: teamAggregates(joined.riders, wtrlTeams(opts.wtrlPayload || {})),
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

  /** Flat rows for CSV: one per team, WTRL scoring plus ZwiftPower averages. */
  function teamsToCsvRows(report) {
    return (report.teams || []).map((t) => ({
      position: t.position ?? '',
      team: t.teamName,
      riders: t.riderCount,
      ridersWithPower: t.matchedCount,
      categories: Object.entries(t.categories || {})
        .sort()
        .map(([c, n]) => `${n}${c}`)
        .join(' '),
      pointsTotal: t.points ? (t.points.total ?? '') : '',
      pointsFal: t.points ? (t.points.fal ?? '') : '',
      pointsFts: t.points ? (t.points.fts ?? '') : '',
      pointsFin: t.points ? (t.points.fin ?? '') : '',
      pointsPbp: t.points ? (t.points.pbp ?? '') : '',
      avgWkg: t.avg.avgWkg ?? '',
      avgWkg20m: t.avg.wkg20m ?? '',
      avgWkg5m: t.avg.wkg5m ?? '',
      avgWkg1m: t.avg.wkg1m ?? '',
      avgWkg15s: t.avg.wkg15s ?? '',
      medianWkg20m: t.median.wkg20m ?? '',
      bestWkg20m: t.best.wkg20m ?? '',
      avgFtpW: t.avg.ftpW ?? '',
      avgWeightKg: t.avg.weightKg ?? ''
    }));
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
        falPoints: r.falPoints ?? '',
        ftsPoints: r.ftsPoints ?? '',
        finPoints: r.finPoints ?? '',
        pbpPoints: r.pbpPoints ?? '',
        totalPoints: r.totalPoints ?? '',
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

  /**
   * One row of /cache3/teams/<id>_riders.json, reshaped.
   *
   * `email` is deliberately not carried through. The payload has the field for
   * every club member, and none of this needs it.
   */
  function mapRosterRider(row) {
    return {
      zwid: Number(row.zwid) || null,
      zpName: displayName(row.name),
      zpCategory: categoryFromDiv(row.div),
      zpDiv: Number(row.div) || 0,
      zpDivWomen: Number(row.divw) || 0,
      zpFtpW: zpNum(row.ftp),
      zpWeightKg: zpNum(row.w),
      zpAge: row.age || null,
      zpFlag: row.flag || null,
      zpRank: zpNum(row.rank),
      zpSkill: zpNum(row.skill),
      zpSkillRace: zpNum(row.skill_race),
      zpSkillSeg: zpNum(row.skill_seg),
      zpSkillPower: zpNum(row.skill_power),
      zpRegistered: Number(row.reg) === 1,
      zpRole: row.status || null,
      zp20minW: zpNum(row.h_1200_watts),
      zp20minWkg: zpNum(row.h_1200_wkg),
      zp15sW: zpNum(row.h_15_watts),
      zp15sWkg: zpNum(row.h_15_wkg),
      zpDistanceKm: zpNum(row.distance),
      zpClimbedM: zpNum(row.climbed),
      zpEnergyKj: zpNum(row.energy),
      zpTimeHours: zpNum(row.time)
    };
  }

  /** Strip the roster to what we are willing to store or ship onward. */
  function sanitiseRoster(rows) {
    return (rows || []).filter((r) => Number(r.zwid) > 0).map(mapRosterRider);
  }

  /**
   * Fold a ZwiftPower club roster into a WTRL team report, matched on zwid —
   * the same number on both sides, so no name matching is needed here.
   *
   * A club roster covers everyone who has ever joined, so most of it will not
   * appear in the report; that is expected and not reported as a problem. A
   * rider in the report with no roster row is, and is flagged.
   */
  function enrichWithZwiftPower(report, rosterRows, options) {
    const opts = options || {};
    const roster = sanitiseRoster(rosterRows);
    const byZwid = new Map(roster.map((r) => [r.zwid, r]));

    const missing = [];
    const inReport = new Set();
    const apply = (rider) => {
      if (Number(rider.zwid)) inReport.add(Number(rider.zwid));
      const match = byZwid.get(Number(rider.zwid));
      if (!match) {
        if (!missing.some((m) => m.zwid === rider.zwid)) {
          missing.push({ zwid: rider.zwid, name: rider.name });
        }
        return Object.assign({}, rider, { zpMatched: false });
      }
      const merged = Object.assign({}, rider, match, { zpMatched: true });
      // The report's own name and category win; ZwiftPower's are additional.
      merged.name = rider.name;
      merged.category = rider.category;
      merged.categoryMismatch = !!(
        rider.category && match.zpCategory && rider.category !== match.zpCategory
      );
      return merged;
    };

    const teams = (report.teams || []).map((team) =>
      Object.assign({}, team, { riders: (team.riders || []).map(apply) })
    );
    const riders = (report.riders || []).map(apply);

    return Object.assign({}, report, {
      teams,
      riders,
      zwiftpower: {
        teamId: opts.teamId ?? null,
        teamName: opts.teamName ?? null,
        fetchedAt: opts.fetchedAt || new Date().toISOString(),
        rosterSize: roster.length,
        matched: riders.filter((r) => r.zpMatched).length,
        missing,
        // The raw ZwiftPower rows for riders in this report, keyed by zwid, so
        // a server can redo or check the join itself. Club members who are not
        // in the report are left out: a club holds everyone who ever joined,
        // and the rest is noise on every upload.
        roster: roster.filter((r) => inReport.has(r.zwid))
      }
    });
  }

  root.WTRLRace = {
    parseClassCode,
    findRaceMeta,
    formatHasRiderPoints,
    POINTS_FORMATS,
    mapLeagueStandings,
    roundsPlayed,
    wtrlTeams,
    teamAggregates,
    DIVISIONS,
    categoryFromDiv,
    mapRosterRider,
    sanitiseRoster,
    enrichWithZwiftPower,
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
    raceToCsvRows,
    teamsToCsvRows
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
