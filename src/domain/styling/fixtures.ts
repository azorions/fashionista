import { rgbToOklch } from '../color/oklab';
import type { Swatch } from '../color/palette';
import type { Garment } from './types';

/**
 * Hand-built wardrobes for testing the engine.
 *
 * Tuning a scoring function against your own closet is how you overfit to one
 * person's clothes. These fixtures are the regression net: they pin down the
 * behaviours that must hold for ANY wardrobe, so a weight change that fixes
 * one suggestion and breaks summer shows up immediately.
 */

export function swatch(hex: string, fraction = 1): Swatch {
  const n = parseInt(hex.replace('#', ''), 16);
  const lch = rgbToOklch({ r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 });
  return { ...lch, fraction };
}

let seq = 0;

/** A garment with sensible defaults; override only what the test cares about. */
export function garment(over: Partial<Garment> & { id?: string }): Garment {
  const id = over.id ?? `g${++seq}`;
  return {
    id,
    category: 'top',
    subcategory: 'tee',
    bodyZone: 'torso',
    layerRole: 'base',
    altLayerRoles: [],
    warmth: 2,
    breathability: 4,
    bulk: 2,
    formality: 2,
    silhouette: 'straight',
    length: 'hip',
    rise: 'n_a',
    pattern: 'solid',
    patternScale: 'none',
    materials: ['cotton'],
    sheen: 'matte',
    styleTags: [],
    palette: [swatch('#8a8f98')],
    ...over,
  };
}

export const resetIds = () => {
  seq = 0;
};

/**
 * A realistic mixed wardrobe: enough range to build both a summer and a
 * winter outfit, with a genuine y2k pair and a genuine soft pair in it.
 */
export function mixedWardrobe(): Garment[] {
  return [
    // --- summer-capable tops
    garment({
      id: 'linen-tank',
      subcategory: 'tank',
      warmth: 1,
      breathability: 5,
      bulk: 1,
      materials: ['linen'],
      silhouette: 'relaxed',
      palette: [swatch('#efe7d8')],
    }),
    garment({
      id: 'white-tee',
      subcategory: 'tee',
      warmth: 2,
      breathability: 4,
      palette: [swatch('#f2f2f0')],
    }),
    // --- y2k marker: a cropped, shiny top
    garment({
      id: 'crop-top',
      subcategory: 'crop_top',
      warmth: 1,
      breathability: 4,
      bulk: 1,
      length: 'crop',
      silhouette: 'fitted',
      sheen: 'shiny',
      materials: ['synthetic'],
      styleTags: [{ tag: 'y2k', weight: 0.9 }],
      palette: [swatch('#b8d8e8')],
    }),
    // --- mid layers
    garment({
      id: 'flannel',
      subcategory: 'flannel',
      layerRole: 'base',
      altLayerRoles: ['mid', 'outer'],
      warmth: 3,
      breathability: 3,
      bulk: 3,
      pattern: 'check',
      patternScale: 'medium',
      silhouette: 'relaxed',
      palette: [swatch('#7a4b46')],
    }),
    garment({
      id: 'wool-sweater',
      subcategory: 'sweater',
      category: 'top',
      layerRole: 'mid',
      altLayerRoles: ['base'],
      warmth: 4,
      breathability: 2,
      bulk: 4,
      materials: ['wool', 'knit'],
      silhouette: 'relaxed',
      styleTags: [{ tag: 'soft', weight: 0.8 }],
      palette: [swatch('#c9bfae')],
    }),
    // --- outer
    garment({
      id: 'wool-coat',
      subcategory: 'wool_coat',
      category: 'outerwear',
      layerRole: 'outer',
      warmth: 5,
      breathability: 1,
      bulk: 4,
      formality: 4,
      materials: ['wool'],
      length: 'knee',
      palette: [swatch('#3b3a38')],
    }),
    garment({
      id: 'denim-jacket',
      subcategory: 'denim_jacket',
      category: 'outerwear',
      layerRole: 'outer',
      warmth: 3,
      breathability: 2,
      bulk: 3,
      materials: ['denim'],
      palette: [swatch('#4a6274')],
    }),
    // --- bottoms
    garment({
      id: 'low-jeans',
      subcategory: 'low_jeans',
      category: 'bottom',
      bodyZone: 'legs',
      layerRole: 'bottom',
      warmth: 3,
      breathability: 2,
      bulk: 3,
      rise: 'low',
      length: 'full',
      silhouette: 'flared',
      materials: ['denim'],
      styleTags: [{ tag: 'y2k', weight: 0.8 }],
      palette: [swatch('#5a7794')],
    }),
    garment({
      id: 'linen-shorts',
      subcategory: 'shorts',
      category: 'bottom',
      bodyZone: 'legs',
      layerRole: 'bottom',
      warmth: 1,
      breathability: 5,
      bulk: 1,
      length: 'thigh',
      materials: ['linen'],
      palette: [swatch('#e3ddd0')],
    }),
    garment({
      id: 'wool-trousers',
      subcategory: 'trousers',
      category: 'bottom',
      bodyZone: 'legs',
      layerRole: 'bottom',
      warmth: 4,
      breathability: 2,
      bulk: 2,
      formality: 4,
      rise: 'high',
      materials: ['wool'],
      palette: [swatch('#454344')],
    }),
    // --- shoes
    garment({
      id: 'sandals',
      subcategory: 'sandals',
      category: 'footwear',
      bodyZone: 'feet',
      layerRole: 'footwear',
      warmth: 1,
      breathability: 5,
      bulk: 1,
      palette: [swatch('#a08a70')],
    }),
    garment({
      id: 'sneakers',
      subcategory: 'sneakers',
      category: 'footwear',
      bodyZone: 'feet',
      layerRole: 'footwear',
      warmth: 2,
      breathability: 3,
      palette: [swatch('#efefef')],
    }),
    garment({
      id: 'boots',
      subcategory: 'boots',
      category: 'footwear',
      bodyZone: 'feet',
      layerRole: 'footwear',
      warmth: 4,
      breathability: 1,
      bulk: 3,
      formality: 3,
      materials: ['leather'],
      palette: [swatch('#2e2a27')],
    }),
    // --- one-piece
    garment({
      id: 'summer-dress',
      subcategory: 'dress',
      category: 'dress',
      bodyZone: 'full_body',
      layerRole: 'full_body',
      warmth: 2,
      breathability: 4,
      bulk: 1,
      formality: 3,
      length: 'knee',
      materials: ['cotton'],
      palette: [swatch('#d8c7d2')],
    }),
  ];
}

/** Four items. Too small to satisfy anything fully — tests the relaxation ladder. */
export function tinyWardrobe(): Garment[] {
  return [
    garment({ id: 'tee', subcategory: 'tee', warmth: 2 }),
    garment({
      id: 'jeans',
      subcategory: 'jeans',
      category: 'bottom',
      bodyZone: 'legs',
      layerRole: 'bottom',
      warmth: 3,
      materials: ['denim'],
      palette: [swatch('#5a7794')],
    }),
    garment({
      id: 'sneakers',
      subcategory: 'sneakers',
      category: 'footwear',
      bodyZone: 'feet',
      layerRole: 'footwear',
      warmth: 2,
      palette: [swatch('#efefef')],
    }),
    garment({
      id: 'puffer',
      subcategory: 'puffer',
      category: 'outerwear',
      layerRole: 'outer',
      warmth: 5,
      breathability: 1,
      bulk: 5,
      materials: ['down'],
      palette: [swatch('#22252b')],
    }),
  ];
}

/**
 * mixedWardrobe plus the pieces the four aesthetic vibes are built from: a
 * graphic tee, hoodie, bomber and joggers for streetwear; an oxford, chinos
 * and loafers for smart casual; a chunky cardigan for cozy. Also feeds the
 * dev preview of the Style screen.
 */
export function styleWardrobe(): Garment[] {
  const top = { category: 'top', bodyZone: 'torso' } as const;
  const bottom = {
    category: 'bottom',
    bodyZone: 'legs',
    layerRole: 'bottom',
    length: 'full',
  } as const;
  const shoe = {
    category: 'footwear',
    bodyZone: 'feet',
    layerRole: 'footwear',
    length: 'n_a',
  } as const;
  return [
    ...mixedWardrobe(),
    garment({
      ...top,
      id: 'graphic-tee',
      subcategory: 'tee',
      layerRole: 'base',
      silhouette: 'oversized',
      pattern: 'graphic',
      patternScale: 'large',
      styleTags: [{ tag: 'streetwear', weight: 0.8 }],
      palette: [swatch('#1f1f22', 0.7), swatch('#d94f30', 0.3)],
    }),
    garment({
      ...top,
      id: 'grey-hoodie',
      subcategory: 'hoodie',
      layerRole: 'mid',
      altLayerRoles: ['outer'],
      warmth: 4,
      breathability: 2,
      bulk: 4,
      formality: 1,
      silhouette: 'oversized',
      materials: ['cotton', 'fleece'],
      styleTags: [
        { tag: 'streetwear', weight: 0.6 },
        { tag: 'cozy', weight: 0.5 },
      ],
      palette: [swatch('#9a9ca0')],
    }),
    garment({
      id: 'bomber',
      subcategory: 'bomber',
      category: 'outerwear',
      bodyZone: 'torso',
      layerRole: 'outer',
      warmth: 3,
      breathability: 2,
      bulk: 3,
      silhouette: 'relaxed',
      materials: ['synthetic'],
      sheen: 'subtle',
      palette: [swatch('#3f4a3c')],
    }),
    garment({
      ...top,
      id: 'oxford',
      subcategory: 'shirt',
      layerRole: 'base',
      altLayerRoles: ['mid'],
      formality: 3,
      palette: [swatch('#c9d6e6')],
      styleTags: [{ tag: 'smart_casual', weight: 0.7 }],
    }),
    garment({
      ...top,
      id: 'chunky-cardigan',
      subcategory: 'cardigan',
      layerRole: 'mid',
      altLayerRoles: ['outer'],
      warmth: 4,
      breathability: 2,
      bulk: 4,
      formality: 2,
      silhouette: 'oversized',
      materials: ['knit', 'wool'],
      styleTags: [{ tag: 'cozy', weight: 0.9 }],
      palette: [swatch('#d8cbb6')],
    }),
    garment({
      ...bottom,
      id: 'joggers',
      subcategory: 'joggers',
      warmth: 3,
      breathability: 2,
      bulk: 3,
      formality: 1,
      silhouette: 'relaxed',
      materials: ['cotton', 'fleece'],
      palette: [swatch('#2b2c30')],
    }),
    garment({
      ...bottom,
      id: 'chinos',
      subcategory: 'chinos',
      warmth: 2,
      breathability: 3,
      formality: 3,
      rise: 'mid',
      palette: [swatch('#b9a787')],
    }),
    garment({
      ...shoe,
      id: 'loafers',
      subcategory: 'loafers',
      warmth: 2,
      breathability: 3,
      formality: 4,
      materials: ['leather'],
      sheen: 'subtle',
      palette: [swatch('#4a2e22')],
    }),
  ];
}
