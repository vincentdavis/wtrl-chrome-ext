/** Unit tests for src/heatmap.js — column scaling and palette interpolation. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/heatmap.js'), 'utf8'), context);
const H = context.WTRLHeat;

test('scaleFor maps a column onto 0..1 by its own range', () => {
  const scale = H.scaleFor([3.0, 4.0, 5.0]);
  assert.equal(scale(3.0), 0, 'lowest in column');
  assert.equal(scale(5.0), 1, 'highest in column');
  assert.equal(scale(4.0), 0.5);
});

test('scaleFor ignores gaps rather than treating them as zero', () => {
  const scale = H.scaleFor([4.0, null, undefined, 5.0, NaN]);
  assert.equal(scale(4.0), 0);
  assert.equal(scale(5.0), 1);
  assert.equal(scale(null), null, 'a missing value gets no colour');
  assert.equal(scale(undefined), null);
});

test('a column that cannot be ranked gets no shading at all', () => {
  // Shading identical values would imply a difference that is not there.
  assert.equal(H.scaleFor([4.2, 4.2, 4.2]), null);
  assert.equal(H.scaleFor([4.2]), null, 'one rider is not a comparison');
  assert.equal(H.scaleFor([]), null);
  assert.equal(H.scaleFor([null, null]), null);
});

test('values outside the original range stay clamped', () => {
  const scale = H.scaleFor([2, 4]);
  assert.equal(scale(10), 1);
  assert.equal(scale(-5), 0);
});

test('every palette runs low to high without gaps', () => {
  H.paletteNames()
    .filter((n) => n !== 'off')
    .forEach((name) => {
      [0, 0.25, 0.5, 0.75, 1].forEach((t) => {
        const rgb = H.rgbAt(t, name);
        assert.ok(Array.isArray(rgb) && rgb.length === 3, `${name} at ${t}`);
        rgb.forEach((c) => {
          assert.ok(Number.isFinite(c) && c >= 0 && c <= 255, `${name} channel in range`);
        });
      });
    });
});

test('"off" produces no colour', () => {
  assert.equal(H.rgbAt(0.5, 'off'), null);
  assert.equal(H.cellStyle(0.5, 'off'), null);
});

test('an unknown palette falls back rather than throwing', () => {
  assert.deepEqual(H.rgbAt(0.5, 'nonsense'), H.rgbAt(0.5, H.DEFAULT_PALETTE));
});

test('colour-blind safe palettes are ordered by lightness too', () => {
  // The point of these palettes: the ranking survives without colour vision,
  // so luminance must rise monotonically from one end to the other.
  ['viridis', 'cividis', 'mono'].forEach((name) => {
    const lums = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => H.luminance(H.rgbAt(t, name)));
    for (let i = 1; i < lums.length; i += 1) {
      assert.ok(
        lums[i] > lums[i - 1],
        `${name} should get steadily lighter (${lums[i - 1]} -> ${lums[i]})`
      );
    }
  });
});

test('red-green is flagged as not colour-blind safe', () => {
  assert.equal(H.paletteInfo('redgreen').safe, false);
  ['viridis', 'cividis', 'blueorange', 'mono'].forEach((name) => {
    assert.equal(H.paletteInfo(name).safe, true, `${name} should be marked safe`);
  });
});

test('text colour flips so it stays readable on light fills', () => {
  const dark = H.cellStyle(0, 'viridis');   // deep purple
  const light = H.cellStyle(1, 'viridis');  // bright yellow
  assert.equal(dark.color, '#eef1f6', 'light text on a dark fill');
  assert.equal(light.color, '#10131a', 'dark text on a bright fill');
});

test('text colour is whichever of the two contrasts better', () => {
  // A fixed lightness cutoff left light text on mid-tone fills.
  H.paletteNames()
    .filter((n) => n !== 'off')
    .forEach((name) => {
      [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1].forEach((t) => {
        const style = H.cellStyle(t, name);
        const bg = H.luminance(H.rgbAt(t, name));
        const alternative =
          style.color === '#10131a'
            ? H.contrastRatio(bg, H.luminance([238, 241, 246]))
            : H.contrastRatio(bg, H.luminance([16, 19, 26]));
        assert.ok(
          style.contrast >= alternative,
          `${name} at ${t} picked the worse text colour`
        );
      });
    });
});

test('every palette clears 3:1 across its range, and 4.5:1 at the ends', () => {
  // Heat cells render at 14px bold, where WCAG AA asks 3:1. A continuous
  // gradient must cross a band where neither black nor white reaches 4.5:1,
  // so that is the honest bar for mid-tones; the endpoints clear full AA.
  H.paletteNames()
    .filter((n) => n !== 'off')
    .forEach((name) => {
      [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1].forEach((t) => {
        const { contrast } = H.cellStyle(t, name);
        assert.ok(contrast >= 3.0, `${name} at ${t} only reached ${contrast}:1`);
      });
      [0, 1].forEach((t) => {
        const { contrast } = H.cellStyle(t, name);
        assert.ok(contrast >= 4.5, `${name} endpoint ${t} only reached ${contrast}:1`);
      });
    });
});

test('cellStyle returns nothing for a value with no rank', () => {
  assert.equal(H.cellStyle(null, 'viridis'), null);
  assert.equal(H.cellStyle(undefined, 'viridis'), null);
});
