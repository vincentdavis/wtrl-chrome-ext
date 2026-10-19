/**
 * ZwiftRacing.app rider data: mapping and joining.
 *
 * zwiftracing.app is a Next.js app. Its rider JSON lives at
 * /_next/data/<buildId>/riders/<zwid>.json and is only served with the
 * `x-nextjs-data: 1` header; /api/riders/<zwid> answers 403. `riderId` is the
 * Zwift id, so this joins to everything else on zwid with no name matching.
 *
 * Pure functions, no chrome.* or DOM — unit-tested in Node.
 */
(function (root) {
  'use strict';

  /** Durations ZwiftRacing reports, matching ZwiftPower's so the two line up. */
  const ZR_DURATIONS = [
    { key: 5, label: '5s' },
    { key: 15, label: '15s' },
    { key: 30, label: '30s' },
    { key: 60, label: '1m' },
    { key: 120, label: '2m' },
    { key: 300, label: '5m' },
    { key: 1200, label: '20m' }
  ];

  const num = (value) => {
    const raw = Array.isArray(value) ? value[0] : value;
    // Number(null) and Number('') are both 0, which would turn a missing
    // reading into a real zero.
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const round = (value, places) => {
    const n = num(value);
    if (n === null) return null;
    const f = Math.pow(10, places);
    return Math.round(n * f) / f;
  };

  /**
   * ZwiftRacing reports each power figure as [value, pct, pct].
   *
   * Both trailing numbers are percentile ranks; the site does not say what each
   * is measured against, so they are carried through as given rather than
   * labelled with a meaning that might be wrong.
   */
  function powerPoint(entry) {
    if (!Array.isArray(entry)) return { value: num(entry), percentiles: [] };
    return {
      value: num(entry[0]),
      percentiles: entry.slice(1).map((p) => round(p, 1)).filter((p) => p !== null)
    };
  }

  function powerCurve(power) {
    if (!power) return [];
    return ZR_DURATIONS.map((d) => {
      const wkg = powerPoint(power['wkg' + d.key]);
      const watts = powerPoint(power['w' + d.key]);
      return {
        seconds: d.key,
        label: d.label,
        wkg: round(wkg.value, 2),
        watts: watts.value === null ? null : Math.round(watts.value),
        // The leading percentile, which is what the site shows most prominently.
        percentile: wkg.percentiles.length ? wkg.percentiles[0] : null,
        percentiles: wkg.percentiles
      };
    });
  }

  /** Flatten one ZwiftRacing rider into the fields the tables use. */
  function mapRider(rider) {
    if (!rider) return null;
    const velo = rider.velo || {};
    const factors = velo.factors || {};
    const race = rider.race || {};
    const phenotype = rider.phenotype || {};

    return {
      zwid: Number(rider.riderId) || null,
      zrName: rider.name || null,
      zrClub: (rider.club && rider.club.name) || null,
      zrWeightKg: round(rider.weight, 1),
      zrHeightCm: round(rider.height, 0),
      zrAge: rider.age || null,

      // vELO: the headline rating, and its recent peaks.
      zrVelo: round(race.rating, 0),
      zrVeloMax30: round(race.ratingMax30, 0),
      zrVeloMax90: round(race.ratingMax90, 0),

      // Race record.
      zrFinishes: num(race.finishes),
      zrWins: num(race.wins),
      zrPodiums: num(race.podiums),

      // vELO2 factors, each out of 1000.
      zrVelo2: round(velo.race, 0),
      zrSprint: round(factors.sprint, 0),
      zrPunch: round(factors.punch, 0),
      zrClimb: round(factors.climb, 0),
      zrTimeTrial: round(factors.timeTrial, 0),
      zrPursuit: round(factors.pursuit, 0),
      zrEndurance: round(factors.endurance, 0),

      zrPhenotype: phenotype.label || null,
      zrPhenotypeScores: phenotype.scores || null,

      zrPower: powerCurve(rider.power)
    };
  }

  /** The six vELO2 factors, for building columns. */
  const FACTORS = [
    { key: 'zrSprint', label: 'Sprint' },
    { key: 'zrPunch', label: 'Punch' },
    { key: 'zrClimb', label: 'Climb' },
    { key: 'zrTimeTrial', label: 'TT' },
    { key: 'zrPursuit', label: 'Pursuit' },
    { key: 'zrEndurance', label: 'Endurance' }
  ];

  /**
   * Fold ZwiftRacing riders into a report, matched on zwid.
   *
   * `riders` is a list of already-mapped riders. Anyone in the report without
   * a ZwiftRacing row is flagged rather than silently left blank.
   */
  function enrich(report, mapped, options) {
    const opts = options || {};
    const byZwid = new Map(
      (mapped || []).filter((r) => r && r.zwid).map((r) => [r.zwid, r])
    );

    const missing = [];
    const apply = (rider) => {
      const match = byZwid.get(Number(rider.zwid));
      if (!match) {
        if (rider.zwid && !missing.some((m) => m.zwid === rider.zwid)) {
          missing.push({ zwid: rider.zwid, name: rider.name });
        }
        return Object.assign({}, rider, { zrMatched: false });
      }
      // The report's own name wins; ZwiftRacing's is kept as zrName.
      const merged = Object.assign({}, rider, match, { zrMatched: true });
      merged.name = rider.name;
      return merged;
    };

    const teams = (report.teams || []).map((team) =>
      Object.assign({}, team, { riders: (team.riders || []).map(apply) })
    );
    const riders = (report.riders || []).map(apply);

    return Object.assign({}, report, {
      teams,
      riders,
      zwiftracing: {
        fetchedAt: opts.fetchedAt || new Date().toISOString(),
        requested: opts.requested ?? byZwid.size,
        matched: riders.filter((r) => r.zrMatched).length,
        missing,
        failures: opts.failures || []
      }
    });
  }

  root.WTRLZR = {
    ZR_DURATIONS,
    FACTORS,
    powerPoint,
    powerCurve,
    mapRider,
    enrich
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
