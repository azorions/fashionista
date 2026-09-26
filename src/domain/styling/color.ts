import { hueDistance, isNeutral, NEUTRAL_CHROMA, type Oklch } from '../color/oklab';
import type { Swatch } from '../color/palette';

/**
 * Do these colours go together?
 *
 * Built on OKLCh because the alternatives get this specific question wrong:
 * in HSL, #0000FF and #FFFF00 have identical lightness, so "low contrast reads
 * as soft" is meaningless; in CIELAB, blue's hue drifts toward purple as
 * chroma rises, which breaks "analogous within 30 degrees" exactly where navy
 * and indigo denim live — and denim is the most common garment colour there is.
 *
 * Every function here is pure and cheap. The pair matrix is precomputed once
 * per wardrobe because it is the most expensive term in the score.
 */

/**
 * Hue relationships, in degrees of separation.
 *
 * The awkward band is the interesting one: 60-110 degrees apart is far enough
 * to read as a deliberate clash but not far enough to read as complementary.
 * Orange and green. It is the relationship people actually get wrong.
 */
const MONOCHROME_MAX = 15;
const ANALOGOUS_MAX = 40;
const AWKWARD_MIN = 55;
const AWKWARD_MAX = 115;
const COMPLEMENTARY_MIN = 150;

export type Relationship =
  | 'neutral'
  | 'monochrome'
  | 'analogous'
  | 'awkward'
  | 'complementary'
  | 'distant';

export function relationship(a: Oklch, b: Oklch): Relationship {
  // A neutral goes with anything. That is what makes it a neutral, and it is
  // why a closet of black, white and denim always "works".
  if (isNeutral(a) || isNeutral(b)) return 'neutral';

  const d = hueDistance(a.h, b.h);
  if (d <= MONOCHROME_MAX) return 'monochrome';
  if (d <= ANALOGOUS_MAX) return 'analogous';
  if (d >= COMPLEMENTARY_MIN) return 'complementary';
  if (d >= AWKWARD_MIN && d <= AWKWARD_MAX) return 'awkward';
  return 'distant';
}

const RELATIONSHIP_SCORE: Record<Relationship, number> = {
  neutral: 0.9,
  monochrome: 0.95,
  analogous: 0.85,
  complementary: 0.75,
  distant: 0.5,
  awkward: 0.25,
};

/**
 * Pairwise harmony, 0..1.
 *
 * Hue relationship sets the ceiling; chroma and lightness adjust it. Two
 * highly saturated colours are harder to wear together than two muted ones of
 * the same hue relationship, so chroma pressure is subtracted rather than
 * being a separate term nobody can interpret.
 */
export function pairHarmony(a: Oklch, b: Oklch): number {
  const base = RELATIONSHIP_SCORE[relationship(a, b)];

  // Two saturated colours fight. One saturated against a neutral does not.
  const bothSaturated = Math.min(a.c, b.c);
  const chromaPressure = Math.max(0, bothSaturated - 0.09) * 1.2;

  // Near-identical lightness on two non-neutrals reads as muddy: the shapes
  // stop separating. Real separation OR real similarity both beat the middle.
  const dl = Math.abs(a.l - b.l);
  const muddiness = !isNeutral(a) && !isNeutral(b) && dl > 0.04 && dl < 0.12 ? 0.1 : 0;

  return clamp01(base - chromaPressure - muddiness);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The colour a garment reads as: its largest swatch. */
export function dominant(palette: Swatch[]): Oklch | null {
  return palette.length ? palette[0] : null;
}

/**
 * Harmony across a whole outfit.
 *
 * Not just the mean of the pairs. Two extra effects matter and both are about
 * counting, not pairing:
 *
 *  - Saturated-colour count. Three loud colours is chaos even if every PAIR
 *    of them is individually fine. Pairwise scoring alone cannot see this.
 *  - An all-neutral outfit is safe but flat, so it is capped slightly below a
 *    neutral-plus-one-accent outfit, which is the thing people actually admire.
 */
export function outfitHarmony(palettes: Swatch[][]): number {
  const colours = palettes.map(dominant).filter((c): c is Oklch => c !== null);
  if (colours.length < 2) return 0.8; // nothing to clash with

  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < colours.length; i++) {
    for (let j = i + 1; j < colours.length; j++) {
      sum += pairHarmony(colours[i], colours[j]);
      pairs++;
    }
  }
  let score = sum / pairs;

  const saturated = colours.filter((c) => c.c >= NEUTRAL_CHROMA).length;
  if (saturated >= 3) score -= 0.12 * (saturated - 2);

  // All neutrals: safe, never wrong, never interesting.
  if (saturated === 0) score = Math.min(score, 0.82);

  return clamp01(score);
}

/**
 * Perceptual lightness spread across an outfit, 0..1.
 *
 * This is the number "soft" is really about — a soft outfit is low contrast,
 * not just low saturation. Uses OKLCh L, which is why HSL was unusable.
 */
export function lightnessSpread(palettes: Swatch[][]): number {
  const ls = palettes.map(dominant).filter((c): c is Oklch => c !== null).map((c) => c.l);
  if (ls.length < 2) return 0;
  return Math.max(...ls) - Math.min(...ls);
}

/** Mean chroma. "Soft" and "minimal" both want this low; y2k does not care. */
export function meanChroma(palettes: Swatch[][]): number {
  const cs = palettes.map(dominant).filter((c): c is Oklch => c !== null).map((c) => c.c);
  return cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : 0;
}

/**
 * Precomputed pairwise harmony for a whole wardrobe.
 *
 * A 60-item closet is 1,770 pairs. Computing them once per wardrobe change
 * turns the most expensive scoring term into an array lookup, which is what
 * keeps suggestion latency in tens of milliseconds rather than hundreds.
 */
export class HarmonyMatrix {
  private readonly values: Float32Array;
  private readonly index = new Map<string, number>();

  constructor(items: { id: string; palette: Swatch[] }[]) {
    const n = items.length;
    items.forEach((it, i) => this.index.set(it.id, i));
    this.values = new Float32Array(n * n);

    const colours = items.map((it) => dominant(it.palette));
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        const a = colours[i];
        const b = colours[j];
        const v = a && b ? pairHarmony(a, b) : 0.7; // untagged: neither reward nor punish
        this.values[i * n + j] = v;
        this.values[j * n + i] = v;
      }
    }
  }

  get(aId: string, bId: string): number {
    const i = this.index.get(aId);
    const j = this.index.get(bId);
    if (i === undefined || j === undefined) return 0.7;
    return this.values[i * this.index.size + j];
  }
}
