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
