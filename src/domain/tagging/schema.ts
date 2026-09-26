import { z } from 'zod';

/**
 * The garment taxonomy, defined once.
 *
 * This file is the single source of truth for what a garment IS. The tag form
 * reads these lists to build its pickers, the styling engine scores against
 * these fields, and (in M3) the AI tagger's structured output validates against
 * this same schema. The SQL enums in 0001_taxonomy.sql mirror these arrays and
 * are kept honest by schema.test.ts, which parses the migration and diffs it.
 *
 * Scope note: every field here is one the M2 vibe engine actually reads.
 * Deliberately absent — water_resistant, wind_block and season, because the
 * only thing that would consume them is weather, which is M4. warmth plus
 * breathability already separate "summer" from "winter".
 */

/* ------------------------------------------------------------------ *
 * Closed axes. These become Postgres enums.
 * ------------------------------------------------------------------ */

/** Where on the body it sits. Combined with layerRole, gives outfit slot exclusivity. */
export const BODY_ZONES = [
  'torso',
  'legs',
  'full_body',
  'feet',
  'head',
  'neck',
  'hands',
  'waist',
  'carried',
] as const;

/**
 * How far from the skin. NOT derivable from subcategory — a flannel is a base
 * layer worn alone and a mid layer worn over a tee, which is exactly the case
 * that makes "winter = layered" produce tee-under-flannel-under-coat instead of
 * parka-over-parka. Hence altLayerRoles alongside it.
 */
export const LAYER_ROLES = [
  'base',
  'mid',
  'outer',
  'bottom',
  'overbottom',
  'full_body',
  'footwear',
  'accessory',
] as const;

/** Coarse bucket for filtering and grid grouping. Detail lives in subcategory. */
export const CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'footwear', 'accessory'] as const;

export const PATTERNS = [
  'solid',
  'stripe',
  'check',
  'floral',
  'graphic',
  'animal',
  'geometric',
  'other',
] as const;

/** Two large patterns clash; large plus micro does not. Hence scale, not just presence. */
export const PATTERN_SCALES = ['none', 'micro', 'small', 'medium', 'large'] as const;

export const SILHOUETTES = ['fitted', 'straight', 'relaxed', 'oversized', 'flared'] as const;

export const LENGTHS = ['n_a', 'crop', 'hip', 'thigh', 'knee', 'midi', 'ankle', 'full'] as const;

/** The single strongest y2k signal, and the one nobody puts in a v1 schema. */
export const RISES = ['n_a', 'low', 'mid', 'high'] as const;

export const SHEENS = ['matte', 'subtle', 'shiny'] as const;

export const MATERIALS = [
  'cotton',
  'linen',
  'wool',
  'cashmere',
  'denim',
  'leather',
  'silk',
  'synthetic',
  'knit',
  'fleece',
  'down',
  'other',
] as const;

/**
 * Open vocabulary — a seeded table, not an enum, so adding one is an INSERT.
 * A garment carries these with weights: 0.9 y2k AND 0.4 soft simultaneously.
 */
export const STYLE_TAGS = [
  'y2k',
  'soft',
  'minimal',
  'streetwear',
  'smart_casual',
  'sporty',
  'romantic',
  'edgy',
  'preppy',
  'vintage',
] as const;

export type BodyZone = (typeof BODY_ZONES)[number];
export type LayerRole = (typeof LAYER_ROLES)[number];
export type Category = (typeof CATEGORIES)[number];
export type Pattern = (typeof PATTERNS)[number];
export type PatternScale = (typeof PATTERN_SCALES)[number];
export type Silhouette = (typeof SILHOUETTES)[number];
export type Length = (typeof LENGTHS)[number];
export type Rise = (typeof RISES)[number];
export type Sheen = (typeof SHEENS)[number];
export type Material = (typeof MATERIALS)[number];
export type StyleTag = (typeof STYLE_TAGS)[number];

/* ------------------------------------------------------------------ *
 * Ordinal axes. All 1..5, deliberately the same scale.
 * ------------------------------------------------------------------ */

/**
 * One mental model for every ordinal. A 0..1 float for bulk would be false
 * precision on a value a human eyeballs from a photo.
 */
const ordinal = (what: string) => z.number().int().min(1).max(5).describe(what);

export const WARMTH_LABELS = {
  1: 'mesh, tank, linen',
  2: 'tee, poplin',
  3: 'long sleeve, light knit, denim',
  4: 'heavy knit, fleece, lined jacket',
  5: 'parka, wool coat, down',
} as const;

/* ------------------------------------------------------------------ *
 * The schema.
 * ------------------------------------------------------------------ */

export const GarmentTagsSchema = z.object({
  category: z.enum(CATEGORIES),
  /** FK into garment_subcategory, which supplies every default below. */
  subcategory: z.string().min(1),

  bodyZone: z.enum(BODY_ZONES),
  layerRole: z.enum(LAYER_ROLES),
  /** Other roles this garment can legitimately play. See LAYER_ROLES. */
  altLayerRoles: z.array(z.enum(LAYER_ROLES)).default([]),

  warmth: ordinal('1 mesh/linen .. 5 parka/down'),
  breathability: ordinal('1 sealed .. 5 open weave. Separates summer from winter with warmth.'),
  bulk: ordinal('1 sheer .. 5 chunky. Stops a chunky knit going under a slim jacket.'),
  formality: ordinal('1 loungewear .. 5 black tie'),

  silhouette: z.enum(SILHOUETTES),
  length: z.enum(LENGTHS).default('n_a'),
  rise: z.enum(RISES).default('n_a'),

  pattern: z.enum(PATTERNS).default('solid'),
  patternScale: z.enum(PATTERN_SCALES).default('none'),
  materials: z.array(z.enum(MATERIALS)).default([]),
  sheen: z.enum(SHEENS).default('matte'),

  /** Weighted, because a faint reference and a statement piece are not the same. */
  styleTags: z.array(z.object({ tag: z.enum(STYLE_TAGS), weight: z.number().min(0).max(1) })).default([]),

  name: z.string().max(80).optional(),
});

export type GarmentTags = z.infer<typeof GarmentTagsSchema>;

/**
 * What the M1 tag form actually asks for.
 *
 * Three fields. Everything else in GarmentTags comes from the subcategory's
 * defaults, and the colour comes free from the cutout's palette. Asking for
 * fifteen fields per garment is how a closet stays empty.
 */
export const GarmentFormSchema = GarmentTagsSchema.pick({
  category: true,
  subcategory: true,
  name: true,
});

export type GarmentForm = z.infer<typeof GarmentFormSchema>;

/** Fields a subcategory row supplies so the form does not have to ask. */
export type SubcategoryDefaults = Pick<
  GarmentTags,
  | 'bodyZone'
  | 'layerRole'
  | 'altLayerRoles'
  | 'warmth'
  | 'breathability'
  | 'bulk'
  | 'formality'
  | 'silhouette'
  | 'length'
  | 'rise'
>;

/** Merge a form submission with its subcategory defaults into a full tag set. */
export function applyDefaults(form: GarmentForm, defaults: SubcategoryDefaults): GarmentTags {
  return GarmentTagsSchema.parse({ ...defaults, ...form });
}
