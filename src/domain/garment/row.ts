import type { Swatch } from '../color/palette';
import { STYLE_TAGS, type GarmentTags, type StyleTag, type SubcategoryDefaults } from '../tagging/schema';
import type { Garment } from '../styling/types';

/**
 * The snake_case / camelCase seam.
 *
 * Postgres is snake_case and TypeScript is camelCase, and supabase-js does not
 * convert between them. Rather than make the styling engine read
 * `alt_layer_roles` forever, the conversion happens once, here.
 *
 * NOTE: WardrobeItemRow is hand-written because `npm run db:types` needs a
 * linked Supabase project, which does not exist yet. Once you link one and run
 * it, replace this interface with the generated
 * `Database['public']['Tables']['wardrobe_items']['Row']` — the field names
 * already match exactly, so it should be a one-line import swap.
 */
export interface WardrobeItemRow {
  id: string;
  user_id: string;
  name: string | null;
  category: GarmentTags['category'];
  subcategory: string;
  body_zone: GarmentTags['bodyZone'];
  layer_role: GarmentTags['layerRole'];
  alt_layer_roles: GarmentTags['layerRole'][];
  warmth: number;
  breathability: number;
  bulk: number;
  formality: number;
  silhouette: GarmentTags['silhouette'];
  length: GarmentTags['length'];
  rise: GarmentTags['rise'];
  pattern: GarmentTags['pattern'];
  pattern_scale: GarmentTags['patternScale'];
  materials: GarmentTags['materials'];
  sheen: GarmentTags['sheen'];
  palette: Swatch[];
  confidence: Record<string, number>;
  cover_image_id: string | null;
  last_worn_at: string | null;
  times_worn: number;
  archived: boolean;
}

/** Tag fields only. Used for both the initial insert and the tag-screen update. */
export function tagsToRow(t: GarmentTags) {
  return {
    name: t.name ?? null,
    category: t.category,
    subcategory: t.subcategory,
    body_zone: t.bodyZone,
    layer_role: t.layerRole,
    alt_layer_roles: t.altLayerRoles,
    warmth: t.warmth,
    breathability: t.breathability,
    bulk: t.bulk,
    formality: t.formality,
    silhouette: t.silhouette,
    length: t.length,
    rise: t.rise,
    pattern: t.pattern,
    pattern_scale: t.patternScale,
    materials: t.materials,
    sheen: t.sheen,
  };
}

/**
 * A wardrobe row with its style tags embedded by PostgREST
 * (`tags:item_style_tags(tag_code, weight)`). Kept separate from
 * WardrobeItemRow, which mirrors the table itself and is checked against the
 * migration column by column.
 */
export type WardrobeItemWithTags = WardrobeItemRow & {
  tags?: { tag_code: string; weight: number | string }[] | null;
};

const KNOWN_TAGS = new Set<string>(STYLE_TAGS);

/**
 * A row as the styling engine wants it.
 *
 * Style tags come from the embedded junction rows. This used to hardcode [],
 * so every vibe's tag weights scored zero for every real garment. Unknown tag
 * codes are dropped rather than trusted, and numeric(3,2) weights -- which
 * PostgREST may send as strings -- are coerced.
 */
export function rowToGarment(row: WardrobeItemWithTags): Garment {
  return {
    id: row.id,
    name: row.name ?? undefined,
    category: row.category,
    subcategory: row.subcategory,
    bodyZone: row.body_zone,
    layerRole: row.layer_role,
    altLayerRoles: row.alt_layer_roles ?? [],
    warmth: row.warmth,
    breathability: row.breathability,
    bulk: row.bulk,
    formality: row.formality,
    silhouette: row.silhouette,
    length: row.length,
    rise: row.rise,
    pattern: row.pattern,
    patternScale: row.pattern_scale,
    materials: row.materials ?? [],
    sheen: row.sheen,
    styleTags: (row.tags ?? [])
      .filter((t) => KNOWN_TAGS.has(t.tag_code))
      .map((t) => ({ tag: t.tag_code as StyleTag, weight: Number(t.weight) })),
    palette: row.palette ?? [],
    confidence: row.confidence as Garment['confidence'],
    lastWornAt: row.last_worn_at,
    timesWorn: row.times_worn,
    archived: row.archived,
  };
}

/** Subcategory defaults, as stored. Mirrors SubcategoryDefaults in the schema. */
export interface SubcategoryRow {
  code: string;
  label: string;
  category: GarmentTags['category'];
  default_body_zone: GarmentTags['bodyZone'];
  default_layer_role: GarmentTags['layerRole'];
  alt_layer_roles: GarmentTags['layerRole'][];
  default_warmth: number;
  default_breathability: number;
  default_bulk: number;
  default_formality: number;
  default_silhouette: GarmentTags['silhouette'];
  default_length: GarmentTags['length'];
  default_rise: GarmentTags['rise'];
  sort: number;
  default_materials: GarmentTags['materials'];
  default_pattern: GarmentTags['pattern'];
  default_pattern_scale: GarmentTags['patternScale'];
  default_sheen: GarmentTags['sheen'];
}

export function rowToDefaults(r: SubcategoryRow): SubcategoryDefaults {
  return {
    bodyZone: r.default_body_zone,
    layerRole: r.default_layer_role,
    altLayerRoles: r.alt_layer_roles ?? [],
    warmth: r.default_warmth,
    breathability: r.default_breathability,
    bulk: r.default_bulk,
    formality: r.default_formality,
    silhouette: r.default_silhouette,
    length: r.default_length,
    rise: r.default_rise,
    materials: r.default_materials ?? [],
    pattern: r.default_pattern ?? 'solid',
    patternScale: r.default_pattern_scale ?? 'none',
    sheen: r.default_sheen ?? 'matte',
  };
}
