import type { Swatch } from '../color/palette';
import type { GarmentTags } from '../tagging/schema';
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
 * A row as the styling engine wants it.
 *
 * styleTags comes back empty here: it lives in the item_style_tags junction
 * and nothing reads it until M2, so joining it on every closet render would be
 * cost for no benefit today.
 */
export function rowToGarment(row: WardrobeItemRow): Garment {
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
    styleTags: [],
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
}

export function rowToDefaults(r: SubcategoryRow) {
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
  };
}
