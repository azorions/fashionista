/**
 * Dominant-colour extraction from a cutout.
 *
 * THIS IS THE ONE THING THAT CANNOT BE BACKFILLED.
 *
 * It needs the alpha mask. Cluster the background pixels in and every garment's
 * "dominant colour" becomes the colour of the user's floor — and you cannot
 * recover from that later without reprocessing every stored image. So it runs
 * at capture time, over masked pixels only, from day one.
 *
 * Deliberately deterministic: seeding is farthest-point, not random, so the
 * same cutout always yields the same swatches. That makes it testable, makes
 * re-runs comparable, and means a user never sees their jacket change colour
 * because a re-process rolled different dice.
 */

import { oklabDistance, oklabToOklch, rgbToOklab, type Oklab, type Oklch } from './oklab';

export interface Swatch extends Oklch {
  /** Share of masked pixels this cluster holds, 0..1. */
  fraction: number;
}

export interface PaletteOptions {
  /** Clusters to seek before merging. */
  k?: number;
  maxIterations?: number;
  /**
   * Clusters closer than this in OKLab are the same colour plus a fold shadow.
   * See MERGE_DISTANCE for how the default was chosen.
   */
  mergeDistance?: number;
  /** Clusters holding less than this share are noise — piping, a button, a logo. */
  minFraction?: number;
  /** Alpha above which a pixel counts as garment. */
  alphaThreshold?: number;
  maxSwatches?: number;
}

/**
 * Measured, not guessed. Real lit-vs-shaded pairs of the SAME garment sit at
 * 0.061-0.103 in OKLab; genuinely different garment colours sit at 0.168-0.408.
 * There is an empty gap between those two bands, and 0.12 sits in the middle
 * of it.
 *
 *   black tee lit/shade   0.0611      red vs blue          0.3294
 *   navy lit/shade        0.0606      black vs charcoal    0.2127
 *   red lit/shade         0.0647      navy vs denim        0.2805
 *   camel lit/shade       0.0715      forest vs olive      0.1676
 *   white lit/shade       0.0816      <- highest "merge"
 *   deep fold on black    0.1026
 *
 * The one deliberate casualty is white-vs-cream (0.0609), which merges. That is
 * the right call: on a single garment they read as one off-white.
 */
export const MERGE_DISTANCE = 0.12;

const DEFAULTS: Required<PaletteOptions> = {
  k: 4,
  maxIterations: 12,
  mergeDistance: MERGE_DISTANCE,
  minFraction: 0.06,
  alphaThreshold: 127,
  maxSwatches: 5,
};

/**
 * Farthest-point seeding: first centre is the pixel nearest the mean, then each
 * subsequent centre is whichever pixel is farthest from everything chosen so
 * far. Deterministic, and it spreads the initial centres about as well as
 * k-means++ does without needing randomness.
 */
function seed(points: Oklab[], k: number): Oklab[] {
  const mean = points.reduce(
    (acc, p) => ({ l: acc.l + p.l / points.length, a: acc.a + p.a / points.length, b: acc.b + p.b / points.length }),
    { l: 0, a: 0, b: 0 }
  );

  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = oklabDistance(points[i], mean);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  const centres: Oklab[] = [points[bestIdx]];
  while (centres.length < k && centres.length < points.length) {
    let far = 0;
    let farDist = -1;
    for (let i = 0; i < points.length; i++) {
      let nearest = Infinity;
      for (const c of centres) {
        const d = oklabDistance(points[i], c);
        if (d < nearest) nearest = d;
      }
      if (nearest > farDist) {
        farDist = nearest;
        far = i;
      }
    }
    centres.push(points[far]);
  }
  return centres;
}

/**
 * Extract dominant garment colours from an RGBA cutout.
 *
 * Pass a SMALL image — 48x48 is plenty and is what the pipeline resizes to.
 * Clustering four million pixels buys nothing over clustering two thousand.
 */
export function extractPalette(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: PaletteOptions = {}
): Swatch[] {
  const opt = { ...DEFAULTS, ...options };

  // 1. Keep only garment pixels. This is the whole point.
  const points: Oklab[] = [];
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    if (rgba[p + 3] <= opt.alphaThreshold) continue;
    points.push(rgbToOklab({ r: rgba[p], g: rgba[p + 1], b: rgba[p + 2] }));
  }
  if (points.length === 0) return [];

  // 2. Lloyd's algorithm in OKLab, where euclidean distance is perceptual.
  const k = Math.min(opt.k, points.length);
  let centres = seed(points, k);
  let assignment = new Int32Array(points.length);

  for (let iter = 0; iter < opt.maxIterations; iter++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = oklabDistance(points[i], centres[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assignment[i] !== best) {
        assignment[i] = best;
        moved = true;
      }
    }

    const sums = centres.map(() => ({ l: 0, a: 0, b: 0, n: 0 }));
    for (let i = 0; i < points.length; i++) {
      const s = sums[assignment[i]];
      s.l += points[i].l;
      s.a += points[i].a;
      s.b += points[i].b;
      s.n++;
    }
    centres = centres.map((c, i) =>
      sums[i].n === 0 ? c : { l: sums[i].l / sums[i].n, a: sums[i].a / sums[i].n, b: sums[i].b / sums[i].n }
    );

    if (!moved) break;
  }

  // 3. Collect clusters with their weights.
  const counts = new Array(centres.length).fill(0);
  for (let i = 0; i < points.length; i++) counts[assignment[i]]++;

  let clusters = centres
    .map((centre, i) => ({ centre, count: counts[i] }))
    .filter((c) => c.count > 0);

  // 4. Merge near-identical clusters. A garment lit from one side produces a
  //    "colour" and a "slightly darker colour"; those are one swatch.
  clusters.sort((a, b) => b.count - a.count);
  const merged: { centre: Oklab; count: number }[] = [];
  for (const cluster of clusters) {
    const near = merged.find((m) => oklabDistance(m.centre, cluster.centre) < opt.mergeDistance);
    if (near) {
      const total = near.count + cluster.count;
      near.centre = {
        l: (near.centre.l * near.count + cluster.centre.l * cluster.count) / total,
        a: (near.centre.a * near.count + cluster.centre.a * cluster.count) / total,
        b: (near.centre.b * near.count + cluster.centre.b * cluster.count) / total,
      };
      near.count = total;
    } else {
      merged.push({ ...cluster });
    }
  }

  // 5. Drop noise, sort by dominance, cap the count.
  const swatches = merged
    .map((m) => ({ ...oklabToOklch(m.centre), fraction: m.count / points.length }))
    .filter((s) => s.fraction >= opt.minFraction)
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, opt.maxSwatches);

  // A garment whose every cluster was below minFraction is still SOME colour —
  // returning nothing would be worse than returning its single biggest cluster.
  if (swatches.length === 0 && merged.length > 0) {
    const biggest = merged.reduce((a, b) => (b.count > a.count ? b : a));
    return [{ ...oklabToOklch(biggest.centre), fraction: biggest.count / points.length }];
  }

  return swatches;
}

/** The swatch a human would name as "the colour of this garment". */
export function dominantSwatch(palette: Swatch[]): Swatch | undefined {
  return palette[0];
}
