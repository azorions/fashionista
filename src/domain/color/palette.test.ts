import { describe, expect, it } from 'vitest';

import { hueDistance, rgbToOklch } from './oklab';
import { dominantSwatch, extractPalette } from './palette';

/**
 * Build an RGBA buffer. `fn` returns null for a background pixel, which is
 * written with alpha 0 — i.e. what a cutout produces.
 */
function cutout(
  w: number,
  h: number,
  fn: (x: number, y: number) => [number, number, number] | null
) {
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      const p = (y * w + x) * 4;
      if (!c) {
        buf[p + 3] = 0;
        continue;
      }
      buf[p] = c[0];
      buf[p + 1] = c[1];
      buf[p + 2] = c[2];
      buf[p + 3] = 255;
    }
  }
  return buf;
}

const RED: [number, number, number] = [200, 30, 40];
const BLUE: [number, number, number] = [40, 60, 150];
const FLOOR: [number, number, number] = [120, 95, 70]; // a wooden floor

describe('extractPalette', () => {
  it('finds a single dominant colour for a solid garment', () => {
    const p = extractPalette(cutout(32, 32, () => RED), 32, 32);
    expect(p).toHaveLength(1);
    expect(p[0].fraction).toBeCloseTo(1, 5);

    const expected = rgbToOklch({ r: RED[0], g: RED[1], b: RED[2] });
    expect(p[0].l).toBeCloseTo(expected.l, 2);
    expect(hueDistance(p[0].h, expected.h)).toBeLessThan(3);
  });

  it('IGNORES BACKGROUND PIXELS — the failure this whole function exists to prevent', () => {
    // A small garment on a large floor. If alpha were ignored, the floor would
    // dominate and every item in the closet would be "wood brown".
    const buf = cutout(40, 40, (x, y) => {
      const isGarment = x >= 14 && x < 26 && y >= 14 && y < 26;
      return isGarment ? RED : null;
    });
    // Write floor colour into the transparent pixels, as a real cutout does —
    // the RGB is still there underneath, only the alpha says to ignore it.
    for (let i = 0, p = 0; i < 40 * 40; i++, p += 4) {
      if (buf[p + 3] === 0) {
        buf[p] = FLOOR[0];
        buf[p + 1] = FLOOR[1];
        buf[p + 2] = FLOOR[2];
      }
    }

    const palette = extractPalette(buf, 40, 40);
    const red = rgbToOklch({ r: RED[0], g: RED[1], b: RED[2] });
    const floor = rgbToOklch({ r: FLOOR[0], g: FLOOR[1], b: FLOOR[2] });

    expect(hueDistance(palette[0].h, red.h)).toBeLessThan(5);
    expect(hueDistance(palette[0].h, floor.h)).toBeGreaterThan(20);
  });

  it('separates a genuinely two-tone garment', () => {
    const p = extractPalette(cutout(32, 32, (x) => (x < 16 ? RED : BLUE)), 32, 32);
    expect(p.length).toBe(2);
    expect(p[0].fraction).toBeCloseTo(0.5, 1);
    expect(p[1].fraction).toBeCloseTo(0.5, 1);
    const hues = p.map((s) => s.h);
    expect(hueDistance(hues[0], hues[1])).toBeGreaterThan(30);
  });

  // Lit-vs-shaded pairs of one real garment. Each must collapse to ONE swatch,
  // or every dark item in the closet reports a spurious second "colour".
  it.each([
    ['black tee', [20, 20, 22], [34, 34, 37]],
    ['navy', [40, 60, 150], [32, 48, 120]],
    ['red', [200, 30, 40], [170, 25, 34]],
    ['camel', [193, 154, 107], [168, 133, 92]],
    ['white', [240, 240, 238], [214, 213, 210]],
    ['deep fold on black', [20, 20, 22], [44, 44, 48]],
  ] as const)('merges a fold shadow back into its parent colour: %s', (_n, lit, shade) => {
    const p = extractPalette(
      cutout(32, 32, (x) => (x < 16 ? [...lit] as [number, number, number] : [...shade] as [number, number, number])),
      32,
      32
    );
    expect(p).toHaveLength(1);
  });

  // The other side of the same threshold: genuinely different colours on one
  // garment must NOT be merged away. These bracket the shadow band above.
  it.each([
    ['red / blue', [200, 30, 40], [40, 60, 150]],
    ['black / charcoal', [18, 18, 18], [70, 70, 72]],
    ['navy / denim', [16, 24, 64], [70, 100, 160]],
    ['forest / olive', [34, 80, 48], [110, 120, 60]],
  ] as const)('keeps distinct colours separate: %s', (_n, one, two) => {
    const p = extractPalette(
      cutout(32, 32, (x) => (x < 16 ? [...one] as [number, number, number] : [...two] as [number, number, number])),
      32,
      32
    );
    expect(p).toHaveLength(2);
  });

  it('discards a tiny logo as noise rather than calling it a garment colour', () => {
    const p = extractPalette(
      cutout(40, 40, (x, y) => (x < 3 && y < 3 ? BLUE : RED)),
      40,
      40
    );
    // 9 of 1600 px = 0.5%, far under the 6% floor.
    expect(p).toHaveLength(1);
    const red = rgbToOklch({ r: RED[0], g: RED[1], b: RED[2] });
    expect(hueDistance(p[0].h, red.h)).toBeLessThan(5);
  });

  it('is deterministic — the same cutout always gives the same swatches', () => {
    const buf = cutout(32, 32, (x, y) => (x + y) % 3 === 0 ? RED : (x % 2 ? BLUE : [90, 140, 90]));
    const a = extractPalette(buf, 32, 32);
    const b = extractPalette(buf, 32, 32);
    expect(a).toEqual(b);
  });

  it('returns swatches sorted by dominance, summing to at most 1', () => {
    const p = extractPalette(
      cutout(40, 40, (x) => (x < 24 ? RED : x < 34 ? BLUE : [230, 220, 90])),
      40,
      40
    );
    for (let i = 1; i < p.length; i++) {
      expect(p[i - 1].fraction).toBeGreaterThanOrEqual(p[i].fraction);
    }
    const sum = p.reduce((acc, s) => acc + s.fraction, 0);
    expect(sum).toBeLessThanOrEqual(1.0000001);
    expect(sum).toBeGreaterThan(0.5);
  });

  it('returns an empty palette for a fully transparent image instead of throwing', () => {
    expect(extractPalette(cutout(16, 16, () => null), 16, 16)).toEqual([]);
  });

  it('never returns more than maxSwatches', () => {
    const buf = cutout(60, 60, (x, y) => [(x * 4) % 256, (y * 4) % 256, ((x + y) * 3) % 256]);
    const p = extractPalette(buf, 60, 60, { k: 8, maxSwatches: 3 });
    expect(p.length).toBeLessThanOrEqual(3);
  });

  it('still names a colour when every cluster is below the noise floor', () => {
    // A rainbow: no single cluster reaches 6%, but the garment is not colourless.
    const buf = cutout(60, 60, (x, y) => [(x * 17) % 256, (y * 23) % 256, ((x * y) * 7) % 256]);
    const p = extractPalette(buf, 60, 60, { k: 4, minFraction: 0.95 });
    expect(p.length).toBeGreaterThanOrEqual(1);
  });

  it('handles a single garment pixel without dividing by zero', () => {
    const p = extractPalette(
      cutout(8, 8, (x, y) => (x === 0 && y === 0 ? RED : null)),
      8,
      8
    );
    expect(p).toHaveLength(1);
    expect(p[0].fraction).toBe(1);
  });
});

describe('dominantSwatch', () => {
  it('returns the largest swatch', () => {
    const p = extractPalette(cutout(32, 32, (x) => (x < 26 ? RED : BLUE)), 32, 32);
    const red = rgbToOklch({ r: RED[0], g: RED[1], b: RED[2] });
    expect(hueDistance(dominantSwatch(p)!.h, red.h)).toBeLessThan(5);
  });

  it('is undefined for an empty palette', () => {
    expect(dominantSwatch([])).toBeUndefined();
  });
});
