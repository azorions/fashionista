import { describe, expect, it } from 'vitest';

import { band } from './score';
import { SOFT, VIBE_LIST } from './vibes';

/**
 * band() has now been wrong twice, both times in a way a spot check missed.
 * The second time was introduced while fixing the first: leaving a band scored
 * HIGHER than standing on its edge (SOFT warmth 6.5 -> 0.500, 6.6 -> 0.956).
 *
 * So this checks the properties, over every axis every vibe actually declares,
 * rather than a handful of hand-picked values.
 */

interface Axis {
  name: string;
  min: number;
  max: number;
  ideal?: number;
}

const axes: Axis[] = VIBE_LIST.flatMap((v) => [
  { name: `${v.id} layers`, ...v.layers },
  { name: `${v.id} warmth`, ...v.warmth },
  { name: `${v.id} formality`, ...v.formality },
  ...(v.chroma ? [{ name: `${v.id} chroma`, ...v.chroma }] : []),
  ...(v.lightness ? [{ name: `${v.id} lightness`, ...v.lightness }] : []),
]);

const cases = axes.map((a) => [a.name, a] as const);

/** Dense samples from well below the band to well above it. */
function samples(a: Axis): number[] {
  const span = Math.max(a.max - a.min, 0.1);
  const lo = a.min - 2 * span;
  const hi = a.max + 2 * span;
  return Array.from({ length: 401 }, (_, i) => lo + ((hi - lo) * i) / 400);
}

const at = (a: Axis, v: number) => band(v, a.min, a.max, a.ideal);

describe('band(), for every axis every vibe declares', () => {
  it.each(cases)('%s: stays within [0, 1]', (_n, a) => {
    for (const v of samples(a)) {
      const b = at(a, v);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });

  // Zero-width bands are excluded: summer's layers are {1, 1}, "exactly one",
  // which is a step by definition -- and layers are integers, so 1.0000001 of
  // them never happens. Monotonicity below still covers those bands.
  it.each(cases.filter(([, a]) => a.max > a.min))('%s: is continuous at both bounds', (_n, a) => {
    const eps = 1e-7;
    expect(Math.abs(at(a, a.max) - at(a, a.max + eps))).toBeLessThan(1e-4);
    expect(Math.abs(at(a, a.min) - at(a, a.min - eps))).toBeLessThan(1e-4);
  });

  it.each(cases)('%s: never scores higher further from its ideal', (_n, a) => {
    const peak = a.ideal ?? (a.min + a.max) / 2;
    const xs = samples(a);
    for (let i = 1; i < xs.length; i++) {
      const [prev, cur] = [at(a, xs[i - 1]), at(a, xs[i])];
      if (xs[i - 1] >= peak)
        expect(cur, `${xs[i].toFixed(3)} past the peak`).toBeLessThanOrEqual(prev + 1e-12);
      if (xs[i] <= peak)
        expect(cur, `${xs[i].toFixed(3)} before the peak`).toBeGreaterThanOrEqual(prev - 1e-12);
    }
  });

  it.each(cases)('%s: scores 1 at its ideal, or throughout the band without one', (_n, a) => {
    if (a.ideal !== undefined) {
      expect(at(a, a.ideal)).toBeCloseTo(1, 12);
    } else {
      for (const v of [a.min, (a.min + a.max) / 2, a.max]) expect(at(a, v)).toBe(1);
    }
  });
});

describe('the specific regression', () => {
  it('scores SOFT warmth just over the ceiling below the ceiling itself', () => {
    const w = SOFT.warmth;
    expect(band(6.6, w.min, w.max, w.ideal)).toBeLessThan(band(6.5, w.min, w.max, w.ideal));
  });

  it('does not let a narrow band go inert — chroma well over SOFT reads as poor', () => {
    // A floor of 1 on the falloff scale made a 0.1-wide band nearly flat: the
    // loudest possible garment only lost 0.3.
    const c = SOFT.chroma!;
    expect(band(0.3, c.min, c.max)).toBe(0);
  });
});
