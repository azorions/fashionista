import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import taxonomySql from '../../../supabase/migrations/0001_taxonomy.sql?raw';

import {
  applyDefaults,
  BODY_ZONES,
  CATEGORIES,
  type Category,
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
  taggerSchema,
  taggerToForm,
} from './schema';

/** (code, category, body zone, layer role) of every garment_subcategory seed row. */
const SEED = [
  ...taxonomySql.matchAll(/^\s*\('([a-z0-9_]+)',\s*'[^']*',\s*'([a-z_]+)',\s*'([a-z_]+)',\s*'([a-z_]+)'/gm),
];

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
    expect(SEED.length).toBeGreaterThan(30); // seeds actually parsed
    for (const [, code, category, bodyZone, layerRole] of SEED) {
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

describe('the capture form requires two fields', () => {
  it('requires only category and subcategory; everything else is optional', () => {
    const shape = GarmentFormSchema.shape;
    const required = Object.entries(shape)
      .filter(([, field]) => !field.safeParse(undefined).success)
      .map(([k]) => k)
      .sort();
    expect(required).toEqual(['category', 'subcategory']);
  });

  it('gives the optional details NO defaults, so an untouched field is absent', () => {
    // A default here would be sent on every save and overwrite the
    // subcategory's value -- the whole point of the details being optional.
    const parsed = GarmentFormSchema.parse({ category: 'top', subcategory: 'sweater' });
    for (const k of ['pattern', 'patternScale', 'materials', 'sheen', 'styleTags'] as const) {
      expect(parsed[k], k).toBeUndefined();
    }
  });

  it('parses without any of the attribute fields present', () => {
    expect(() => GarmentFormSchema.parse({ category: 'bottom', subcategory: 'jeans' })).not.toThrow();
  });
});

/** Jeans, as the seed has them. */
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
  materials: ['denim'],
  pattern: 'solid',
  patternScale: 'none',
  sheen: 'matte',
};

describe('applyDefaults', () => {
  it('keeps the subcategory defaults when no details were entered', () => {
    // The bug this guards: spreading {materials: undefined} over the defaults,
    // then letting the schema default it to [] -- jeans would stop being denim.
    const g = applyDefaults(
      { category: 'bottom', subcategory: 'jeans', materials: undefined, pattern: undefined },
      defaults
    );
    expect(g.materials).toEqual(['denim']);
    expect(g.pattern).toBe('solid');
  });

  it('lets entered details override the defaults', () => {
    const g = applyDefaults(
      {
        category: 'bottom',
        subcategory: 'jeans',
        pattern: 'stripe',
        patternScale: 'small',
        sheen: 'shiny',
        styleTags: [{ tag: 'y2k', weight: 1 }],
      },
      defaults
    );
    expect(g.pattern).toBe('stripe');
    expect(g.sheen).toBe('shiny');
    expect(g.materials).toEqual(['denim']);
    expect(g.styleTags).toEqual([{ tag: 'y2k', weight: 1 }]);
  });

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

/** Every node of a rendered JSON Schema, depth first. */
const nodes = (s: unknown): Record<string, unknown>[] =>
  s && typeof s === 'object'
    ? [...(Array.isArray(s) ? [] : [s as Record<string, unknown>]), ...Object.values(s).flatMap(nodes)]
    : [];

/**
 * The tagger's schema becomes Claude's structured-output format, which
 * supports only part of JSON Schema. A bound or a default outside that part
 * is refused or silently stripped, and a garment fails to tag over it. The
 * answer itself has to land exactly as the capture form would have sent it.
 */
describe('the AI tagger', () => {
  const kinds = SEED.map(([, code, category]) => ({ code, category: category as Category }));
  const schema = taggerSchema(kinds);
  const answer = {
    subcategory: 'sweater',
    pattern: 'stripe',
    patternScale: 'large',
    materials: ['wool'],
    sheen: 'matte',
    styleTags: ['cozy'],
  };

  it('accepts every seeded subcategory, unknown included, and nothing invented', () => {
    expect(kinds.map((k) => k.code)).toContain('unknown');
    for (const { code } of kinds) {
      expect(schema.safeParse({ ...answer, subcategory: code }).success, code).toBe(true);
    }
    expect(schema.safeParse({ ...answer, subcategory: 'shrug' }).success).toBe(false);
    expect(() => taggerToForm({ ...answer, styleTags: ['goth'] }, kinds)).toThrow();
  });

  it('renders only JSON Schema that structured outputs support', () => {
    const banned = [
      'minimum',
      'maximum',
      'exclusiveMinimum',
      'exclusiveMaximum',
      'multipleOf',
      'minLength',
      'maxLength',
      'minItems',
      'maxItems',
      'default',
    ];
    const all = nodes(z.toJSONSchema(schema));
    const objects = all.filter((n) => n.type === 'object');
    expect(objects.length).toBeGreaterThan(0);
    for (const o of objects) {
      expect(o.additionalProperties).toBe(false);
      expect(o.required).toEqual(Object.keys(o.properties as object));
    }
    for (const n of all) for (const k of banned) expect(n, k).not.toHaveProperty(k);
  });

  it('answers as the capture form would have', () => {
    const form = taggerToForm(
      {
        ...answer,
        pattern: 'solid',
        materials: ['wool', 'wool'],
        styleTags: ['cozy', 'cozy'],
      },
      kinds
    );
    expect(form).toEqual({
      category: 'top', // read off the sweater, never asked
      subcategory: 'sweater',
      pattern: 'solid',
      patternScale: 'none',
      materials: ['wool'],
      sheen: 'matte',
      styleTags: [{ tag: 'cozy', weight: 1 }],
    });
  });

  it("becomes a whole garment through applyDefaults, keeping the kind's materials if it names none", () => {
    const g = applyDefaults(
      taggerToForm({ ...answer, subcategory: 'jeans', materials: [] }, kinds),
      defaults
    );
    expect(g.category).toBe('bottom');
    expect(g.materials).toEqual(['denim']);
    expect(g.warmth).toBe(3);
    expect(g.pattern).toBe('stripe');
  });
});
