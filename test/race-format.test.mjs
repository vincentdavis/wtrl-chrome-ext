/**
 * Unit tests for src/race-format.js — the WTRL results <-> ZwiftPower join.
 *
 * The fixtures carry the awkward real-world names that actually broke this:
 * HTML-entity emoji, Polish Ł, accents, and an embedded [Team] tag.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/race-format.js'), 'utf8'), context);
const R = context.WTRLRace;

const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures', name), 'utf8'));

const wtrlPayload = fixture('race-wtrl-results.json');
const zpRows = fixture('race-zp-event.json').data;

const buildOpts = { extensionVersion: '0.6.0', generatedAt: '2026-10-18T10:00:00.000Z' };

test('zpNum unwraps ZwiftPower [value, flag] pairs', () => {
  assert.equal(R.zpNum(['4.6', 1]), 4.6);
  assert.equal(R.zpNum([310, 0]), 310);
  assert.equal(R.zpNum('300'), 300);
  assert.equal(R.zpNum(null), null);
  assert.equal(R.zpNum(['', 0]), null, 'empty string is not zero');
  assert.equal(R.zpFlag(['4.6', 1]), 1, 'the flag marks a personal best');
  assert.equal(R.zpFlag(['4.6', 0]), 0);
});

test('normalizeName survives the names that actually occur', () => {
  // HTML-entity emoji: the digits used to become the surname.
  assert.equal(R.normalizeName('Martin Nohammar&#129512;[eSRT]'), 'martin nohammar');
  assert.equal(R.normalizeName('Sam Mobberley &#9419;'), 'sam mobberley');
  // Polish Ł has no NFD decomposition.
  assert.equal(R.normalizeName('Łukasz Fiałkowski'), 'lukasz fialkowski');
  // Accents.
  assert.equal(R.normalizeName('Rui Catalão'), 'rui catalao');
  // WTRL sometimes carries a team tag too.
  assert.equal(R.normalizeName('K. Wojtas [eBodzio Team]'), 'k wojtas');
});

test('nameKey pairs an abbreviated WTRL name with a full ZwiftPower one', () => {
  const pairs = [
    ['S. Joneström', 'Stefan Jonestrom[eSRT]'],
    ['M. Nohammar', 'Martin Nohammar&#129512;[eSRT]'],
    ['Ł. Fiałkowski', 'Łukasz Fiałkowski [eBodzio Team]'],
    ['R. Catalão', 'Rui Catalao [Team Vegan]'],
    ['j. sandström nordqvist', 'John-Assar Nordqvist[@Windriders]']
  ];
  pairs.forEach(([wtrl, zp]) => {
    assert.equal(R.nameKey(wtrl).key, R.nameKey(zp).key, `${wtrl} should match ${zp}`);
  });
});

test('nameKey ignores numeric junk left by stripped badges', () => {
  assert.equal(R.nameKey('Martin Nohammar 2026').last, 'nohammar');
  assert.equal(R.nameKey(''), null);
});

test('wtrlRiders flattens teams and keeps the ZRL team name', () => {
  const rows = R.wtrlRiders(wtrlPayload);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].zrlTeam, 'Windriders');
  assert.equal(rows[5].zrlTeam, 'Vegan Albatrosses');
  assert.equal(rows[0].zid, 5735846);
});

test('eventIdFrom recovers the Zwift event id, the only usable join key', () => {
  assert.equal(R.eventIdFrom(wtrlPayload), 5735846);
  assert.equal(R.eventIdFrom({ payload: [] }), null);
});

test('powerCurve returns every duration shortest-first, in watts and w/kg', () => {
  const curve = R.powerCurve(zpRows[0]);
  assert.equal(curve.length, 7);
  assert.equal(curve.map((p) => p.label).join(','), '5s,15s,30s,1m,2m,5m,20m');
  assert.equal(curve[0].wkg, 7.7);
  assert.equal(curve[0].watts, 519);
  assert.equal(curve[6].wkg, 4.6, '20 minute w/kg');
  assert.equal(curve[6].best, 1, 'flagged as a personal best');
});

test('buildRaceReport joins WTRL teams to ZwiftPower power', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows, ...buildOpts });

  assert.equal(report.riderCount, 6);
  assert.equal(report.matchedCount, 5, 'B. Howell is absent from ZwiftPower');
  assert.equal(report.fieldSize, 6, 'the full ZwiftPower field, not just our division');
  assert.equal(report.race.zid, 5735846);
  assert.equal(report.generatedAt, '2026-10-18T10:00:00.000Z');

  const stefan = report.riders.find((r) => r.name === 'S. Joneström');
  assert.equal(stefan.matched, true);
  assert.equal(stefan.zwid, 7592135, 'the zwid WTRL would not give us');
  assert.equal(stefan.zrlTeam, 'Windriders', 'ZRL team from WTRL');
  assert.equal(stefan.zpTeam, 'eSRT', 'club from ZwiftPower');
  assert.equal(stefan.weightKg, 67.4);
  assert.equal(stefan.raceFtpW, 283);
  assert.equal(stefan.verified, true);
  assert.equal(stefan.powerCurve[6].wkg, 4.6);
});

test('a rider missing from ZwiftPower is reported, not silently mis-joined', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows, ...buildOpts });

  assert.equal(report.unmatched.length, 1);
  assert.equal(report.unmatched[0].name, 'B. Howell');
  assert.equal(report.unmatched[0].zrlTeam, 'Vegan Albatrosses');

  // The row survives with its WTRL data, just without power.
  const howell = report.riders.find((r) => r.name === 'B. Howell');
  assert.equal(howell.matched, false);
  assert.equal(howell.zrlTeam, 'Vegan Albatrosses');
  assert.equal(howell.zwid, undefined);
});

test('one ZwiftPower row is never claimed by two WTRL riders', () => {
  const doubled = {
    payload: [
      { teamname: 'Dup', a: [
        { name: 'S. Joneström', zid: 5735846 },
        { name: 'S. Joneström', zid: 5735846 }
      ] }
    ]
  };
  const report = R.buildRaceReport({ wtrlPayload: doubled, zpRows, ...buildOpts });
  assert.equal(report.matchedCount, 1, 'second copy finds no free row');
  assert.equal(report.unmatched.length, 1);
});

test('careerBests takes the maximum at each duration across all races', () => {
  const history = [
    { wkg5: ['7.0', 0], w5: ['480', 0], wkg1200: ['4.2', 0], w1200: ['290', 0] },
    { wkg5: ['8.5', 1], w5: ['560', 0], wkg1200: ['4.0', 0], w1200: ['275', 0] },
    { wkg5: ['6.1', 0], w5: ['420', 0], wkg1200: ['4.9', 1], w1200: ['330', 0] }
  ];
  const bests = R.careerBests(history);
  const five = bests.find((b) => b.label === '5s');
  const twenty = bests.find((b) => b.label === '20m');

  assert.equal(five.wkg, 8.5);
  assert.equal(five.watts, 560);
  assert.equal(twenty.wkg, 4.9, 'best 20min comes from a different race than best 5s');
  assert.equal(twenty.watts, 330);
  assert.equal(R.careerBests([]).every((b) => b.wkg === null), true);
});

test('raceToCsvRows spreads the power curve into flat columns', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows, ...buildOpts });
  const rows = R.raceToCsvRows(report);

  assert.equal(rows.length, 6);
  const keys = Object.keys(rows[0]);
  assert.ok(keys.includes('wkg_20m'), 'per-duration columns');
  assert.ok(keys.includes('w_5s'));
  assert.equal(rows[0].zrlTeam, 'Windriders');
  assert.equal(rows[0].zwid, 7592135);

  // The unmatched rider still produces a row, with blanks for power.
  const howell = rows.find((r) => r.name === 'B. Howell');
  assert.equal(howell.matched, false);
  assert.equal(howell.zwid, '');
});

test('displayName strips entity emoji and team tags for presentation', () => {
  assert.equal(R.displayName('Martin Nohammar&#129512;[eSRT]'), 'Martin Nohammar');
  assert.equal(R.displayName('Sam Mobberley &#9419;'), 'Sam Mobberley');
  assert.equal(R.displayName('David Pugh &#127793; [Team Veg'), 'David Pugh');
  assert.equal(R.displayName('Łukasz Fiałkowski [eBodzio Team]'), 'Łukasz Fiałkowski',
    'accented letters are kept — this is for display, not matching');
});

test('the report carries clean display names', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows, ...buildOpts });
  const martin = report.riders.find((r) => r.name === 'M. Nohammar');
  assert.equal(martin.zpName, 'Martin Nohammar');
  const sam = report.riders.find((r) => r.name === 'S. Mobberley');
  assert.equal(sam.zpName, 'Sam Mobberley');
});

// ------------------------------------------------------- roster enrichment ---

const rosterRows = fixture('zp-team-roster.json').data;

test('categoryFromDiv decodes the ZwiftPower division scale', () => {
  assert.equal(R.categoryFromDiv(5), 'A+');
  assert.equal(R.categoryFromDiv(10), 'A');
  assert.equal(R.categoryFromDiv(20), 'B');
  assert.equal(R.categoryFromDiv(30), 'C');
  assert.equal(R.categoryFromDiv(40), 'D');
  assert.equal(R.categoryFromDiv(0), null, '0 means unranked, not a category');
  assert.equal(R.categoryFromDiv(''), null);
  assert.equal(R.categoryFromDiv(99), null);
});

test('mapRosterRider unwraps values and never carries email', () => {
  const chad = R.mapRosterRider(rosterRows[0]);

  assert.equal(chad.zwid, 38810);
  assert.equal(chad.zpCategory, 'B');
  assert.equal(chad.zpFtpW, 242, 'unwrapped from ["242", 0]');
  assert.equal(chad.zpWeightKg, 76.2);
  assert.equal(chad.zpRank, 240.83);
  assert.equal(chad.zpSkill, 7062);
  assert.equal(chad.zp20minW, 264);
  assert.equal(chad.zp20minWkg, 3.5);
  assert.equal(chad.zpRegistered, true);

  assert.equal('email' in chad, false, 'email must never leave the bridge');
  assert.equal(
    Object.keys(chad).some((k) => /mail/i.test(k)),
    false
  );
});

test('missing roster readings stay null rather than becoming zero', () => {
  const kyle = R.mapRosterRider(rosterRows[2]);
  assert.equal(kyle.zp20minW, null, 'empty string must not render as 0 W');
  assert.equal(kyle.zp20minWkg, null);
  assert.equal(kyle.zpRank, null);
  assert.equal(kyle.zpSkill, null);
  assert.equal(kyle.zpRegistered, false);
  // Values that are present still come through.
  assert.equal(kyle.zpFtpW, 276);
});

test('sanitiseRoster drops rows without a Zwift id and strips email', () => {
  const rows = rosterRows.concat([{ zwid: 0, name: 'Ghost', email: 'x@y.z' }]);
  const clean = R.sanitiseRoster(rows);
  assert.equal(clean.length, rosterRows.length);
  assert.equal(
    JSON.stringify(clean).toLowerCase().includes('email'),
    false
  );
});

test('enrichWithZwiftPower joins the roster onto a team report by zwid', () => {
  const base = {
    teamCount: 1,
    riderCount: 3,
    teams: [
      {
        teamName: 'COALITION ANNIHILATION',
        trc: 76720,
        riders: [
          { name: 'Chad D. Peddicord', zwid: 38810, category: 'B' },
          { name: 'Kyle Maloney', zwid: 6934646, category: 'C' },
          { name: 'Nobody Known', zwid: 11111, category: 'B' }
        ]
      }
    ],
    riders: [
      { teamName: 'COALITION ANNIHILATION', name: 'Chad D. Peddicord', zwid: 38810, category: 'B' },
      { teamName: 'COALITION ANNIHILATION', name: 'Kyle Maloney', zwid: 6934646, category: 'C' },
      { teamName: 'COALITION ANNIHILATION', name: 'Nobody Known', zwid: 11111, category: 'B' }
    ]
  };

  const out = R.enrichWithZwiftPower(base, rosterRows, {
    teamId: 11991,
    teamName: 'COALITION',
    fetchedAt: '2026-10-19T09:00:00.000Z'
  });

  assert.equal(out.zwiftpower.teamId, 11991);
  assert.equal(out.zwiftpower.rosterSize, 5);
  assert.equal(out.zwiftpower.matched, 2);
  assert.equal(out.zwiftpower.missing.length, 1);
  assert.equal(out.zwiftpower.missing[0].zwid, 11111);

  const chad = out.riders[0];
  assert.equal(chad.zpMatched, true);
  assert.equal(chad.zpFtpW, 242);
  assert.equal(chad.zpCategory, 'B');
  assert.equal(chad.name, 'Chad D. Peddicord', "WTRL's name is kept");
  assert.equal(chad.category, 'B', "WTRL's category is kept");
  assert.equal(chad.categoryMismatch, false);

  const unknown = out.riders[2];
  assert.equal(unknown.zpMatched, false);
  assert.equal(unknown.zpFtpW, undefined);
});

test('a WTRL category that disagrees with ZwiftPower is flagged', () => {
  // Kyle races C in WTRL but sits in div 20 (B) on ZwiftPower — the real case
  // that makes this join worth doing.
  const base = {
    teams: [{ teamName: 'T', trc: 1, riders: [{ name: 'Kyle Maloney', zwid: 6934646, category: 'C' }] }],
    riders: [{ teamName: 'T', name: 'Kyle Maloney', zwid: 6934646, category: 'C' }]
  };
  const out = R.enrichWithZwiftPower(base, rosterRows, {});

  assert.equal(out.riders[0].category, 'C');
  assert.equal(out.riders[0].zpCategory, 'B');
  assert.equal(out.riders[0].categoryMismatch, true);
});

test('enrichment reaches the nested teams as well as the flat rows', () => {
  const base = {
    teams: [{ teamName: 'T', trc: 1, riders: [{ name: 'Dan Klopfer', zwid: 1562251, category: 'B' }] }],
    riders: [{ teamName: 'T', name: 'Dan Klopfer', zwid: 1562251, category: 'B' }]
  };
  const out = R.enrichWithZwiftPower(base, rosterRows, {});
  assert.equal(out.teams[0].riders[0].zpSkill, 7174);
  assert.equal(out.teams[0].riders[0].zpRole, 'Owner');
  assert.equal(out.riders[0].zpSkill, 7174);
});

test('enrichment leaves an unenriched report untouched apart from the marker', () => {
  const base = { teams: [], riders: [] };
  const out = R.enrichWithZwiftPower(base, [], { teamId: 1 });
  assert.equal(out.zwiftpower.rosterSize, 0);
  assert.equal(out.zwiftpower.matched, 0);
  assert.equal(out.riders.length, 0);
});

test('the enriched report carries raw ZwiftPower rows for its own riders only', () => {
  const base = {
    teams: [{ teamName: 'T', trc: 1, riders: [{ name: 'Chad', zwid: 38810, category: 'B' }] }],
    riders: [{ teamName: 'T', name: 'Chad', zwid: 38810, category: 'B' }]
  };
  const out = R.enrichWithZwiftPower(base, rosterRows, { teamId: 11991 });

  // Raw rows let a server redo the join without the extension's opinion.
  assert.equal(out.zwiftpower.roster.length, 1);
  assert.equal(out.zwiftpower.roster[0].zwid, 38810);
  assert.equal(out.zwiftpower.roster[0].zpFtpW, 242);
  assert.equal(out.zwiftpower.rosterSize, 5, 'the club is larger than the report');

  // Club members who are not in the report are not shipped.
  assert.equal(out.zwiftpower.roster.some((r) => r.zwid === 999999), false);
  assert.equal(JSON.stringify(out).toLowerCase().includes('email'), false);
});

test('stripStats keeps the zwiftpower block while trimming rider fields', () => {
  const context2 = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/report-format.js'), 'utf8'), context2);
  const F = context2.WTRLFormat;

  const base = {
    teams: [{ teamName: 'T', trc: 1, riders: [{ name: 'Chad', zwid: 38810, category: 'B',
      memberStatus: 'MEMBER', signedup: false, userId: 'u', tmuid: 1, teams: 0 }] }],
    riders: [{ teamName: 'T', trc: 1, name: 'Chad', zwid: 38810, category: 'B',
      memberStatus: 'MEMBER', signedup: false, userId: 'u', tmuid: 1, teams: 0 }]
  };
  const enriched = R.enrichWithZwiftPower(base, rosterRows, { teamId: 11991 });
  const stripped = F.stripStats(enriched);

  assert.equal(stripped.zwiftpower.teamId, 11991, 'the raw rows survive for the server');
  assert.equal(stripped.zwiftpower.roster.length, 1);
  assert.equal(stripped.riders[0].zpFtpW, undefined, 'per-rider extras are trimmed');
  assert.equal(stripped.riders[0].zwid, 38810, 'the join key is still there');
});

// ------------------------------------------------------------ team view ---

test('wtrlTeams keeps WTRL team scoring alongside the riders', () => {
  const teams = R.wtrlTeams(wtrlPayload);
  assert.equal(teams.length, 2);
  assert.equal(teams[0].teamName, 'Windriders');
  assert.equal(teams[0].riderCount, 3);
  assert.equal(teams[0].division, 'A');
});

test('buildRaceReport aggregates ZwiftPower power per team', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows, ...buildOpts });

  assert.equal(report.teams.length, 2);
  const wind = report.teams.find((t) => t.teamName === 'Windriders');

  assert.equal(wind.riderCount, 3);
  assert.equal(wind.matchedCount, 3);
  // Stefan 4.6, Martin 4.3, Łukasz 4.1
  assert.equal(wind.avg.wkg20m, 4.33);
  assert.equal(wind.median.wkg20m, 4.3);
  assert.equal(wind.best.wkg20m, 4.6);
  assert.equal(wind.avg.weightKg, 71.5);
});

test('team averages exclude riders with no ZwiftPower row', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows, ...buildOpts });
  const vegan = report.teams.find((t) => t.teamName === 'Vegan Albatrosses');

  // Three riders, but B. Howell has no ZwiftPower data.
  assert.equal(vegan.riderCount, 3);
  assert.equal(vegan.matchedCount, 2);

  // Sam 4.0 and Rui 3.9 -> 3.95. Counting Howell as zero would give 2.63.
  assert.equal(vegan.avg.wkg20m, 3.95);
  assert.ok(vegan.avg.wkg20m > 3.9, 'a missing rider must not drag the average down');
});

test('every team in the race is aggregated, not just ours', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows, ...buildOpts });
  assert.equal(
    report.teams.map((t) => t.teamName).sort().join('|'),
    'Vegan Albatrosses|Windriders'
  );
  report.teams.forEach((t) => {
    assert.ok(Array.isArray(t.riders), 'each team carries its riders for expansion');
    assert.ok(t.riders.length > 0);
  });
});

test('a team with no ZwiftPower data at all yields nulls, not zeros', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows: [], ...buildOpts });
  const wind = report.teams.find((t) => t.teamName === 'Windriders');
  assert.equal(wind.matchedCount, 0);
  assert.equal(wind.avg.wkg20m, null, 'no data is null, never 0.00');
  assert.equal(wind.best.wkg20m, null);
  assert.equal(wind.median.wkg20m, null);
});

test('category mix is counted per team', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows, ...buildOpts });
  const wind = report.teams.find((t) => t.teamName === 'Windriders');
  assert.equal(Object.values(wind.categories).reduce((a, b) => a + b, 0), 3);
});

test('WTRL numeric categories become letters, matched or not', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows, ...buildOpts });

  // WTRL sends 10; ZwiftPower sends "A". Both must read as "A", otherwise an
  // unmatched rider shows up as its own category in the team mix.
  report.riders.forEach((r) => {
    assert.equal(r.category, 'A', `${r.name} should be category A`);
  });

  const howell = report.riders.find((r) => r.name === 'B. Howell');
  assert.equal(howell.matched, false);
  assert.equal(howell.category, 'A', 'an unmatched rider still gets a letter');
  assert.equal(howell.categoryCode, 10, 'the raw WTRL code is kept');

  report.teams.forEach((team) => {
    assert.deepEqual(Object.keys(team.categories), ['A']);
  });
});

test('ZwiftPower race category is kept separately from WTRL category', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows, ...buildOpts });
  const stefan = report.riders.find((r) => r.name === 'S. Joneström');
  assert.equal(stefan.category, 'A', "WTRL's");
  assert.equal(stefan.zpRaceCategory, 'A', "ZwiftPower's, held separately");
});

test('team rows carry WTRL scoring beside the power averages', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows, ...buildOpts });
  const wind = report.teams.find((t) => t.teamName === 'Windriders');
  assert.equal(wind.position, 1);
  // The fixture's team row is the sum of its riders, as WTRL scores it.
  assert.equal(wind.points.total, 219);
  assert.equal(wind.points.fal, 184);
  assert.equal(wind.avg.wkg20m, 4.33, 'ZwiftPower average sits beside WTRL points');
});

test('teamsToCsvRows flattens the team view for export', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows, ...buildOpts });
  const rows = R.teamsToCsvRows(report);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].team, 'Windriders');
  assert.equal(rows[0].position, 1);
  assert.equal(rows[0].pointsTotal, 219);
  assert.equal(rows[0].ridersWithPower, 3);
  assert.equal(rows[0].avgWkg20m, 4.33);
  assert.equal(rows[0].categories, '3A');

  // A team with partial coverage exports blanks, not zeros.
  const noPower = R.teamsToCsvRows(R.buildRaceReport({ wtrlPayload, zpRows: [], ...buildOpts }));
  assert.equal(noPower[0].avgWkg20m, '');
  assert.equal(noPower[0].ridersWithPower, 0);
});

// --------------------------------------------------------- per-rider points ---

test('per-rider ZRL points come through from the results payload', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows, ...buildOpts });
  const stefan = report.riders.find((r) => r.name === 'S. Joneström');

  assert.equal(stefan.falPoints, 85, 'first across the line');
  assert.equal(stefan.ftsPoints, 3, 'fastest through segment');
  assert.equal(stefan.finPoints, 12, 'finish');
  assert.equal(stefan.pbpPoints, 0);
  assert.equal(stefan.totalPoints, 100);
});

test('rider points sum to the team row, as WTRL scores them', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows, ...buildOpts });

  report.teams.forEach((team) => {
    if (!team.points || team.points.total === null) return;
    const sum = (key) => team.riders.reduce((n, r) => n + (r[key] || 0), 0);
    assert.equal(sum('falPoints'), team.points.fal, `${team.teamName} FAL`);
    assert.equal(sum('ftsPoints'), team.points.fts, `${team.teamName} FTS`);
    assert.equal(sum('finPoints'), team.points.fin, `${team.teamName} FIN`);
    assert.equal(sum('totalPoints'), team.points.total, `${team.teamName} total`);
  });
});

test('an unscored round reads as zero points, not missing', () => {
  // WTRL returns 0 for every points field until a round is finalised.
  const unscored = JSON.parse(JSON.stringify(wtrlPayload));
  unscored.payload.forEach((t) =>
    t.a.forEach((a) => {
      a.falrp = 0; a.ftsrp = 0; a.finrp = 0; a.pbprp = 0; a.totrp = 0;
    })
  );
  const report = R.buildRaceReport({ wtrlPayload: unscored, zpRows, ...buildOpts });
  report.riders.forEach((r) => {
    assert.equal(r.totalPoints, 0);
    assert.notEqual(r.totalPoints, null, 'zero is a real score, not absence');
  });
});

test('points reach the CSV export', () => {
  const report = R.buildRaceReport({ wtrlPayload, zpRows, ...buildOpts });
  const rows = R.raceToCsvRows(report);
  const keys = Object.keys(rows[0]);
  ['falPoints', 'ftsPoints', 'finPoints', 'pbpPoints', 'totalPoints'].forEach((k) => {
    assert.ok(keys.includes(k), `CSV should carry ${k}`);
  });
  assert.equal(rows[0].falPoints, 85);
  assert.equal(rows[0].totalPoints, 100);
});

// ------------------------------------------------------- league standings ---

const leaguePayload = fixture('race-league.json');

test('mapLeagueStandings decodes WTRL single-letter league fields', () => {
  const rows = R.mapLeagueStandings(leaguePayload);
  assert.equal(rows.length, 4);

  const dirt = rows[0];
  assert.equal(dirt.rank, 1);
  assert.equal(dirt.teamName, 'DIRT OG');
  assert.equal(dirt.teamId, '5949');
  assert.equal(dirt.roundsRaced, 3);
  assert.equal(dirt.leaguePoints, 17);
  // Decoded by reconciling against the summed race results.
  assert.equal(dirt.falPoints, 546);
  assert.equal(dirt.ftsPoints, 134);
  assert.equal(dirt.finPoints, 225);
  assert.equal(dirt.pbpPoints, 48);
});

test('round points sum to the league total', () => {
  R.mapLeagueStandings(leaguePayload).forEach((row) => {
    const sum = row.roundPoints.reduce((a, b) => a + b, 0);
    assert.equal(
      sum,
      row.leaguePointsBeforePenalty,
      `${row.teamName}: rounds ${row.roundPoints.join('+')} should equal ${row.leaguePointsBeforePenalty}`
    );
  });
});

test('a penalty is applied to the standing, not hidden', () => {
  const penalised = R.mapLeagueStandings(leaguePayload).find((r) => r.teamName === 'Penalised Team');
  assert.equal(penalised.leaguePointsBeforePenalty, 8);
  assert.equal(penalised.penalty, 2);
  assert.equal(penalised.leaguePoints, 6, 'the standing shows points after the penalty');
});

test('season race points are the four components added up', () => {
  const dirt = R.mapLeagueStandings(leaguePayload)[0];
  assert.equal(dirt.racePoints, 546 + 134 + 225 + 48);
});

test('roundsPlayed finds how far the season has got', () => {
  assert.equal(R.roundsPlayed(R.mapLeagueStandings(leaguePayload)), 3);

  // An unraced division should not claim any rounds.
  const fresh = R.mapLeagueStandings({
    payload: [{ c: 1, d: 'New', r1: '0', r2: '0', l: 0, j: 0, n: 0 }]
  });
  assert.equal(R.roundsPlayed(fresh), 0);
});

test('an empty league payload is handled', () => {
  assert.deepEqual(R.mapLeagueStandings({ payload: [] }).length, 0);
  assert.deepEqual(R.mapLeagueStandings({}).length, 0);
  assert.equal(R.roundsPlayed([]), 0);
});
