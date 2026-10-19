/** Unit tests for src/zr-format.js — the ZwiftRacing.app mapping and join. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/zr-format.js'), 'utf8'), context);
const Z = context.WTRLZR;

const rawRider = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'test/fixtures/zr-rider.json'), 'utf8')
);

test('mapRider pulls the headline vELO numbers', () => {
  const r = Z.mapRider(rawRider);

  assert.equal(r.zwid, 87402, 'riderId is the Zwift id, so this joins directly');
  assert.equal(r.zrVelo, 1744, 'rating rounded for display');
  assert.equal(r.zrVeloMax30, 1744);
  assert.equal(r.zrFinishes, 22);
  assert.equal(r.zrWins, 6);
  assert.equal(r.zrPodiums, 12);
});

test('mapRider rounds the vELO2 factors to whole numbers', () => {
  const r = Z.mapRider(rawRider);
  // The site shows these as integers out of 1000.
  assert.equal(r.zrSprint, 936);
  assert.equal(r.zrPunch, 916);
  assert.equal(r.zrClimb, 703);
  assert.equal(r.zrTimeTrial, 625);
  assert.equal(r.zrPursuit, 655);
  assert.equal(r.zrEndurance, 584);
  assert.equal(r.zrVelo2, 721);
});

test('mapRider keeps the phenotype and its scores', () => {
  const r = Z.mapRider(rawRider);
  assert.equal(r.zrPhenotype, 'sprinter');
  assert.equal(r.zrPhenotypeScores.sprinter, 90.5);
  assert.equal(r.zrPhenotypeScores.tt, 2.6);
});

test('powerPoint splits the [value, pct, pct] triples ZwiftRacing sends', () => {
  const p = Z.powerPoint([13.444259567387688, 97.2, 92.6]);
  assert.equal(p.value, 13.444259567387688);
  assert.deepEqual(Array.from(p.percentiles), [97.2, 92.6]);

  // A plain number still works.
  assert.equal(Z.powerPoint(245).value, 245);
  assert.equal(Z.powerPoint(null).value, null);
});

test('powerCurve carries w/kg, watts and the percentile', () => {
  const curve = Z.mapRider(rawRider).zrPower;
  assert.equal(curve.length, 7);
  assert.equal(curve.map((p) => p.label).join(','), '5s,15s,30s,1m,2m,5m,20m');

  const twenty = curve.find((p) => p.label === '20m');
  assert.equal(twenty.wkg, 4.08, 'rounded to 2dp');
  assert.equal(twenty.watts, 245);
  assert.equal(twenty.percentile, 91.1, 'the percentile ZwiftPower does not give');
});

test('weight and height come through', () => {
  const r = Z.mapRider(rawRider);
  assert.equal(r.zrWeightKg, 60.1);
  assert.equal(r.zrHeightCm, 170);
  assert.equal(r.zrClub, 'COALITION');
});

test('mapRider tolerates a sparse rider', () => {
  const r = Z.mapRider({ riderId: 1 });
  assert.equal(r.zwid, 1);
  assert.equal(r.zrVelo, null, 'absent rating is null, not 0');
  assert.equal(r.zrSprint, null);
  assert.equal(r.zrPhenotype, null);
  assert.deepEqual(Array.from(r.zrPower), []);
  assert.equal(Z.mapRider(null), null);
});

test('enrich joins ZwiftRacing riders onto a report by zwid', () => {
  const base = {
    teams: [{ teamName: 'T', riders: [
      { name: 'Vincent Davis', zwid: 87402 },
      { name: 'Someone Else', zwid: 55555 }
    ] }],
    riders: [
      { teamName: 'T', name: 'Vincent Davis', zwid: 87402 },
      { teamName: 'T', name: 'Someone Else', zwid: 55555 }
    ]
  };

  const out = Z.enrich(base, [Z.mapRider(rawRider)], {
    fetchedAt: '2026-10-19T12:00:00.000Z',
    requested: 2
  });

  assert.equal(out.zwiftracing.matched, 1);
  assert.equal(out.zwiftracing.requested, 2);
  assert.equal(out.zwiftracing.missing.length, 1);
  assert.equal(out.zwiftracing.missing[0].zwid, 55555);

  assert.equal(out.riders[0].zrMatched, true);
  assert.equal(out.riders[0].zrVelo, 1744);
  assert.equal(out.riders[0].name, 'Vincent Davis', "the report's own name is kept");
  assert.equal(out.riders[0].zrName, 'Vincent Davis  [COALITION]');

  assert.equal(out.riders[1].zrMatched, false);
  assert.equal(out.riders[1].zrVelo, undefined);

  // Nested team riders are enriched too.
  assert.equal(out.teams[0].riders[0].zrVelo, 1744);
});

test('enrich records failures so a partial pull is visible', () => {
  const base = { teams: [], riders: [] };
  const out = Z.enrich(base, [], {
    requested: 5,
    failures: [{ zwid: 1, error: 'HTTP 429' }]
  });
  assert.equal(out.zwiftracing.matched, 0);
  assert.equal(out.zwiftracing.failures.length, 1);
  assert.equal(out.zwiftracing.failures[0].error, 'HTTP 429');
});

test('a missing reading is null, never a real zero', () => {
  assert.equal(Z.powerPoint(null).value, null);
  assert.equal(Z.powerPoint(undefined).value, null);
  assert.equal(Z.powerPoint([null, 50]).value, null);
  assert.equal(Z.powerPoint(['', 50]).value, null);
  // A genuine zero still reads as zero.
  assert.equal(Z.powerPoint([0, 50]).value, 0);

  const sparse = Z.mapRider({ riderId: 1, weight: null, race: { rating: null, wins: 0 } });
  assert.equal(sparse.zrWeightKg, null);
  assert.equal(sparse.zrVelo, null);
  assert.equal(sparse.zrWins, 0, 'zero wins is a fact, not a gap');
});
