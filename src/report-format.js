/**
 * Pure report shaping and serialisation — no chrome.* or DOM access, so this
 * file can be unit-tested in plain Node (see scripts/test.mjs).
 *
 * Written as a classic script assigning to the global scope so the same file can
 * be loaded as a content script, via a <script> tag on extension pages, and in a
 * bare VM context under test.
 */
(function (root) {
  'use strict';

  /** The team-detail payload shape returned by WTRL for one team. */
  function isTeamPayload(data) {
    return !!(
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      data.meta &&
      typeof data.meta === 'object' &&
      data.meta.trc !== undefined &&
      Array.isArray(data.riders)
    );
  }

  /** WTRL sends full float precision (3.5600000000000000532); trim the noise. */
  function round2(value) {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.round(value * 100) / 100
      : value;
  }

  /**
   * Rider fields kept in the report. `zwid` is the Zwift profile id, which WTRL
   * returns as `profileId`.
   */
  /** The fields the JSON/CSV export keeps when "include rider stats" is off. */
  var CORE_RIDER_FIELDS = [
    'name',
    'zwid',
    'memberStatus',
    'signedup',
    'userId',
    'tmuid',
    'teams'
  ];

  function mapRider(rider) {
    return {
      name: rider.name,
      zwid: rider.profileId,
      memberStatus: rider.memberStatus,
      signedup: rider.signedup,
      userId: rider.userId,
      tmuid: rider.tmuid,
      teams: rider.teams,
      category: rider.category,
      zftp: round2(rider.zftp),
      zftpw: rider.zftpw,
      zmap: round2(rider.zmap),
      zmapw: rider.zmapw,
      riderpoints: rider.riderpoints,
      appearancesRound: rider.appearancesRound,
      appearancesSeason: rider.appearancesSeason,
      avatar: rider.avatar
    };
  }

  /**
   * Reduce every rider down to the core fields. The full report is what gets
   * stored (the table view needs the stats); this is what gets exported unless
   * the user asks for stats.
   */
  function stripStats(report) {
    const pick = (rider, extra) => {
      const out = {};
      extra.forEach((key) => {
        if (key in rider) out[key] = rider[key];
      });
      CORE_RIDER_FIELDS.forEach((key) => {
        out[key] = rider[key];
      });
      return out;
    };

    return Object.assign({}, report, {
      teams: (report.teams || []).map((team) =>
        Object.assign({}, team, { riders: (team.riders || []).map((r) => pick(r, [])) })
      ),
      riders: (report.riders || []).map((r) => pick(r, ['teamName', 'trc']))
    });
  }

  /**
   * Assemble the final report.
   *
   * @param entries  [{ team: {name, trc, season}, data: <team payload> }]
   * @param options  { failures, extensionVersion, generatedAt, inProgress, progress }
   *
   * A report saved part-way through a run carries `inProgress: true` and a
   * `{ done, total }` progress counter; a finished one omits both, so exports
   * and uploads stay clean.
   */
  function buildReport(entries, options) {
    const opts = options || {};

    const teams = entries.map((entry) => {
      const meta = entry.data.meta || {};
      const competition = meta.competition || {};
      const teamMeta = meta.team || {};
      return {
        teamName: teamMeta.name || entry.team.name,
        trc: meta.trc !== undefined ? meta.trc : entry.team.trc,
        teamId: teamMeta.teamid !== undefined ? teamMeta.teamid : null,
        division: meta.division || null,
        racingSeason: meta.racingSeason || null,
        season: competition.season !== undefined ? competition.season : entry.team.season ?? null,
        round: competition.roundnumber !== undefined ? competition.roundnumber : null,
        competitionDivision: competition.division || null,
        competitionClass: competition.class || null,
        registrationStatus: competition.status || null,
        memberCount:
          meta.memberCount !== undefined ? meta.memberCount : (entry.data.riders || []).length,
        riders: (entry.data.riders || []).map(mapRider)
      };
    });

    const riders = flattenTeams(teams);

    const report = {
      generatedAt: opts.generatedAt || new Date().toISOString(),
      source: 'wtrl.racing/zrl/myteams',
      extensionVersion: opts.extensionVersion || null,
      teamCount: teams.length,
      riderCount: riders.length,
      failures: opts.failures || [],
      teams,
      riders
    };

    if (opts.inProgress) {
      report.inProgress = true;
      report.progress = opts.progress || null;
    }
    return report;
  }

  /** Flat rows: one per rider per team, carrying the team name for CSV/import. */
  function flattenTeams(teams) {
    const riders = [];
    (teams || []).forEach((team) => {
      (team.riders || []).forEach((rider) => {
        riders.push(Object.assign({ teamName: team.teamName, trc: team.trc }, rider));
      });
    });
    return riders;
  }

  /**
   * Should a failed collection attempt be tried again?
   *
   * Timeouts, network errors, 429s and 5xx are transient — the server is busy or
   * rate-limiting, and backing off usually clears it. A 404 or a response that
   * is not a team payload (an expired session redirecting to a login page, say)
   * will fail identically no matter how many times we ask.
   */
  function isRetryableFailure(result) {
    if (!result) return true;
    if (result.timedOut) return true;

    const status = result.status;
    if (status === undefined || status === null) return true; // network-level failure
    if (status === 408 || status === 425 || status === 429) return true;
    return status >= 500;
  }

  /**
   * Fold a follow-up collection into an earlier report, so retrying the teams
   * that failed keeps the ones that already succeeded.
   *
   * Teams present in `incoming` replace their earlier version; a failure is
   * dropped as soon as any pass resolves that team. `order` is an optional list
   * of trc values (page order) used to keep teams in their on-screen sequence.
   */
  function mergeReports(base, incoming, order) {
    const byTrc = new Map();
    (base.teams || []).forEach((team) => byTrc.set(team.trc, team));
    (incoming.teams || []).forEach((team) => byTrc.set(team.trc, team));

    let teams = Array.from(byTrc.values());
    if (Array.isArray(order) && order.length) {
      const rank = new Map(order.map((trc, i) => [trc, i]));
      teams = teams.sort(
        (a, b) =>
          (rank.has(a.trc) ? rank.get(a.trc) : Number.MAX_SAFE_INTEGER) -
          (rank.has(b.trc) ? rank.get(b.trc) : Number.MAX_SAFE_INTEGER)
      );
    }

    const resolved = new Set(teams.map((team) => team.trc));
    // Map.set keeps first-insertion order but takes the latest value, so
    // failures stay in their original sequence while a retry's fresher error
    // message replaces the stale one.
    const failureByTrc = new Map();
    [...(base.failures || []), ...(incoming.failures || [])].forEach((failure) => {
      if (resolved.has(failure.trc)) return;
      failureByTrc.set(failure.trc, failure);
    });
    const failures = Array.from(failureByTrc.values());

    const riders = flattenTeams(teams);

    const merged = Object.assign({}, base, incoming, {
      teams,
      riders,
      teamCount: teams.length,
      riderCount: riders.length,
      failures
    });

    // Object.assign would let a stale `inProgress: true` from the base survive
    // a finished incoming pass; the newer pass decides whether we are still running.
    if (!incoming.inProgress) {
      delete merged.inProgress;
      delete merged.progress;
    }
    return merged;
  }

  /**
   * Turn an observed request URL into a reusable template by swapping the
   * concrete ids for placeholders, e.g.
   *   /zrl/api/team.php?trc=76720&season=20
   *   -> /zrl/api/team.php?trc={trc}&season={season}
   * Returns null when the trc does not appear in the URL (nothing to templatise).
   */
  function deriveTemplate(url, data) {
    if (!url || !isTeamPayload(data)) return null;

    const trc = data.meta.trc;
    const season = data.meta.competition && data.meta.competition.season;

    let template = String(url);
    if (template.indexOf(String(trc)) === -1) return null;
    template = template.split(String(trc)).join('{trc}');

    if (season !== undefined && season !== null) {
      // Standalone-number match only, so season "20" cannot eat part of "2026".
      const seasonRe = new RegExp('(?<![0-9])' + String(season) + '(?![0-9])', 'g');
      template = template.replace(seasonRe, '{season}');
    }
    return template;
  }

  function renderTemplate(template, team) {
    return String(template)
      .split('{trc}')
      .join(String(team.trc))
      .split('{season}')
      .join(team.season === null || team.season === undefined ? '' : String(team.season));
  }

  /** Flat rider rows -> CSV, columns taken from the union of all row keys. */
  function toCsv(report) {
    const rows = (report && report.riders) || [];
    if (!rows.length) return '';

    const columns = [];
    rows.forEach((row) => {
      Object.keys(row).forEach((key) => {
        if (columns.indexOf(key) === -1) columns.push(key);
      });
    });

    const escape = (value) => {
      if (value === null || value === undefined) return '';
      const s = String(value);
      return /[",\n\r]/.test(s) ? '"' + s.split('"').join('""') + '"' : s;
    };

    const lines = [columns.join(',')];
    rows.forEach((row) => {
      lines.push(columns.map((column) => escape(row[column])).join(','));
    });
    return lines.join('\n');
  }

  function filenameStamp(report) {
    const iso = (report && report.generatedAt) || new Date().toISOString();
    return iso.slice(0, 19).replace(/[:T]/g, '-');
  }

  function downloadName(report, extension) {
    return 'wtrl-team-report-' + filenameStamp(report) + '.' + extension;
  }

  /** Group flat rider rows by Zwift id. */
  function ridersByZwid(report) {
    const map = new Map();
    (report.riders || []).forEach((rider) => {
      const key = rider.zwid;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(rider);
    });
    return map;
  }

  /** Zwift ids that appear on more than one of the manager's teams. */
  function multiTeamZwids(report) {
    const out = new Set();
    ridersByZwid(report).forEach((rows, zwid) => {
      if (rows.length > 1) out.add(zwid);
    });
    return out;
  }

  /** Headline counts for the table view's stat tiles. */
  function summarise(report) {
    const rows = report.riders || [];
    const has = (rider, key) => rider[key] !== undefined && rider[key] !== null;
    return {
      teams: report.teamCount || (report.teams || []).length,
      rosterSpots: rows.length,
      uniqueRiders: ridersByZwid(report).size,
      members: rows.filter((r) => r.memberStatus === 'MEMBER').length,
      invited: rows.filter((r) => r.memberStatus === 'INVITED').length,
      signedUp: rows.filter((r) => r.signedup === true).length,
      notSignedUp: rows.filter((r) => r.signedup !== true).length,
      multiTeam: multiTeamZwids(report).size,
      noRacesThisSeason: rows.filter((r) => has(r, 'appearancesSeason') && !r.appearancesSeason)
        .length
    };
  }

  root.WTRLFormat = {
    CORE_RIDER_FIELDS,
    flattenTeams,
    isRetryableFailure,
    mergeReports,
    stripStats,
    ridersByZwid,
    multiTeamZwids,
    summarise,
    isTeamPayload,
    round2,
    mapRider,
    buildReport,
    deriveTemplate,
    renderTemplate,
    toCsv,
    filenameStamp,
    downloadName
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
