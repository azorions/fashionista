/* eslint-disable import/no-duplicates -- the ?raw imports are the source TEXT of score.ts and vibes.ts, not second copies of the modules */
import { describe, expect, it } from 'vitest';

import taxonomySql from '../../../supabase/migrations/0001_taxonomy.sql?raw';
import { rowToDefaults, type SubcategoryRow } from '../garment/row';
import { applyDefaults } from '../tagging/schema';
import { garment, mixedWardrobe, styleWardrobe, swatch } from './fixtures';
import { suggest } from './generate';
import { scoreOutfit } from './score';
import scoreSrc from './score.ts?raw';
import type { Garment, ScoredOutfit, VibeSpec } from './types';
import { COZY, MINIMAL, SMART_CASUAL, STREETWEAR, VIBE_LIST } from './vibes';
import vibesSrc from './vibes.ts?raw';

const ids = (o: ScoredOutfit) => o.items.map((i) => i.id);
const label = (o: ScoredOutfit) => ids(o).join(' + ');
const run = (vibe: VibeSpec, wardrobe = styleWardrobe()) =>
  suggest(wardrobe, vibe, { count: 5 }).outfits;
const signatures = (o: ScoredOutfit) =>
  o.terms.filter((t) => t.name === 'signature').map((t) => String(t.evidence?.describe));

/** Every garment_subcategory seed row, parsed into the shape the app reads. */
function seedRows(): SubcategoryRow[] {
  const block = taxonomySql.split('insert into public.garment_subcategory')[1].split(';')[0];
  return [...block.matchAll(/^\s*\((.*)\),?$/gm)].map(([, body]) => {
    const f = [...body.matchAll(/'([^']*)'|(\d+)/g)].map((m) => m[1] ?? Number(m[2]));
    const arr = (v: unknown) => String(v).replace(/[{}]/g, '').split(',').filter(Boolean);
    return {
      code: f[0],
      label: f[1],
      category: f[2],
      default_body_zone: f[3],
      default_layer_role: f[4],
      alt_layer_roles: arr(f[5]),
      default_warmth: f[6],
      default_breathability: f[7],
      default_bulk: f[8],
      default_formality: f[9],
      default_silhouette: f[10],
      default_length: f[11],
      default_rise: f[12],
      sort: f[13],
      default_materials: arr(f[14]),
      default_pattern: f[15],
      default_pattern_scale: f[16],
      default_sheen: f[17],
    } as unknown as SubcategoryRow;
  });
}

describe('the seed and the vibes agree', () => {
  const codes = new Set(seedRows().map((r) => r.code));

  it('parses every seed row', () => {
    expect(codes.size).toBeGreaterThan(40);
    expect(codes).toContain('unknown');
  });

  it('names only subcategories that exist in the seed', () => {
    // A signature testing `subcategory === 'sneeakers'` never fires and never
    // fails; this is the only thing that would notice.
    const named = [vibesSrc, scoreSrc]
      .flatMap((src) => src.split('\n'))
      .filter((line) => /subcategor/i.test(line) && !line.trim().startsWith('*'))
      // `subcategory === 'x'`, or a list literal on a line about subcategories.
      .flatMap((line) => [
        ...[...line.matchAll(/subcategory === '([a-z_]+)'/g)].map((m) => m[1]),
        ...[...line.matchAll(/\[([^\]]*)\]/g)].flatMap((m) =>
          [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]),
        ),
      ]);
    expect(named).toEqual(expect.arrayContaining(['sneakers', 'hoodie', 'shirt', 'blazer']));
    for (const code of named)
      expect(codes, `'${code}' is not a seeded subcategory`).toContain(code);
  });
});

describe('minimal', () => {
  const outfits = run(MINIMAL);

  it('keeps loud patterns and shine out entirely', () => {
    expect(outfits.length).toBeGreaterThan(0);
    for (const o of outfits) {
      for (const g of o.items) {
        expect(g.sheen, label(o)).not.toBe('shiny');
        expect(['medium', 'large'], label(o)).not.toContain(g.patternScale);
      }
    }
  });

  it('leads with a tight, neutral palette', () => {
    expect(signatures(outfits[0])).toContain('a tight, neutral palette');
  });
});

describe('streetwear', () => {
  const outfits = run(STREETWEAR);

  it('leads with sneakers, the graphic tee and an oversized piece', () => {
    expect(ids(outfits[0])).toEqual(expect.arrayContaining(['sneakers', 'graphic-tee']));
    expect(signatures(outfits[0])).toContain('sneakers with an oversized piece');
  });

  it('never reaches for anything formal', () => {
    for (const o of outfits)
      expect(
        o.items.every((g) => g.formality < 4),
        label(o),
      ).toBe(true);
  });
});

describe('smart casual', () => {
  const outfits = run(SMART_CASUAL);

  it('leads with the collar and the loafers', () => {
    expect(ids(outfits[0])).toEqual(expect.arrayContaining(['oxford', 'loafers']));
    expect(signatures(outfits[0])).toEqual(
      expect.arrayContaining(['a collar or a blazer', 'shoes that set the tone']),
    );
  });

  it('never suggests loungewear, even to fill the list', () => {
    for (const o of outfits) {
      expect(ids(o)).not.toContain('joggers');
      expect(ids(o)).not.toContain('grey-hoodie');
    }
  });
});

describe('cozy', () => {
  const outfits = run(COZY);

  it('leads with something soft to sink into', () => {
    expect(signatures(outfits[0])).toContain('something soft to sink into');
  });

  it('never drops below its warmth floor, and never reaches for leather or a formal coat', () => {
    for (const o of outfits) {
      const warmth = Number(o.terms.find((t) => t.name === 'warmth')?.evidence?.warmth);
      expect(warmth, label(o)).toBeGreaterThanOrEqual(COZY.warmth.min);
      expect(ids(o)).not.toContain('boots');
      expect(ids(o)).not.toContain('wool-coat');
    }
  });
});

describe('a closet built only from subcategory defaults', () => {
  /*
   * What real data looks like until someone opens "More details": category,
   * subcategory and nothing else. Every vibe with a signature must still be
   * able to fire one, or the signatures only decorate the test fixtures.
   */
  const colours = ['#f2f2f0', '#1f1f22', '#5a7794', '#c9bfae', '#7a4b46', '#9a9ca0', '#3f4a3c'];
  const closet: Garment[] = seedRows()
    .filter((r) => r.category !== 'accessory' && r.code !== 'unknown')
    .map((r, i) => ({
      id: r.code,
      ...applyDefaults({ category: r.category, subcategory: r.code }, rowToDefaults(r)),
      palette: [swatch(colours[i % colours.length])],
    }));

  it.each(VIBE_LIST.filter((v) => v.signature?.length).map((v) => [v.label, v] as const))(
    '%s still fires a signature',
    (_label, vibe) => {
      const outfits = run(vibe, closet);
      expect(outfits.length).toBeGreaterThan(0);
      expect(outfits.some((o) => signatures(o).length > 0)).toBe(true);
    },
  );
});

describe('shoes match the season of what they are worn with', () => {
  const w = styleWardrobe();
  const find = (id: string) => w.find((g) => g.id === id)!;
  const coherence = (items: Garment[]) =>
    scoreOutfit(items, MINIMAL).terms.find((t) => t.name === 'coherence')?.value;
  const of = (...pieces: string[]) => coherence(pieces.map(find));

  it('penalises sandals with wool trousers and boots with shorts', () => {
    expect(of('white-tee', 'wool-trousers', 'sandals')).toBeLessThan(0.55);
    expect(of('white-tee', 'linen-shorts', 'boots')).toBeLessThan(0.55);
  });

  it('leaves ordinary pairings alone', () => {
    expect(of('white-tee', 'low-jeans', 'sneakers')).toBe(1);
    expect(of('white-tee', 'linen-shorts', 'sandals')).toBe(1);
  });

  it('lets boots go with a dress or a mini skirt', () => {
    expect(of('summer-dress', 'boots')).toBe(1);
    const mini = garment({
      id: 'mini',
      subcategory: 'mini_skirt',
      category: 'bottom',
      bodyZone: 'legs',
      layerRole: 'bottom',
      warmth: 1,
    });
    expect(coherence([find('white-tee'), mini, find('boots')])).toBe(1);
  });

  it('keeps sandals and wool trousers out of minimal suggestions', () => {
    for (const o of run(MINIMAL, mixedWardrobe())) {
      expect(ids(o).includes('sandals') && ids(o).includes('wool-trousers'), label(o)).toBe(false);
    }
  });
});

describe('variety never promotes a bad outfit', () => {
  it('fills with the best separates rather than a poor dress when the route cap bites', () => {
    // Three great streetwear tees and one dress that suits the vibe badly.
    // With three slots the route cap stops separates at two, and the variety
    // pass used to hand the third slot to the dress purely for being different.
    const tee = (id: string, hex: string) =>
      garment({ id, silhouette: 'oversized', pattern: 'graphic', palette: [swatch(hex)] });
    const closet = [
      tee('tee-a', '#1f1f22'),
      tee('tee-b', '#2b2c30'),
      tee('tee-c', '#3a3b40'),
      garment({
        id: 'joggers',
        category: 'bottom',
        bodyZone: 'legs',
        layerRole: 'bottom',
        silhouette: 'relaxed',
        formality: 1,
        palette: [swatch('#2b2c30')],
      }),
      garment({
        id: 'jeans',
        category: 'bottom',
        bodyZone: 'legs',
        layerRole: 'bottom',
        materials: ['denim'],
        palette: [swatch('#5a7794')],
      }),
      garment({
        id: 'sneakers',
        subcategory: 'sneakers',
        category: 'footwear',
        bodyZone: 'feet',
        layerRole: 'footwear',
        palette: [swatch('#efefef')],
      }),
      garment({
        id: 'tea-dress',
        subcategory: 'dress',
        category: 'dress',
        bodyZone: 'full_body',
        layerRole: 'full_body',
        formality: 3,
        silhouette: 'fitted',
        pattern: 'floral',
        patternScale: 'large',
        materials: ['silk'],
        palette: [swatch('#e0457b')],
      }),
    ];
    const outfits = suggest(closet, STREETWEAR, { count: 3 }).outfits;
    expect(outfits).toHaveLength(3);
    expect(outfits.flatMap(ids)).not.toContain('tea-dress');
  });
});
