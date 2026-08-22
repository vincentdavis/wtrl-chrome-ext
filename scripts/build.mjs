#!/usr/bin/env node
/**
 * Package the extension into a distributable .zip.
 *
 * Deliberately dependency-free: the ZIP container is written by hand so a clone
 * of this repo can be built with nothing but Node installed. Entries use a fixed
 * DOS timestamp, so the same source on the same Node build produces a
 * byte-identical archive. (zlib's deflate output varies between Node versions,
 * so hashes are not comparable across them — compare extracted contents.)
 */

import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

/** Everything that ships in the package. */
const INCLUDE_FILES = ['manifest.json'];
const INCLUDE_DIRS = ['src', 'icons'];

// --------------------------------------------------------------------- zip ---

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = 0x0021; // 1980-01-01

function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = entry.data;
    const deflated = deflateRawSync(raw, { level: 9 });
    // Fall back to STORE when compression makes the entry larger.
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0o644 << 16, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}

// ---------------------------------------------------------------- collect ---

function walk(dir, base = dir) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (item.name.startsWith('.')) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...walk(full, base));
    else out.push(full);
  }
  return out;
}

function collectEntries() {
  const files = [];
  for (const file of INCLUDE_FILES) files.push(path.join(ROOT, file));
  for (const dir of INCLUDE_DIRS) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) throw new Error(`Missing directory: ${dir}`);
    files.push(...walk(full));
  }
  return files
    .map((file) => ({
      name: path.relative(ROOT, file).split(path.sep).join('/'),
      data: fs.readFileSync(file)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --------------------------------------------------------------------- run ---

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const entries = collectEntries();
const zip = buildZip(entries);

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const zipName = `wtrl-zrl-team-report-v${manifest.version}.zip`;
const zipPath = path.join(DIST, zipName);
fs.writeFileSync(zipPath, zip);

const sha256 = createHash('sha256').update(zip).digest('hex');
fs.writeFileSync(path.join(DIST, `${zipName}.sha256`), `${sha256}  ${zipName}\n`);

console.log(`Packed ${entries.length} files -> dist/${zipName} (${zip.length} bytes)`);
console.log(`sha256: ${sha256}`);
