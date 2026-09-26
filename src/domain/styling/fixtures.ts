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
