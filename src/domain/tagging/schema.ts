import { z } from 'zod';

/**
 * The garment taxonomy, defined once.
 *
 * This file is the single source of truth for what a garment IS. The tag form
 * reads these lists to build its pickers, the styling engine scores against
 * these fields, and the M3 AI tagger's structured output (taggerSchema, at the
 * bottom) is built from these same lists. The SQL enums in 0001_taxonomy.sql
 * mirror these arrays and are kept honest by schema.test.ts, which parses the
 * migration and diffs it.
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
  'cozy',
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
 * What the capture form asks for.
 *
 * Two required fields and an optional name, as before. Everything else comes
 * from the subcategory's defaults -- unless the user opens "More details",
 * which can override pattern, materials, finish and style tags.
 *
 * Built by hand rather than picked from GarmentTagsSchema on purpose: the
 * picked detail fields carry zod DEFAULTS ('solid', []), so a form that never
 * touched them would still send them and overwrite the subcategory's values.
 * Here an untouched detail is simply absent.
 */
export const GarmentFormSchema = z.object({
  category: z.enum(CATEGORIES),
  subcategory: z.string().min(1),
  name: z.string().max(80).optional(),
  pattern: z.enum(PATTERNS).optional(),
  patternScale: z.enum(PATTERN_SCALES).optional(),
  materials: z.array(z.enum(MATERIALS)).optional(),
  sheen: z.enum(SHEENS).optional(),
  styleTags: z
    .array(z.object({ tag: z.enum(STYLE_TAGS), weight: z.number().min(0).max(1) }))
    .optional(),
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
  | 'materials'
  | 'pattern'
  | 'patternScale'
  | 'sheen'
>;

/**
 * Merge a form submission with its subcategory defaults into a full tag set.
 *
 * Keys the form left undefined are dropped before merging. Spreading them
 * would copy `undefined` over the default, and the schema would then fill in
 * ITS default -- a sweater with no details entered would lose "knit" and
 * become materials [].
 */
export function applyDefaults(form: GarmentForm, defaults: SubcategoryDefaults): GarmentTags {
  const given = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== undefined));
  return GarmentTagsSchema.parse({ ...defaults, ...given });
}

/* ------------------------------------------------------------------ *
 * The AI tagger's answer (M3).
 * ------------------------------------------------------------------ */

/** Any garment_subcategory row fits. Not SubcategoryRow: row.ts imports this file. */
type Kind = { code: string; category: Category };

/**
 * What the model is allowed to say about a garment, and nothing more.
 *
 * Exactly what a person sets on the capture form: the kind, plus the "More
 * details" overrides. Category is not asked for -- it is read off the chosen
 * subcategory, so the two cannot disagree. Warmth, formality and the other
 * ordinals are not asked for either: every save fills them from the
 * subcategory, so a guess would be overwritten the first time anyone
 * confirmed the garment.
 *
 * Built from the subcategory rows at call time, not a TS mirror of them --
 * subcategory is a table precisely so that adding one is an INSERT.
 *
 * Shaped for Claude structured outputs, which support only part of JSON
 * Schema: every field required, no .default(), no min/max or length bounds.
 * Send z.toJSONSchema(taggerSchema(rows)) as the format directly. The SDK's
 * zodOutputFormat folds `enum` into the description text, so the subcategory
 * list would no longer be enforced. schema.test.ts renders the schema and
 * fails if a bound or a default creeps back. taggerToForm's parse is the
 * real gate either way.
 */
export function taggerSchema(kinds: readonly Kind[]) {
  return z.object({
    subcategory: z
      .enum(kinds.map((k) => k.code) as [string, ...string[]])
      .describe("'unknown' when it is not clearly one of the others"),
    pattern: z.enum(PATTERNS),
    // The form's scales: a solid gets 'none' below, and 'micro' scores as 'small'.
    patternScale: z.enum(PATTERN_SCALES).exclude(['none', 'micro']),
    materials: z.array(z.enum(MATERIALS)),
    sheen: z.enum(SHEENS),
    styleTags: z.array(z.enum(STYLE_TAGS)),
  });
}

/**
 * The model's answer, as if a person had submitted the capture form, so it
 * goes through applyDefaults and saveTags like any other answer. To prefill
 * the tag screen, pass applyDefaults(taggerToForm(raw, rows), defaults) as
 * `initial` -- the form turns a missing materials list into [].
 *
 * - a solid gets scale 'none', as the form gives it;
 * - no materials means "the subcategory's", not "made of nothing" -- []
 *   would override the default and a sweater would stop being knit;
 * - duplicates collapse, because item_style_tags allows one row per tag.
 *
 * Throws if the answer does not parse; the caller keeps 'unknown', so a bad
 * answer never blocks a capture.
 */
export function taggerToForm(raw: unknown, kinds: readonly Kind[]): GarmentForm {
  const out = taggerSchema(kinds).parse(raw);
  const materials = [...new Set(out.materials)];
  return {
    category: kinds.find((k) => k.code === out.subcategory)!.category,
    subcategory: out.subcategory,
    pattern: out.pattern,
    patternScale: out.pattern === 'solid' ? 'none' : out.patternScale,
    materials: materials.length ? materials : undefined,
    sheen: out.sheen,
    // ponytail: weight 1 for every tag, as the form sends -- set_style_tags
    // stores codes only. Add a strength scale with a weighted write path.
    styleTags: [...new Set(out.styleTags)].map((tag) => ({ tag, weight: 1 })),
  };
}
