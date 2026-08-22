#!/usr/bin/env node
/**
 * Set the release version: `npm run set-version 0.2.0`.
 *
 * Updates manifest.json, package.json, and the download filename quoted in the
 * README's install steps — that filename is checked by scripts/validate.mjs, so
 * bumping by hand in only one place fails CI rather than shipping stale docs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] || '').replace(/^v/, '');

if (!/^\d+(\.\d+){0,3}$/.test(version)) {
  console.error('Usage: npm run set-version <version>   e.g. 0.2.0');
  process.exit(1);
}

for (const file of ['manifest.json', 'package.json']) {
  const full = path.join(ROOT, file);
  const json = JSON.parse(fs.readFileSync(full, 'utf8'));
  json.version = version;
  fs.writeFileSync(full, JSON.stringify(json, null, 2) + '\n');
  console.log(`${file} -> ${version}`);
}

const readmePath = path.join(ROOT, 'README.md');
const readme = fs.readFileSync(readmePath, 'utf8');
const updated = readme.replace(
  /wtrl-zrl-team-report-v[0-9][^.]*(?:\.[0-9][^.]*)*\.zip/g,
  `wtrl-zrl-team-report-v${version}.zip`
);
if (updated !== readme) {
  fs.writeFileSync(readmePath, updated);
  console.log(`README.md -> wtrl-zrl-team-report-v${version}.zip`);
}
