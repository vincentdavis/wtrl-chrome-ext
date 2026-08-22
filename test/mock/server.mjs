#!/usr/bin/env node
/**
 * Local harness that mimics the WTRL My Teams page so the content script and
 * interceptor can be exercised in a real browser without a WTRL login.
 *
 *   npm run mock   ->   http://localhost:8787/
 *
 * The team endpoint deliberately uses a URL the extension has never seen, to
 * prove the endpoint really is discovered rather than hardcoded.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8787);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

const FIXTURES = {
  76720: 'test/fixtures/team-76720.json',
  76637: 'test/fixtures/team-76637.json'
};

/**
 * A realistic stored report for previewing the extension's own pages, built by
 * running the shipped report builder over the fixtures. One rider is added to a
 * second team and appearances are varied so the table has something to show.
 */
function mockStoredReport() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/report-format.js'), 'utf8'), context);

  const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const teamA = read(FIXTURES[76720]);
  const teamB = read(FIXTURES[76637]);

  // Dan Klopfer also rides for the second team.
  teamB.riders.push(JSON.parse(JSON.stringify(teamA.riders[1])));
  teamB.riders[teamB.riders.length - 1].tmuid = 461234;
  teamB.meta.memberCount = teamB.riders.length;

  const appearances = [[4, 11], [2, 7], [0, 0], [1, 3], [5, 12], [0, 0]];
  teamA.riders.forEach((rider, i) => {
    rider.appearancesRound = appearances[i][0];
    rider.appearancesSeason = appearances[i][1];
    rider.riderpoints = appearances[i][1] * 7;
  });

  const report = context.WTRLFormat.buildReport(
    [
      { team: { name: 'COALITION ANNIHILATION', trc: 76720, season: 20 }, data: teamA },
      { team: { name: 'COALITION DELUSION', trc: 76637, season: 20 }, data: teamB }
    ],
    { extensionVersion: '0.1.0-mock', generatedAt: new Date().toISOString() }
  );

  return {
    generatedAt: report.generatedAt,
    teamCount: report.teamCount,
    riderCount: report.riderCount,
    failures: report.failures,
    report
  };
}

/** Extension pages need chrome.* to exist before their module scripts run. */
function injectShim(html) {
  const shim =
    `<script>window.__MOCK_LAST_REPORT = ${JSON.stringify(mockStoredReport())};</script>` +
    `<script src="/test/mock/chrome-shim.js"></script>`;
  return html.replace('</head>', shim + '</head>');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // The "unknown" endpoint the extension has to discover for itself.
  if (url.pathname === '/zrl/api/v3/teamdetail') {
    const trc = url.searchParams.get('trc');
    const fixture = FIXTURES[trc];
    if (!fixture) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown trc' }));
      return;
    }
    // A little latency, like the real thing.
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(path.join(ROOT, fixture)));
    }, 120);
    return;
  }

  const relative = url.pathname === '/' ? 'test/mock/myteams.html' : url.pathname.slice(1);
  const file = path.join(ROOT, relative);

  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found: ' + url.pathname);
    return;
  }

  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });

  if (relative.startsWith('src/') && relative.endsWith('.html')) {
    res.end(injectShim(fs.readFileSync(file, 'utf8')));
    return;
  }
  res.end(fs.readFileSync(file));
});

server.listen(PORT, () => {
  console.log(`Mock WTRL My Teams running at http://localhost:${PORT}/`);
});
