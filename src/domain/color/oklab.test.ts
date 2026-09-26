import { converter } from 'culori';
import { describe, expect, it } from 'vitest';

import {
  hexToRgb,
  hueDistance,
  isNeutral,
  oklabDistance,
  oklchToRgb,
  rgbToHex,
  rgbToOklab,
  rgbToOklch,
  srgbToLinear,
  linearToSrgb,
  type Rgb,
} from './oklab';

// culori is a DEV-ONLY dependency. It exists purely so these hand-rolled
// conversions are checked against a reference implementation; the app itself
// never imports it, which is why the runtime has no colour dependency at all.
const culoriOklch = converter('oklch');

const SAMPLES: [string, Rgb][] = [
  ['white', { r: 255, g: 255, b: 255 }],
  ['black', { r: 0, g: 0, b: 0 }],
  ['mid grey', { r: 128, g: 128, b: 128 }],
  ['red', { r: 255, g: 0, b: 0 }],
  ['green', { r: 0, g: 255, b: 0 }],
  ['blue', { r: 0, g: 0, b: 255 }],
  ['navy', { r: 16, g: 24, b: 64 }],
  ['indigo denim', { r: 40, g: 60, b: 110 }],
  ['camel', { r: 193, g: 154, b: 107 }],
  ['dusty pink', { r: 222, g: 165, b: 164 }],
  ['forest', { r: 34, g: 80, b: 48 }],
];

describe('sRGB transfer function', () => {
  it('round-trips', () => {
    for (let i = 0; i <= 100; i++) {
      const v = i / 100;
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 10);
    }
  });

  it('is linear below the knee and curved above it', () => {
    expect(srgbToLinear(0.02)).toBeCloseTo(0.02 / 12.92, 12);
    expect(srgbToLinear(1)).toBeCloseTo(1, 10);
  });
});

describe('agreement with culori', () => {
  it.each(SAMPLES)('matches culori OKLCh for %s', (_name, rgb) => {
    const mine = rgbToOklch(rgb);
    const ref = culoriOklch({ mode: 'rgb', r: rgb.r / 255, g: rgb.g / 255, b: rgb.b / 255 });

    expect(mine.l).toBeCloseTo(ref.l, 4);
    expect(mine.c).toBeCloseTo(ref.c ?? 0, 4);

    // Hue is undefined for achromatic colours; culori reports NaN/undefined there.
    if ((ref.c ?? 0) > 1e-4 && ref.h !== undefined && !Number.isNaN(ref.h)) {
      expect(hueDistance(mine.h, ref.h)).toBeLessThan(0.1);
    }
  });
});

describe('round trips', () => {
  it.each(SAMPLES)('rgb -> oklch -> rgb is lossless for %s', (_name, rgb) => {
    const back = oklchToRgb(rgbToOklch(rgb));
    expect(back.r).toBeCloseTo(rgb.r, 0);
    expect(back.g).toBeCloseTo(rgb.g, 0);
    expect(back.b).toBeCloseTo(rgb.b, 0);
  });

  it('survives a sweep of the cube within one 8-bit step', () => {
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          const back = oklchToRgb(rgbToOklch({ r, g, b }));
          expect(Math.abs(back.r - r)).toBeLessThanOrEqual(1);
          expect(Math.abs(back.g - g)).toBeLessThanOrEqual(1);
          expect(Math.abs(back.b - b)).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('hex', () => {
  it('parses long and short form', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('f00')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('round-trips through hex', () => {
    expect(rgbToHex(hexToRgb('#1b1a19'))).toBe('#1b1a19');
  });

  it('clamps out-of-range channels rather than emitting invalid hex', () => {
    expect(rgbToHex({ r: 300, g: -20, b: 128 })).toBe('#ff0080');
  });
});

describe('lightness is perceptual, unlike HSL', () => {
  it('ranks yellow as much lighter than blue — the case HSL gets wrong', () => {
    // In HSL both are lightness 50%. Any "keep lightness close" rule built on
    // HSL would call these a match; in OKLCh they are far apart, correctly.
    const yellow = rgbToOklch({ r: 255, g: 255, b: 0 });
    const blue = rgbToOklch({ r: 0, g: 0, b: 255 });
    expect(yellow.l).toBeGreaterThan(0.9);
    expect(blue.l).toBeLessThan(0.55);
    expect(yellow.l - blue.l).toBeGreaterThan(0.4);
  });
});

describe('hue linearity in blue', () => {
  it('keeps navy and indigo denim analogous, which is why OKLCh was chosen', () => {
    const navy = rgbToOklch({ r: 16, g: 24, b: 64 });
    const denim = rgbToOklch({ r: 40, g: 60, b: 110 });
    // Both are blues a stylist would call analogous. CIELAB's blue hue drift
    // is what would push these apart as chroma changes.
    expect(hueDistance(navy.h, denim.h)).toBeLessThan(30);
  });
});

describe('isNeutral', () => {
  it('treats greys, black and white as neutral', () => {
    for (const v of [0, 64, 128, 200, 255]) {
      expect(isNeutral(rgbToOklch({ r: v, g: v, b: v }))).toBe(true);
    }
  });

  it('does not treat a saturated garment colour as neutral', () => {
    expect(isNeutral(rgbToOklch({ r: 200, g: 30, b: 40 }))).toBe(false);
  });

  it('treats a desaturated beige as neutral — it goes with anything', () => {
    expect(isNeutral(rgbToOklch({ r: 214, g: 208, b: 200 }))).toBe(true);
  });
});

describe('hueDistance', () => {
  it('wraps around 360', () => {
    expect(hueDistance(350, 10)).toBeCloseTo(20, 6);
    expect(hueDistance(10, 350)).toBeCloseTo(20, 6);
  });

  it('never exceeds 180', () => {
    for (let a = 0; a < 360; a += 17) {
      for (let b = 0; b < 360; b += 23) {
        const d = hueDistance(a, b);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(180);
      }
    }
  });
});

describe('oklabDistance', () => {
  it('is zero for identical colours', () => {
    const c = rgbToOklab({ r: 100, g: 120, b: 140 });
    expect(oklabDistance(c, c)).toBe(0);
  });

  it('separates a shadow from a genuinely different colour', () => {
    const black = rgbToOklab({ r: 20, g: 20, b: 20 });
    const shadowOfBlack = rgbToOklab({ r: 38, g: 38, b: 40 });
    const red = rgbToOklab({ r: 200, g: 30, b: 40 });
    expect(oklabDistance(black, shadowOfBlack)).toBeLessThan(oklabDistance(black, red));
  });
});
