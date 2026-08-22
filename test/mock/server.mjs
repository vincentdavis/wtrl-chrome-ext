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

  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

server.listen(PORT, () => {
  console.log(`Mock WTRL My Teams running at http://localhost:${PORT}/`);
});
