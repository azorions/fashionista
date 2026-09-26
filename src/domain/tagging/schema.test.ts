import { describe, expect, it } from 'vitest';

import taxonomySql from '../../../supabase/migrations/0001_taxonomy.sql?raw';

import {
  applyDefaults,
  BODY_ZONES,
  CATEGORIES,
  GarmentFormSchema,
  GarmentTagsSchema,
  LAYER_ROLES,
  LENGTHS,
  MATERIALS,
  PATTERN_SCALES,
  PATTERNS,
  RISES,
  SHEENS,
  SILHOUETTES,
  STYLE_TAGS,
  type SubcategoryDefaults,
} from './schema';

function sqlEnum(name: string): string[] {
  const m = taxonomySql.match(new RegExp(`create type ${name} as enum \\(([^)]*)\\)`, 'i'));
  if (!m) throw new Error(`enum ${name} not found in 0001_taxonomy.sql`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/**
 * The TypeScript arrays and the Postgres enums are two copies of one taxonomy.
 * Nothing at runtime forces them to agree, and the failure mode is nasty: the
 * app offers a value the database rejects, or the M3 AI tagger emits one. This
 * diffs them so drift fails a test instead of a user's capture.
 */
describe('taxonomy matches the SQL migration', () => {
  it.each([
    ['body_zone', BODY_ZONES],
    ['layer_role', LAYER_ROLES],
    ['garment_category', CATEGORIES],
    ['pattern', PATTERNS],
    ['pattern_scale', PATTERN_SCALES],
    ['silhouette', SILHOUETTES],
    ['garment_length', LENGTHS],
    ['rise', RISES],
    ['sheen', SHEENS],
    ['material', MATERIALS],
  ])('%s', (sqlName, tsValues) => {
    expect(sqlEnum(sqlName)).toEqual([...tsValues]);
  });

  it('style_tag seed rows match STYLE_TAGS', () => {
    const block = taxonomySql.split('insert into public.style_tag')[1] ?? '';
    const seeded = [...block.split(';')[0].matchAll(/\('([a-z0-9_]+)',/g)].map((m) => m[1]);
    expect(seeded).toEqual([...STYLE_TAGS]);
  });

  it('every subcategory seed uses a known category and layer role', () => {
    const rows = [...taxonomySql.matchAll(/^\s*\('([a-z0-9_]+)',\s*'[^']*',\s*'([a-z_]+)',\s*'([a-z_]+)',\s*'([a-z_]+)'/gm)];
    expect(rows.length).toBeGreaterThan(30); // seeds actually parsed
    for (const [, code, category, bodyZone, layerRole] of rows) {
      expect(CATEGORIES, `${code} category`).toContain(category);
      expect(BODY_ZONES, `${code} body zone`).toContain(bodyZone);
      expect(LAYER_ROLES, `${code} layer role`).toContain(layerRole);
    }
  });

  it('seeds the unknown subcategory, so a failed tag never blocks a capture', () => {
    expect(taxonomySql).toContain("('unknown',");
  });
});

describe('GarmentTagsSchema', () => {
  const full = {
    category: 'top',
    subcategory: 'tee',
    bodyZone: 'torso',
    layerRole: 'base',
    warmth: 2,
    breathability: 4,
    bulk: 2,
    formality: 2,
    silhouette: 'straight',
  };

  it('accepts a minimal valid garment and fills defaults', () => {
    const g = GarmentTagsSchema.parse(full);
    expect(g.pattern).toBe('solid');
    expect(g.rise).toBe('n_a');
    expect(g.altLayerRoles).toEqual([]);
    expect(g.styleTags).toEqual([]);
  });

  it('rejects an ordinal outside 1..5', () => {
    expect(() => GarmentTagsSchema.parse({ ...full, warmth: 0 })).toThrow();
    expect(() => GarmentTagsSchema.parse({ ...full, warmth: 6 })).toThrow();
    expect(() => GarmentTagsSchema.parse({ ...full, warmth: 2.5 })).toThrow();
  });

  it('rejects an unknown enum value rather than passing it to Postgres', () => {
    expect(() => GarmentTagsSchema.parse({ ...full, layerRole: 'sideways' })).toThrow();
    expect(() => GarmentTagsSchema.parse({ ...full, category: 'hat' })).toThrow();
  });

  it('rejects a style tag weight outside 0..1', () => {
    expect(() =>
      GarmentTagsSchema.parse({ ...full, styleTags: [{ tag: 'y2k', weight: 1.4 }] })
    ).toThrow();
  });

  it('carries multiple weighted style tags at once', () => {
    const g = GarmentTagsSchema.parse({
      ...full,
      styleTags: [
        { tag: 'y2k', weight: 0.9 },
        { tag: 'soft', weight: 0.4 },
      ],
    });
    expect(g.styleTags).toHaveLength(2);
  });
});

describe('the M1 form is three fields', () => {
  it('asks only for category, subcategory and an optional name', () => {
    expect(Object.keys(GarmentFormSchema.shape).sort()).toEqual(['category', 'name', 'subcategory']);
  });

  it('parses without any of the attribute fields present', () => {
    expect(() => GarmentFormSchema.parse({ category: 'bottom', subcategory: 'jeans' })).not.toThrow();
  });
});

describe('applyDefaults', () => {
  const defaults: SubcategoryDefaults = {
    bodyZone: 'legs',
    layerRole: 'bottom',
    altLayerRoles: [],
    warmth: 3,
    breathability: 2,
    bulk: 3,
    formality: 2,
    silhouette: 'straight',
    length: 'full',
    rise: 'mid',
  };

  it('produces a complete garment from a three-field form', () => {
    const g = applyDefaults({ category: 'bottom', subcategory: 'jeans' }, defaults);
    expect(g.warmth).toBe(3);
    expect(g.rise).toBe('mid');
    expect(g.layerRole).toBe('bottom');
  });

  it('lets the form win over a default where they overlap', () => {
    const g = applyDefaults(
      { category: 'bottom', subcategory: 'low_jeans', name: 'the flares' },
      defaults
    );
    expect(g.subcategory).toBe('low_jeans');
    expect(g.name).toBe('the flares');
  });

  it('throws on defaults that would violate the schema, rather than writing junk', () => {
    expect(() =>
      applyDefaults({ category: 'top', subcategory: 'tee' }, { ...defaults, warmth: 9 })
    ).toThrow();
  });
});
