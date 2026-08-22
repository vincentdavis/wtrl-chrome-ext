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
  function mapRider(rider, includeStats) {
    const core = {
      name: rider.name,
      zwid: rider.profileId,
      memberStatus: rider.memberStatus,
      signedup: rider.signedup,
      userId: rider.userId,
      tmuid: rider.tmuid,
      teams: rider.teams
    };
    if (!includeStats) return core;
    return Object.assign(core, {
      category: rider.category,
      zftp: round2(rider.zftp),
      zftpw: rider.zftpw,
      zmap: round2(rider.zmap),
      zmapw: rider.zmapw,
      riderpoints: rider.riderpoints,
      appearancesRound: rider.appearancesRound,
      appearancesSeason: rider.appearancesSeason,
      avatar: rider.avatar
    });
  }

  /**
   * Assemble the final report.
   *
   * @param entries  [{ team: {name, trc, season}, data: <team payload> }]
   * @param options  { includeStats, failures, extensionVersion, generatedAt }
   */
  function buildReport(entries, options) {
    const opts = options || {};
    const includeStats = !!opts.includeStats;

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
        riders: (entry.data.riders || []).map((rider) => mapRider(rider, includeStats))
      };
    });

    // Flat rows: one per rider per team, carrying the team name for CSV/import.
    const riders = [];
    teams.forEach((team) => {
      team.riders.forEach((rider) => {
        riders.push(Object.assign({ teamName: team.teamName, trc: team.trc }, rider));
      });
    });

    return {
      generatedAt: opts.generatedAt || new Date().toISOString(),
      source: 'wtrl.racing/zrl/myteams',
      extensionVersion: opts.extensionVersion || null,
      teamCount: teams.length,
      riderCount: riders.length,
      failures: opts.failures || [],
      teams,
      riders
    };
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

  root.WTRLFormat = {
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
