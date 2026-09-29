import { describe, expect, it } from 'vitest';

import taxonomySql from '../../../supabase/migrations/0001_taxonomy.sql?raw';
import wardrobeSql from '../../../supabase/migrations/0002_wardrobe.sql?raw';
import { GarmentTagsSchema } from '../tagging/schema';
import {
  rowToDefaults,
  rowToGarment,
  tagsToRow,
  type SubcategoryRow,
  type WardrobeItemRow,
} from './row';

/**
 * Field mapping is where things go quietly wrong.
 *
 * Nothing at runtime notices a dropped field: TypeScript is happy because the
 * source object is still assignable, Postgres is happy because the column just
 * keeps its default, and the bug surfaces months later as "why does the engine
 * think everything is formality 3". These tests exist because that failure is
 * silent, not because the code is complicated.
 */

const fullRow: WardrobeItemRow = {
  id: 'item-1',
  user_id: 'user-1',
  name: 'the good flannel',
  category: 'top',
  subcategory: 'flannel',
  body_zone: 'torso',
  layer_role: 'base',
  alt_layer_roles: ['mid', 'outer'],
  warmth: 3,
  breathability: 3,
  bulk: 3,
  formality: 2,
  silhouette: 'relaxed',
  length: 'hip',
  rise: 'n_a',
  pattern: 'check',
  pattern_scale: 'medium',
  materials: ['cotton'],
  sheen: 'matte',
  palette: [{ l: 0.42, c: 0.11, h: 258.4, fraction: 0.8 }],
  confidence: { warmth: 0.4 },
  cover_image_id: 'img-1',
  last_worn_at: null,
  times_worn: 0,
  archived: false,
};

describe('the hand-written row type matches the migration', () => {
  /**
   * WardrobeItemRow is hand-written because `npm run db:types` needs a linked
   * Supabase project that does not exist yet. That makes it the one type in
   * the codebase nothing verifies — so this test verifies it, in both
   * directions: TypeScript rejects `fullRow` if a field is missing from it,
   * and this test fails if a SQL column is missing from the interface.
   *
   * Delete this once db:types is generating the real thing.
   */
  function sqlColumns(): string[] {
    const m = wardrobeSql.match(/create table public\.wardrobe_items \(([\s\S]*?)\n\);/);
    if (!m) throw new Error('could not find the wardrobe_items table');
    return m[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('--'))
      .map((l) => l.split(/\s+/)[0])
      .filter((c) => /^[a-z_]+$/.test(c));
  }

  it('covers every column the table declares', () => {
    const declared = sqlColumns();
    const mapped = Object.keys(fullRow);
    expect(declared.length).toBeGreaterThan(20); // the parse actually worked
    for (const col of declared) {
      if (col === 'created_at' || col === 'updated_at') continue; // never read
      expect(mapped, `column "${col}" is in SQL but missing from WardrobeItemRow`).toContain(col);
    }
  });

  it('invents no columns the table does not have', () => {
    const declared = new Set(sqlColumns());
    for (const key of Object.keys(fullRow)) {
      expect(declared, `"${key}" is on WardrobeItemRow but not in the table`).toContain(key);
    }
  });
});

describe('tagsToRow', () => {
  const tags = GarmentTagsSchema.parse({
    category: 'bottom',
    subcategory: 'low_jeans',
    bodyZone: 'legs',
    layerRole: 'bottom',
    warmth: 3,
    breathability: 2,
    bulk: 3,
    formality: 2,
    silhouette: 'flared',
    length: 'full',
    rise: 'low',
    materials: ['denim'],
    name: 'the flares',
  });

  it('maps every camelCase field to its snake_case column', () => {
    const row = tagsToRow(tags);
    expect(row.body_zone).toBe('legs');
    expect(row.layer_role).toBe('bottom');
    expect(row.alt_layer_roles).toEqual([]);
    expect(row.pattern_scale).toBe('none');
    expect(row.rise).toBe('low');
  });

  it('drops nothing — every tag field reaches a column', () => {
    const row = tagsToRow(tags) as Record<string, unknown>;
    // styleTags lives in its own junction table, so it is the one exception.
    const expected = Object.keys(tags).filter((k) => k !== 'styleTags');
    const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    for (const key of expected) {
      expect(Object.keys(row), `tag field "${key}" never reaches a column`).toContain(snake(key));
    }
  });

  it('writes an absent name as null, not undefined', () => {
    // undefined would make supabase-js omit the key and leave a stale name in
    // place on an update; null actually clears it.
    const row = tagsToRow({ ...tags, name: undefined });
    expect(row.name).toBeNull();
  });
});

describe('rowToGarment', () => {
  it('maps a full row', () => {
    const g = rowToGarment(fullRow);
    expect(g.id).toBe('item-1');
    expect(g.bodyZone).toBe('torso');
    expect(g.altLayerRoles).toEqual(['mid', 'outer']);
    expect(g.patternScale).toBe('medium');
    expect(g.palette).toHaveLength(1);
    expect(g.confidence?.warmth).toBe(0.4);
  });

  it('round-trips the tag fields back through tagsToRow unchanged', () => {
    const g = rowToGarment(fullRow);
    const back = tagsToRow(g) as Record<string, unknown>;
    for (const [k, v] of Object.entries(back)) {
      expect((fullRow as unknown as Record<string, unknown>)[k], `field ${k}`).toEqual(v);
    }
  });

  it('produces something the schema accepts', () => {
    // Guards the seam: a row read back from Postgres must be a valid garment,
    // or the engine is scoring values the tagger would have rejected.
    expect(() => GarmentTagsSchema.parse(rowToGarment(fullRow))).not.toThrow();
  });

  it('survives null arrays from a freshly inserted row', () => {
    const sparse = {
      ...fullRow,
      alt_layer_roles: null,
      materials: null,
      palette: null,
    } as unknown as WardrobeItemRow;
    const g = rowToGarment(sparse);
    expect(g.altLayerRoles).toEqual([]);
    expect(g.materials).toEqual([]);
    expect(g.palette).toEqual([]);
  });

  it('maps embedded style tags, coercing numeric weights sent as strings', () => {
    const g = rowToGarment({
      ...fullRow,
      tags: [
        { tag_code: 'y2k', weight: '0.90' },
        { tag_code: 'soft', weight: 0.4 },
      ],
    });
    expect(g.styleTags).toEqual([
      { tag: 'y2k', weight: 0.9 },
      { tag: 'soft', weight: 0.4 },
    ]);
  });

  it('drops unknown tag codes rather than trusting them', () => {
    const g = rowToGarment({ ...fullRow, tags: [{ tag_code: 'not-a-tag', weight: 1 }] });
    expect(g.styleTags).toEqual([]);
  });

  it('treats a row without embedded tags as having none', () => {
    expect(rowToGarment(fullRow).styleTags).toEqual([]);
  });
});

describe('rowToDefaults', () => {
  const sub: SubcategoryRow = {
    code: 'flannel',
    label: 'Flannel shirt',
    category: 'top',
    default_body_zone: 'torso',
    default_layer_role: 'base',
    alt_layer_roles: ['mid', 'outer'],
    default_warmth: 3,
    default_breathability: 3,
    default_bulk: 3,
    default_formality: 2,
    default_silhouette: 'relaxed',
    default_length: 'hip',
    default_rise: 'n_a',
    sort: 15,
    default_materials: ['cotton'],
    default_pattern: 'check',
    default_pattern_scale: 'medium',
    default_sheen: 'matte',
  };

  it('carries the material, pattern and finish defaults', () => {
    const d = rowToDefaults(sub);
    expect(d.materials).toEqual(['cotton']);
    expect(d.pattern).toBe('check');
    expect(d.patternScale).toBe('medium');
    expect(d.sheen).toBe('matte');
  });

  it('strips the default_ prefix onto the tag field names', () => {
    const d = rowToDefaults(sub);
    expect(d.bodyZone).toBe('torso');
    expect(d.warmth).toBe(3);
    expect(d.silhouette).toBe('relaxed');
    expect(d.altLayerRoles).toEqual(['mid', 'outer']);
  });

  it('supplies exactly the fields the three-field form does not ask for', () => {
    const d = rowToDefaults(sub) as Record<string, unknown>;
    const asked = ['category', 'subcategory', 'name'];
    const schemaFields = Object.keys(GarmentTagsSchema.shape);
    const needed = schemaFields.filter((f) => !asked.includes(f) && f !== 'styleTags');

    // Anything in this list but not in the defaults has to be typed by hand on
    // every single garment, which is how a closet stays empty at four items.
    const optional = ['pattern', 'patternScale', 'materials', 'sheen'];
    for (const f of needed) {
      if (optional.includes(f)) continue;
      expect(Object.keys(d), `"${f}" has no subcategory default`).toContain(f);
    }
  });
});

/**
 * The protections in the migration are one careless edit away from vanishing,
 * and nothing at runtime would notice until someone's photos leaked. These
 * are string checks on purpose: they guard the TEXT of the migration, which is
 * what gets applied.
 */
describe('security protections in the migration', () => {
  it('pins every image path to the owner folder with a CHECK the service role cannot bypass', () => {
    // The Edge Function signs source_path with the service role, which skips
    // storage RLS. Without this, a user could point it at someone else's photo.
    expect(wardrobeSql).toMatch(/constraint item_images_paths_in_own_folder check \(/);
    // Substring checks, not a regex: a pattern here would have to escape
    // ( | and \ through a template literal -- exactly the kind of test that
    // quietly stops matching anything.
    const from = wardrobeSql.indexOf('constraint item_images_paths_in_own_folder');
    const body = wardrobeSql.slice(from, wardrobeSql.indexOf(');', from));
    const prefix = "user_id::text || '/' || item_id::text || '/'";
    for (const col of ['source_path', 'tile_path', 'thumb_path']) {
      const at = body.indexOf(`starts_with(${col},`);
      expect(at, `${col} is not pinned`).toBeGreaterThanOrEqual(0);
      expect(body.slice(at, at + 90), `${col} prefix`).toContain(prefix);
    }
  });

  it('refuses to link another user’s garment into an outfit', () => {
    expect(wardrobeSql).toMatch(/does not belong to this outfit''s owner/);
  });

  it('saves an outfit atomically through a security-invoker function', () => {
    expect(wardrobeSql).toMatch(/create or replace function public\.save_outfit/);
    const fn = wardrobeSql.slice(wardrobeSql.indexOf('function public.save_outfit'));
    expect(fn.slice(0, 400)).toMatch(/security invoker/);
    expect(wardrobeSql).toMatch(
      /revoke execute on function public\.save_outfit\(uuid\[\], text, text, text\) from public, anon/,
    );
  });

  it('only accepts the two outfit sources', () => {
    expect(wardrobeSql).toContain("check (source in ('manual', 'suggested'))");
  });

  it('replaces style tags atomically through a security-invoker function', () => {
    const fn = wardrobeSql.slice(wardrobeSql.indexOf('function public.set_style_tags'));
    expect(fn.slice(0, 200)).toMatch(/security invoker/);
    expect(wardrobeSql).toMatch(
      /revoke execute on function public\.set_style_tags\(uuid, text\[\]\) from public, anon/,
    );
  });

  it('drops an outfit once fewer than two garments remain in it', () => {
    // Garment delete cascades out of outfit_items; without this the saved list
    // fills with one-piece and empty outfits.
    expect(wardrobeSql).toMatch(
      /after delete on public\.outfit_items\s+for each row execute function public\.drop_outfit_below_two\(\)/,
    );
    const fn = wardrobeSql.slice(wardrobeSql.indexOf('function public.drop_outfit_below_two'));
    expect(fn.slice(0, 400)).toContain('< 2');
    // Definer, so an account delete (as supabase_auth_admin) can cascade
    // through it -- and therefore it must only ever touch the deleted row's
    // own outfit.
    expect(fn.slice(0, 200)).toMatch(/security definer/);
    expect(fn.slice(0, 400)).toContain('where o.id = old.outfit_id');
  });

  it('limits what and how much can be uploaded, not just where', () => {
    expect(wardrobeSql).toMatch(/file_size_limit, allowed_mime_types/);
  });

  it('pins search_path on every function', () => {
    const fns = [...wardrobeSql.matchAll(/create or replace function [\s\S]*?as \$\$/g)].map(
      (m) => m[0],
    );
    expect(fns.length).toBeGreaterThanOrEqual(5);
    for (const f of fns) expect(f, f.split('\n')[0]).toMatch(/set search_path = ''/);
  });

  it('keeps pgvector out of the public schema', () => {
    expect(taxonomySql).toMatch(/create extension if not exists vector with schema extensions;/);
  });
});
