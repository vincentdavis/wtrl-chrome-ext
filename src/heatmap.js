/**
 * Column heatmaps for the power tables.
 *
 * Each column is scaled on its own, so a cell's colour says how that rider
 * compares with the rest of the field at that duration — comparing a 5s w/kg
 * against a 20m w/kg would be meaningless.
 *
 * Red-to-green is the familiar choice and the default, but it is also the
 * pairing that red-green colour blindness (deuteranopia and protanopia, around
 * 8% of men) cannot separate. The other palettes stay legible: viridis and
 * cividis are perceptually uniform and colour-blind safe by construction, and
 * blue-orange separates on a channel that every common form of colour blindness
 * keeps. Each palette also varies in lightness from one end to the other, so
 * the ordering survives even in greyscale.
 *
 * Pure functions, no DOM — unit-tested in Node.
 */
(function (root) {
  'use strict';

  const PALETTES = {
    redgreen: {
      label: 'Red → green',
      note: 'Familiar, but not colour-blind safe',
      safe: false,
      stops: [
        [0.0, [146, 52, 58]],
        [0.5, [124, 112, 64]],
        [1.0, [45, 118, 77]]
      ]
    },
    viridis: {
      label: 'Viridis',
      note: 'Colour-blind safe, perceptually even',
      safe: true,
      stops: [
        [0.0, [68, 1, 84]],
        [0.25, [59, 82, 139]],
        [0.5, [33, 145, 140]],
        [0.75, [94, 201, 98]],
        [1.0, [221, 227, 24]]
      ]
    },
    cividis: {
      label: 'Cividis',
      note: 'Built for colour-blind viewers',
      safe: true,
      stops: [
        [0.0, [0, 32, 76]],
        [0.33, [63, 81, 112]],
        [0.66, [128, 131, 118]],
        [1.0, [255, 234, 70]]
      ]
    },
    blueorange: {
      label: 'Blue → orange',
      note: 'Colour-blind safe diverging',
      safe: true,
      stops: [
        [0.0, [40, 104, 174]],
        [0.5, [110, 110, 118]],
        [1.0, [232, 128, 42]]
      ]
    },
    mono: {
      label: 'Monochrome',
      note: 'Lightness only — safe for everyone',
      safe: true,
      stops: [
        [0.0, [38, 43, 51]],
        [1.0, [196, 206, 222]]
      ]
    },
    off: {
      label: 'No shading',
      note: 'Plain table',
      safe: true,
      stops: null
    }
  };

  const DEFAULT_PALETTE = 'redgreen';

  function paletteNames() {
    return Object.keys(PALETTES);
  }

  function paletteInfo(name) {
    return PALETTES[name] || PALETTES[DEFAULT_PALETTE];
  }

  const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

  /**
   * Position a value within a column: 0 for the lowest, 1 for the highest.
   *
   * Returns null when the column cannot be ranked — no values, or every value
   * identical, where any shading would imply a difference that is not there.
   */
  function scaleFor(values) {
    const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (nums.length < 2) return null;

    const min = Math.min(...nums);
    const max = Math.max(...nums);
    if (max === min) return null;

    return (value) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      return clamp01((value - min) / (max - min));
    };
  }

  /** Interpolate a palette at t, returning [r, g, b]. */
  function rgbAt(t, paletteName) {
    const palette = paletteInfo(paletteName);
    if (!palette.stops) return null;

    const x = clamp01(t);
    const stops = palette.stops;

    for (let i = 0; i < stops.length - 1; i += 1) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (x >= t0 && x <= t1) {
        const span = t1 - t0 || 1;
        const k = (x - t0) / span;
        return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k));
      }
    }
    return stops[stops.length - 1][1].slice();
  }

  const css = (rgb) => (rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : null);

  /** Relative luminance, for deciding whether text on a fill should be dark. */
  function luminance(rgb) {
    const channel = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  }

  const TEXT_DARK = '#10131a';
  const TEXT_LIGHT = '#eef1f6';
  const LUM_DARK = luminance([16, 19, 26]);
  const LUM_LIGHT = luminance([238, 241, 246]);

  function contrastRatio(a, b) {
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }

  /**
   * Background and a readable foreground for one cell.
   *
   * The text colour is whichever of the two actually contrasts better against
   * this fill, rather than a fixed lightness cutoff. A continuous gradient has
   * to pass through a mid band where neither black nor white reaches 4.5:1, so
   * heat cells are rendered at 14px bold — the size at which WCAG AA asks for
   * 3:1 — and the palettes are tuned to clear that everywhere.
   */
  function cellStyle(t, paletteName) {
    if (t === null || t === undefined) return null;
    const rgb = rgbAt(t, paletteName);
    if (!rgb) return null;

    const bg = luminance(rgb);
    const useDark = contrastRatio(bg, LUM_DARK) >= contrastRatio(bg, LUM_LIGHT);
    return {
      background: css(rgb),
      color: useDark ? TEXT_DARK : TEXT_LIGHT,
      contrast: Math.round(Math.max(contrastRatio(bg, LUM_DARK), contrastRatio(bg, LUM_LIGHT)) * 100) / 100
    };
  }

  root.WTRLHeat = {
    contrastRatio,
    PALETTES,
    DEFAULT_PALETTE,
    paletteNames,
    paletteInfo,
    scaleFor,
    rgbAt,
    luminance,
    cellStyle
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
