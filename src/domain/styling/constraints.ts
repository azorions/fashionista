import type { Garment } from './types';

/**
 * What makes a set of garments an OUTFIT rather than a pile.
 *
 * Tiered, because scarcity is real. A twelve-item closet cannot satisfy every
 * preference, and the honest response is fewer outfits with a note about what
 * was bent — not five results padded out by silently dropping the rules.
 * Someone who sees a puffer jacket under "summer" never opens the tab again.
 *
 *   H0  structural. Never relaxed. Violating these produces nonsense.
 *   H1  vibe-critical. Relaxed only after H2, and always reported.
 *   H2  vibe-preferred. First to go.
 */

export type Tier = 'H0' | 'H1' | 'H2';

export interface Violation {
  tier: Tier;
  describe: string;
}

/**
 * Torso layers, which is what "layered" actually means.
 *
 * A full-body garment counts as a torso layer. Miss that and a jacket over a
 * dress reads as a single layer, which lets a summer suggestion quietly
 * include outerwear -- the exact thing "summer = not layered" forbids.
 */
export function torsoLayers(items: Garment[]): number {
  return items.filter(
    (i) =>
      i.bodyZone === 'full_body' ||
      (i.bodyZone === 'torso' && ['base', 'mid', 'outer'].includes(i.layerRole))
  ).length;
}

/**
 * Outfit warmth with diminishing returns.
 *
 * Three warmth-3 mid layers is not warmth 9 — the second layer adds much less
 * than the first, and the third less again. Summing raw values would make any
 * layered outfit read as arctic and break the summer/winter split entirely.
 */
export function outfitWarmth(items: Garment[]): number {
  const torso = items
    .filter((i) => i.bodyZone === 'torso' || i.bodyZone === 'full_body')
    .map((i) => i.warmth)
    .sort((a, b) => b - a);

  const bottom = Math.max(0, ...items.filter((i) => i.bodyZone === 'legs').map((i) => i.warmth));
  const feet = Math.max(0, ...items.filter((i) => i.bodyZone === 'feet').map((i) => i.warmth));

  const layered =
    (torso[0] ?? 0) + 0.6 * (torso[1] ?? 0) + 0.35 * (torso[2] ?? 0);

  return Math.min(10, layered + 0.5 * bottom + 0.2 * feet);
}

/** Mean formality, weighted: shoes shout louder than a t-shirt. */
export function outfitFormality(items: Garment[]): number {
  let sum = 0;
  let weight = 0;
  for (const i of items) {
    const w = i.bodyZone === 'feet' ? 2 : 1;
    sum += i.formality * w;
    weight += w;
  }
  return weight ? sum / weight : 3;
}

const EXCLUSIVE_ZONES = ['legs', 'feet', 'head', 'waist'] as const;

/**
 * H0. Structural sanity, checked before anything is scored.
 *
 * These are not preferences. An outfit with two pairs of trousers is not a
 * bold styling choice, it is a bug.
 */
export function structuralViolations(items: Garment[]): Violation[] {
  const v: Violation[] = [];

  const hasFullBody = items.some((i) => i.bodyZone === 'full_body');
  const hasTorso = items.some((i) => i.bodyZone === 'torso');
  const hasLegs = items.some((i) => i.bodyZone === 'legs');

  // A dress IS the top and the bottom.
  if (hasFullBody && (hasTorso || hasLegs)) {
    const layerable = items
      .filter((i) => i.bodyZone === 'torso')
      .every((i) => i.layerRole === 'outer' || i.layerRole === 'mid');
    if (hasLegs || !layerable) {
      v.push({ tier: 'H0', describe: 'a dress already covers top and bottom' });
    }
  }

  // Cover the body.
  if (!hasFullBody && (!hasTorso || !hasLegs)) {
    v.push({ tier: 'H0', describe: 'needs a top and a bottom' });
  }

  // One per exclusive zone.
  for (const zone of EXCLUSIVE_ZONES) {
    if (items.filter((i) => i.bodyZone === zone && i.layerRole !== 'accessory').length > 1) {
      v.push({ tier: 'H0', describe: `only one ${zone} garment` });
    }
  }

  // One outer layer. A coat over a coat is not layering.
  if (items.filter((i) => i.layerRole === 'outer').length > 1) {
    v.push({ tier: 'H0', describe: 'only one outer layer' });
  }

  // Bare feet are a choice, but not one the app should make for you.
  if (!items.some((i) => i.bodyZone === 'feet')) {
    v.push({ tier: 'H0', describe: 'needs shoes' });
  }

  // Layering order has to be physically possible: a bulky knit does not go
  // under a fitted jacket. This is what `bulk` exists for -- it is NOT
  // derivable from warmth, which is why it is its own column.
  const outer = items.find((i) => i.layerRole === 'outer');
  const mid = items.find((i) => i.layerRole === 'mid');
  if (outer && mid && outer.silhouette === 'fitted' && mid.bulk >= 4) {
    v.push({ tier: 'H0', describe: 'that knit will not fit under a fitted jacket' });
  }

  return v;
}

/** Wearing three big patterns at once. Scale is what decides, not count. */
export function patternClash(items: Garment[]): boolean {
  const loud = items.filter(
    (i) => i.pattern !== 'solid' && (i.patternScale === 'large' || i.patternScale === 'medium')
  );
  return loud.length >= 2;
}

export function isValid(items: Garment[]): boolean {
  return structuralViolations(items).length === 0;
}
