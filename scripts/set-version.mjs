#!/usr/bin/env node
/** Set the version in manifest.json and package.json: `npm run set-version 0.2.0`. */

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
