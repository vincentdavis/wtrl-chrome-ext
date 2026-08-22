#!/usr/bin/env node
/**
 * Pre-package checks: every path the manifest and HTML pages reference must
 * exist, and every JavaScript file must parse. Run by CI before packaging.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

const exists = (relative) => fs.existsSync(path.join(ROOT, relative));

function requireFile(relative, context) {
  if (!exists(relative)) errors.push(`${context}: missing file "${relative}"`);
}

// ------------------------------------------------------------- manifest ----

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
  errors.push(`version "${manifest.version}" is not a valid extension version`);
}

Object.entries(manifest.icons || {}).forEach(([size, file]) =>
  requireFile(file, `icons.${size}`)
);

if (manifest.background?.service_worker) {
  requireFile(manifest.background.service_worker, 'background.service_worker');
}

(manifest.content_scripts || []).forEach((script, i) => {
  (script.js || []).forEach((file) => requireFile(file, `content_scripts[${i}].js`));
  (script.css || []).forEach((file) => requireFile(file, `content_scripts[${i}].css`));
  if (!script.matches?.length) errors.push(`content_scripts[${i}] has no matches`);
});

if (manifest.action?.default_popup) requireFile(manifest.action.default_popup, 'action.default_popup');
if (manifest.options_page) requireFile(manifest.options_page, 'options_page');

(manifest.web_accessible_resources || []).forEach((group, i) => {
  (group.resources || []).forEach((file) =>
    requireFile(file, `web_accessible_resources[${i}].resources`)
  );
});

// ----------------------------------------------------------------- HTML ----

for (const page of ['src/popup.html', 'src/options.html']) {
  if (!exists(page)) continue;
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const dir = path.dirname(page);
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  refs
    .filter((ref) => !/^(https?:)?\/\//.test(ref) && !ref.startsWith('data:'))
    .forEach((ref) => {
      const resolved = path.normalize(path.join(dir, ref)).split(path.sep).join('/');
      requireFile(resolved, `${page} reference`);
    });
}

// ------------------------------------------------------------ JS syntax ----

function jsFiles(dir) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...jsFiles(full));
    else if (/\.(js|mjs)$/.test(item.name)) out.push(full);
  }
  return out;
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtrl-validate-'));
for (const file of [...jsFiles(path.join(ROOT, 'src')), ...jsFiles(path.join(ROOT, 'scripts'))]) {
  const source = fs.readFileSync(file, 'utf8');
  const isModule = /^\s*(import|export)\s/m.test(source) || file.endsWith('.mjs');
  // node --check assumes CommonJS for .js, so ESM sources are checked via a
  // temporary .mjs copy.
  let target = file;
  if (isModule && !file.endsWith('.mjs')) {
    target = path.join(tempDir, path.basename(file) + '.mjs');
    fs.writeFileSync(target, source);
  }
  try {
    execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
  } catch (error) {
    errors.push(`${path.relative(ROOT, file)}: ${String(error.stderr || error).trim().split('\n')[0]}`);
  }
}
fs.rmSync(tempDir, { recursive: true, force: true });

// ---------------------------------------------------------------- report ----

if (errors.length) {
  console.error('Validation failed:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log(`Validation passed (manifest v${manifest.version}, ${manifest.name}).`);
