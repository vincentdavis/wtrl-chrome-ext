/**
 * Unit tests for src/report-format.js.
 *
 * The module is a classic script that assigns to the global scope, so it is
 * evaluated in a bare VM context rather than imported.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/report-format.js'), 'utf8'), context);
const F = context.WTRLFormat;

const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures', name), 'utf8'));

const teamA = fixture('team-76720.json');
const teamB = fixture('team-76637.json');

const entries = [
  { team: { name: 'COALITION ANNIHILATION', trc: 76720, season: 20 }, data: teamA },
  { team: { name: 'COALITION DELUSION', trc: 76637, season: 20 }, data: teamB }
];

const buildOpts = { extensionVersion: '0.1.0', generatedAt: '2026-08-22T12:00:00.000Z' };

test('isTeamPayload accepts the WTRL shape and rejects others', () => {
  assert.equal(F.isTeamPayload(teamA), true);
  assert.equal(F.isTeamPayload({ meta: { trc: 1 } }), false, 'needs a riders array');
  assert.equal(F.isTeamPayload({ riders: [] }), false, 'needs meta.trc');
  assert.equal(F.isTeamPayload(null), false);
  assert.equal(F.isTeamPayload([teamA]), false, 'arrays are not payloads');
});

test('buildReport carries team metadata', () => {
  const report = F.buildReport(entries, buildOpts);

  assert.equal(report.teamCount, 2);
  assert.equal(report.riderCount, 8);
  assert.equal(report.generatedAt, '2026-08-22T12:00:00.000Z');
  assert.equal(report.extensionVersion, '0.1.0');
  assert.equal(report.failures.length, 0);

  const [first] = report.teams;
  assert.equal(first.teamName, 'COALITION ANNIHILATION');
  assert.equal(first.trc, 76720);
  assert.equal(first.teamId, 8783);
  assert.equal(first.division, 'Open Orange League B');
  assert.equal(first.racingSeason, '2026/27');
  assert.equal(first.season, 20);
  assert.equal(first.round, 1);
  assert.equal(first.competitionDivision, 'B');
  assert.equal(first.registrationStatus, 'REGISTERED');
  assert.equal(first.memberCount, 6);
  assert.equal(first.riders.length, 6);
});

test('stripStats reduces riders to exactly the requested fields', () => {
  const report = F.stripStats(F.buildReport(entries, buildOpts));
  const chad = report.teams[0].riders[0];

  assert.deepEqual(Object.keys(chad), [
    'name',
    'zwid',
    'memberStatus',
    'signedup',
    'userId',
    'tmuid',
    'teams'
  ]);
  assert.equal(chad.name, 'Chad D. Peddicord');
  assert.equal(chad.zwid, 38810, 'zwid must be the Zwift profileId');
  assert.equal(chad.memberStatus, 'MEMBER');
  assert.equal(chad.signedup, false);
  assert.equal(chad.userId, '798c9567-d1cf-4afb-b382-e269d80ad37c');
  assert.equal(chad.tmuid, 457469);
  assert.equal(chad.teams, 0);
});

test('INVITED members are kept, not filtered out', () => {
  const report = F.buildReport(entries, buildOpts);
  const statuses = report.riders.map((r) => r.memberStatus);
  assert.ok(statuses.includes('INVITED'));
  assert.equal(report.riders.filter((r) => r.memberStatus === 'INVITED').length, 2);
});

test('stripStats keeps teamName and trc on flat rows', () => {
  const stripped = F.stripStats(F.buildReport(entries, buildOpts));
  assert.deepEqual(Object.keys(stripped.riders[0]), [
    'teamName',
    'trc',
    'name',
    'zwid',
    'memberStatus',
    'signedup',
    'userId',
    'tmuid',
    'teams'
  ]);
});

test('flat rider rows are tagged with their team', () => {
  const report = F.buildReport(entries, buildOpts);

  assert.equal(report.riders.length, 8);
  assert.equal(report.riders[0].teamName, 'COALITION ANNIHILATION');
  assert.equal(report.riders[0].trc, 76720);
  assert.equal(report.riders[6].teamName, 'COALITION DELUSION');
  assert.equal(report.riders[6].trc, 76637);

  // A rider on two teams appears once per team.
  assert.equal(report.riders.filter((r) => r.zwid === 87402).length, 1);
});

test('buildReport keeps stat fields and rounds the float noise away', () => {
  const report = F.buildReport(entries, buildOpts);
  const chad = report.teams[0].riders[0];

  assert.equal(chad.category, 'B');
  assert.equal(chad.zftp, 3.56, 'raw value is 3.5600000000000000532…');
  assert.equal(chad.zmap, 4.03, 'raw value is 4.0300000000000002487…');
  assert.equal(chad.zftpw, 265);
  assert.equal(chad.zmapw, 300);
  assert.equal(chad.appearancesSeason, 0);
  assert.ok('avatar' in chad);
});

test('failures are recorded on the report', () => {
  const failures = [{ trc: 1, teamName: 'Broken', error: 'Timed out' }];
  const report = F.buildReport([entries[0]], { ...buildOpts, failures });
  assert.equal(report.teamCount, 1);
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0].error, 'Timed out');
});

test('deriveTemplate replaces trc and season with placeholders', () => {
  assert.equal(
    F.deriveTemplate('https://www.wtrl.racing/zrl/api/team.php?trc=76720&season=20', teamA),
    'https://www.wtrl.racing/zrl/api/team.php?trc={trc}&season={season}'
  );
  assert.equal(
    F.deriveTemplate('https://www.wtrl.racing/zrl/myteams/76720/20/', teamA),
    'https://www.wtrl.racing/zrl/myteams/{trc}/{season}/'
  );
});

test('deriveTemplate does not corrupt other numbers that contain the season', () => {
  // season is 20 and sportsYear 2026 — "20" must not be clipped out of "2026".
  const url = 'https://www.wtrl.racing/zrl/api/2026/team.php?trc=76720&season=20';
  assert.equal(
    F.deriveTemplate(url, teamA),
    'https://www.wtrl.racing/zrl/api/2026/team.php?trc={trc}&season={season}'
  );
});

test('deriveTemplate returns null when it cannot be templatised', () => {
  assert.equal(F.deriveTemplate('https://www.wtrl.racing/zrl/api/team.php', teamA), null);
  assert.equal(F.deriveTemplate('', teamA), null);
  assert.equal(F.deriveTemplate('https://x/1', { nope: true }), null);
});

test('renderTemplate round-trips a derived template', () => {
  const url = 'https://www.wtrl.racing/zrl/api/team.php?trc=76720&season=20';
  const template = F.deriveTemplate(url, teamA);
  assert.equal(F.renderTemplate(template, { trc: 76720, season: 20 }), url);
  assert.equal(
    F.renderTemplate(template, { trc: 76637, season: 20 }),
    'https://www.wtrl.racing/zrl/api/team.php?trc=76637&season=20'
  );
  assert.equal(
    F.renderTemplate(template, { trc: 5, season: null }),
    'https://www.wtrl.racing/zrl/api/team.php?trc=5&season='
  );
});

test('toCsv emits a header plus one row per rider and quotes correctly', () => {
  const report = F.stripStats(F.buildReport(entries, buildOpts));
  const lines = F.toCsv(report).split('\n');

  assert.equal(lines.length, 9, 'header + 8 riders');
  assert.equal(
    lines[0],
    'teamName,trc,name,zwid,memberStatus,signedup,userId,tmuid,teams'
  );
  assert.equal(
    lines[1],
    'COALITION ANNIHILATION,76720,Chad D. Peddicord,38810,MEMBER,false,798c9567-d1cf-4afb-b382-e269d80ad37c,457469,0'
  );
  // Commas and quotes in a name must be escaped.
  assert.ok(lines[7].includes('"Rider, With ""Comma"""'));
});

test('toCsv handles an empty report', () => {
  assert.equal(F.toCsv({ riders: [] }), '');
  assert.equal(F.toCsv({}), '');
});

test('downloadName builds a filesystem-safe name', () => {
  const report = F.buildReport(entries, buildOpts);
  assert.equal(F.downloadName(report, 'json'), 'wtrl-team-report-2026-08-22-12-00-00.json');
  assert.equal(F.downloadName(report, 'csv'), 'wtrl-team-report-2026-08-22-12-00-00.csv');
});

test('summarise counts the things a manager acts on', () => {
  const s = F.summarise(F.buildReport(entries, buildOpts));

  assert.equal(s.teams, 2);
  assert.equal(s.rosterSpots, 8, 'one row per rider per team');
  assert.equal(s.uniqueRiders, 8, 'no rider is on two teams in these fixtures');
  assert.equal(s.members, 6);
  assert.equal(s.invited, 2, 'invited but not yet accepted');
  assert.equal(s.signedUp, 1);
  assert.equal(s.notSignedUp, 7);
  assert.equal(s.multiTeam, 0);
  assert.equal(s.noRacesThisSeason, 7, 'only one fixture rider has appearances');
});

test('multi-team riders are detected by zwid across teams', () => {
  // Put the same rider on both teams.
  const shared = JSON.parse(JSON.stringify(teamB));
  shared.riders.push(JSON.parse(JSON.stringify(teamA.riders[1])));
  const report = F.buildReport(
    [entries[0], { team: { name: 'COALITION DELUSION', trc: 76637, season: 20 }, data: shared }],
    buildOpts
  );

  const multi = F.multiTeamZwids(report);
  assert.equal(multi.size, 1);
  assert.ok(multi.has(1562251), 'Dan Klopfer is now on both teams');
  assert.equal(F.summarise(report).multiTeam, 1);
  assert.equal(F.summarise(report).uniqueRiders, 8, '9 roster spots, 8 people');
});

test('ridersByZwid groups a rider\'s team rows together', () => {
  const report = F.buildReport(entries, buildOpts);
  const byZwid = F.ridersByZwid(report);
  assert.equal(byZwid.get(38810).length, 1);
  assert.equal(byZwid.get(38810)[0].teamName, 'COALITION ANNIHILATION');
});
