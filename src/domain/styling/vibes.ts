import type { Garment, VibeSpec } from './types';

/**
 * The four vibes, as data.
 *
 * Written to be readable by someone who does not code, because that is the
 * only way to find out whether the app's idea of "y2k" matches yours. If a
 * suggestion feels wrong, the fix is almost always a number in this file.
 *
 * "summer" and "winter" are thermal and mostly objective. "y2k" and "soft" are
 * aesthetic and are opinions — stated explicitly so they can be argued with.
 */

const has = (items: Garment[], fn: (g: Garment) => boolean) => items.some(fn);

export const SUMMER: VibeSpec = {
  id: 'summer',
  label: 'Summer',

  // The headline requirement: not layered. One thing on the torso, that's it.
  layers: { min: 1, max: 1, ideal: 1 },
  warmth: { min: 0, max: 3.5, ideal: 2 },
  formality: { min: 1, max: 4 },

  prefer: {
    materials: ['linen', 'cotton', 'silk'],
    silhouettes: ['relaxed', 'straight', 'flared'],
    lengths: ['crop', 'hip', 'thigh', 'knee'],
  },

  veto: [
    {
      tier: 'H1',
      describe: 'nothing heavy',
      // A warmth-5 garment in a summer outfit is the single most obvious way
      // to lose someone's trust in the suggestions.
      test: (g) => g.warmth >= 4,
    },
    {
      tier: 'H2',
      describe: 'nothing that traps heat',
      test: (g) => g.materials.some((m) => m === 'fleece' || m === 'down' || m === 'wool'),
    },
  ],
};

export const WINTER: VibeSpec = {
  id: 'winter',
  label: 'Winter',

  // The mirror of summer: layered, and layered means torso layers.
  layers: { min: 2, max: 4, ideal: 3 },
  warmth: { min: 6.5, max: 10, ideal: 8 },
  formality: { min: 1, max: 5 },

  prefer: {
    materials: ['wool', 'cashmere', 'knit', 'down', 'fleece', 'leather'],
    silhouettes: ['straight', 'relaxed', 'oversized'],
  },

  veto: [
    {
      tier: 'H1',
      describe: 'nothing summer-weight',
      test: (g) => g.warmth <= 1 && g.bodyZone !== 'feet',
    },
    { tier: 'H2', describe: 'covered shoes', test: (g) => g.bodyZone === 'feet' && g.warmth <= 1 },
  ],

  signature: [
    {
      describe: 'a proper outer layer over a mid layer',
      bonus: 0.08,
      test: (items) =>
        has(items, (g) => g.layerRole === 'outer' && g.warmth >= 4) &&
        has(items, (g) => g.layerRole === 'mid'),
    },
  ],
};

export const Y2K: VibeSpec = {
  id: 'y2k',
  label: 'Y2K',

  /*
   * WHICH Y2K THIS IS — worth disagreeing with.
   *
   * This is the mainstream 2020s revival reading: low rise, cropped, fitted or
   * flared, a bit of shine. It is NOT the McBling reading (velour tracksuits,
   * logo-mania, heavy gloss) and NOT mall-goth. If your mental image is one of
   * those, the fix is here: raise `sheens` to shiny-only and add a tracksuit
   * signature for McBling, or drop chroma and add black/leather for mall-goth.
   */
  layers: { min: 1, max: 2, ideal: 1 },
  warmth: { min: 1, max: 6, ideal: 3 },
  formality: { min: 1, max: 3 },

  prefer: {
    rises: ['low'],
    lengths: ['crop'],
    silhouettes: ['fitted', 'flared'],
    sheens: ['shiny', 'subtle'],
    patterns: ['graphic', 'animal', 'floral'],
  },

  veto: [
    // A high-rise trouser is the fastest way to stop reading as y2k.
    { tier: 'H2', describe: 'nothing high-waisted', test: (g) => g.rise === 'high' },
    { tier: 'H2', describe: 'nothing formal', test: (g) => g.formality >= 5 },
  ],

  signature: [
    {
      // THE marker. Scoring rise and length separately would never find it:
      // low-rise alone is just jeans, a crop top alone is just a crop top.
      describe: 'low rise with a cropped top',
      bonus: 0.18,
      test: (items) =>
        has(items, (g) => g.rise === 'low') && has(items, (g) => g.length === 'crop'),
    },
    {
      describe: 'a bit of shine',
      bonus: 0.05,
      test: (items) => has(items, (g) => g.sheen === 'shiny'),
    },
  ],

  tagWeights: { y2k: 1.0, sporty: 0.2, edgy: 0.2 },
};

export const SOFT: VibeSpec = {
  id: 'soft',
  label: 'Soft',

  /*
   * Soft is about CONTRAST more than colour. A muted palette with a hard black
   * boot in it does not read as soft; a mid-tone outfit with nothing sharp in
   * it does. Hence maxContrast doing most of the work here, and why OKLCh
   * lightness had to be perceptual for this vibe to be expressible at all.
   */
  layers: { min: 1, max: 2, ideal: 2 },
  warmth: { min: 2, max: 6.5, ideal: 4 },
  formality: { min: 1, max: 4 },

  chroma: { min: 0, max: 0.1 },
  lightness: { min: 0.45, max: 0.95 },
  maxContrast: 0.35,

  prefer: {
    materials: ['knit', 'cashmere', 'cotton', 'wool'],
    silhouettes: ['relaxed', 'oversized'],
    sheens: ['matte'],
    patterns: ['solid'],
  },

  veto: [
    { tier: 'H2', describe: 'nothing sharp or shiny', test: (g) => g.sheen === 'shiny' },
    { tier: 'H2', describe: 'nothing rigid', test: (g) => g.materials.includes('leather') },
  ],

  signature: [
    {
      describe: 'a relaxed knit',
      bonus: 0.08,
      test: (items) =>
        has(items, (g) => g.materials.includes('knit') && g.silhouette !== 'fitted'),
    },
  ],

  tagWeights: { soft: 1.0, romantic: 0.5, minimal: 0.3 },
};

export const VIBES: Record<string, VibeSpec> = {
  summer: SUMMER,
  winter: WINTER,
  y2k: Y2K,
  soft: SOFT,
};

export const VIBE_LIST = [SUMMER, WINTER, Y2K, SOFT];
