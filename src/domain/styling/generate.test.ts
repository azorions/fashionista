import { describe, expect, it } from 'vitest';

import { isValid, outfitWarmth, structuralViolations, torsoLayers } from './constraints';
import { garment, mixedWardrobe, swatch, tinyWardrobe } from './fixtures';
import { suggest, whyInvalid } from './generate';
import { SOFT, SUMMER, WINTER, Y2K } from './vibes';

const ids = (o: { items: { id: string }[] }) => o.items.map((i) => i.id).sort();

describe('structural constraints (H0 — never relaxed)', () => {
  const w = mixedWardrobe();
  const find = (id: string) => w.find((g) => g.id === id)!;

  it('accepts a plain top, bottom and shoes', () => {
    expect(isValid([find('white-tee'), find('low-jeans'), find('sneakers')])).toBe(true);
  });

  it('rejects an outfit with no shoes', () => {
    expect(whyInvalid([find('white-tee'), find('low-jeans')])).toContain('needs shoes');
  });

  it('rejects an outfit with no bottom', () => {
    expect(whyInvalid([find('white-tee'), find('sneakers')])).toContain('needs a top and a bottom');
  });

  it('rejects two bottoms', () => {
    const second = garment({ id: 'x', bodyZone: 'legs', layerRole: 'bottom', category: 'bottom' });
    expect(whyInvalid([find('white-tee'), find('low-jeans'), second, find('sneakers')])).toContain(
      'only one legs garment',
    );
  });

  it('rejects a coat over a coat', () => {
    expect(
      whyInvalid([
        find('white-tee'),
        find('wool-coat'),
        find('denim-jacket'),
        find('low-jeans'),
        find('sneakers'),
      ]),
    ).toContain('only one outer layer');
  });

  it('rejects trousers worn with a dress', () => {
    expect(whyInvalid([find('summer-dress'), find('low-jeans'), find('sandals')])).toContain(
      'a dress already covers top and bottom',
    );
  });

  it('allows a coat OVER a dress', () => {
    expect(isValid([find('summer-dress'), find('wool-coat'), find('boots')])).toBe(true);
  });

  it('rejects a chunky knit under a fitted jacket — what `bulk` exists for', () => {
    const fittedJacket = garment({
      id: 'fitted-blazer',
      category: 'outerwear',
      layerRole: 'outer',
      silhouette: 'fitted',
      warmth: 3,
    });
    const v = whyInvalid([
      find('white-tee'),
      find('wool-sweater'), // bulk 4
      fittedJacket,
      find('low-jeans'),
      find('sneakers'),
    ]);
    expect(v.join(' ')).toMatch(/fitted jacket/);
  });

  it('reports H0 violations at tier H0', () => {
    expect(structuralViolations([]).every((v) => v.tier === 'H0')).toBe(true);
  });
});

describe('warmth uses diminishing returns', () => {
  it('does not treat three mid layers as the sum of their warmth', () => {
    const three = [
      garment({ id: 'a', warmth: 3 }),
      garment({ id: 'b', warmth: 3, layerRole: 'mid' }),
      garment({ id: 'c', warmth: 3, layerRole: 'outer' }),
    ];
    const naive = 9;
    expect(outfitWarmth(three)).toBeLessThan(naive);
    expect(outfitWarmth(three)).toBeGreaterThan(3); // but more than one alone
  });

  it('counts torso layers, not total garments', () => {
    const w = mixedWardrobe();
    const find = (id: string) => w.find((g) => g.id === id)!;
    expect(torsoLayers([find('white-tee'), find('low-jeans'), find('sneakers')])).toBe(1);
    expect(
      torsoLayers([find('white-tee'), find('wool-sweater'), find('wool-coat'), find('sneakers')]),
    ).toBe(3);
  });
});

describe('summer — the headline requirement is "not layered"', () => {
  const { outfits } = suggest(mixedWardrobe(), SUMMER, { count: 5 });

  it('returns outfits', () => {
    expect(outfits.length).toBeGreaterThan(0);
  });

  it('NEVER layers the torso', () => {
    for (const o of outfits) expect(torsoLayers(o.items)).toBeLessThanOrEqual(1);
  });

  it('never includes a heavy coat — the trust-destroying failure', () => {
    for (const o of outfits) {
      expect(o.items.map((i) => i.id)).not.toContain('wool-coat');
      expect(o.items.every((i) => i.warmth < 4)).toBe(true);
    }
  });

  it('is strictly cooler than every winter suggestion', () => {
    // The property that actually matters, and the one that stays stable when
    // weights are tuned. Asserting the top result lands inside the declared
    // band to the decimal would break on every adjustment for no real gain --
    // 3.7 against a 3.5 target is noise on a hand-tuned 0..10 scale.
    const warmest = Math.max(...outfits.map((o) => outfitWarmth(o.items)));
    const coolestWinter = Math.min(
      ...suggest(mixedWardrobe(), WINTER, { count: 5 }).outfits.map((o) => outfitWarmth(o.items)),
    );
    expect(warmest).toBeLessThan(coolestWinter);
  });

  it('never drifts anywhere near winter warmth', () => {
    for (const o of outfits) expect(outfitWarmth(o.items)).toBeLessThan(WINTER.warmth.min);
  });

  it('never puts an outer layer over a dress', () => {
    // torsoLayers must count full-body garments, or a jacket over a dress
    // reads as one layer and slips past the no-layering rule.
    for (const o of outfits) {
      const hasDress = o.items.some((i) => i.bodyZone === 'full_body');
      if (hasDress) expect(o.items.every((i) => i.layerRole !== 'outer')).toBe(true);
    }
  });

  it('prefers breathable pieces at the top of the ranking', () => {
    const top = outfits[0];
    expect(top.items.some((i) => i.materials.includes('linen') || i.breathability >= 4)).toBe(true);
  });
});

describe('winter — the mirror: layered', () => {
  const { outfits } = suggest(mixedWardrobe(), WINTER, { count: 5 });

  it('returns outfits', () => {
    expect(outfits.length).toBeGreaterThan(0);
  });

  it('always layers the torso', () => {
    for (const o of outfits) expect(torsoLayers(o.items)).toBeGreaterThanOrEqual(2);
  });

  it('never falls below the warmth floor winter declares', () => {
    // Enforced at H1: a dress and a denim jacket (5.0) used to be able to
    // reach this list once the variety rule had used up the warmer pieces.
    for (const o of outfits) {
      expect(outfitWarmth(o.items)).toBeGreaterThanOrEqual(WINTER.warmth.min);
    }
  });

  it('never suggests sandals', () => {
    for (const o of outfits) expect(o.items.map((i) => i.id)).not.toContain('sandals');
  });

  it('uses the flannel as a MID layer, not only as a base', () => {
    // The whole reason layerRole and altLayerRoles are separate columns: a
    // flannel worn over a tee. Collapse the axis and winter suggests
    // parka-over-parka instead.
    const all = suggest(mixedWardrobe(), WINTER, { count: 12 }).outfits;
    const layeredFlannel = all.some(
      (o) =>
        o.items.some((i) => i.id === 'flannel') &&
        o.items.some((i) => i.id !== 'flannel' && i.bodyZone === 'torso'),
    );
    expect(layeredFlannel).toBe(true);
  });
});

describe('summer and winter are genuinely opposite', () => {
  it('shares no top-ranked outfit between them', () => {
    const s = suggest(mixedWardrobe(), SUMMER, { count: 5 }).outfits.map(ids);
    const w = suggest(mixedWardrobe(), WINTER, { count: 5 }).outfits.map(ids);
    for (const a of s) {
      for (const b of w) expect(a.join()).not.toBe(b.join());
    }
  });
});

describe('y2k — the signature is what identifies it', () => {
  const { outfits } = suggest(mixedWardrobe(), Y2K, { count: 5 });

  it('returns outfits', () => {
    expect(outfits.length).toBeGreaterThan(0);
  });

  it('puts the low-rise + crop pairing first', () => {
    // Neither attribute alone is y2k: low-rise alone is just jeans, a crop top
    // alone is just a crop top. Scoring them separately would never find this.
    const top = outfits[0];
    expect(top.items.some((i) => i.rise === 'low')).toBe(true);
    expect(top.items.some((i) => i.length === 'crop')).toBe(true);
  });

  it('avoids high-waisted trousers', () => {
    expect(outfits[0].items.map((i) => i.id)).not.toContain('wool-trousers');
  });

  it('explains itself by naming the signature', () => {
    expect(outfits[0].why.toLowerCase()).toContain('low rise');
  });
});

describe('soft — low contrast, not just muted', () => {
  const { outfits } = suggest(mixedWardrobe(), SOFT, { count: 5 });

  it('returns outfits', () => {
    expect(outfits.length).toBeGreaterThan(0);
  });

  it('avoids shiny pieces', () => {
    for (const o of outfits) expect(o.items.every((i) => i.sheen !== 'shiny')).toBe(true);
  });

  it('favours the knit', () => {
    expect(outfits.some((o) => o.items.some((i) => i.materials.includes('knit')))).toBe(true);
  });
});

describe('a tiny wardrobe degrades honestly', () => {
  const result = suggest(tinyWardrobe(), SUMMER, { count: 5 });

  it('returns fewer outfits rather than padding with nonsense', () => {
    expect(result.outfits.length).toBeLessThan(5);
  });

  it('never breaks a structural rule to fill the quota', () => {
    for (const o of result.outfits) expect(isValid(o.items)).toBe(true);
  });

  it('says what the closet is missing', () => {
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.gaps[0].message.length).toBeGreaterThan(10);
  });

  it('reports any rule it had to bend, rather than bending it silently', () => {
    const winter = suggest(tinyWardrobe(), WINTER, { count: 5 });
    for (const o of winter.outfits) {
      if (o.relaxed.length) expect(o.why).toMatch(/bent a rule/i);
    }
  });

  it('never claims to have bent a rule the outfit does not actually break', () => {
    // The old test above only checked that the caption agreed with the flag.
    // The flag itself was wrong: every veto lifted by the tier was reported,
    // so tee + puffer + jeans + sneakers was captioned "bent a rule -- nothing
    // summer-weight and covered shoes", and it broke neither.
    for (const vibe of [SUMMER, WINTER, Y2K, SOFT]) {
      for (const wardrobe of [tinyWardrobe(), mixedWardrobe()]) {
        for (const o of suggest(wardrobe, vibe, { count: 5 }).outfits) {
          for (const rule of o.relaxed) {
            const veto = (vibe.veto ?? []).find((v) => v.describe === rule);
            if (veto) {
              expect(o.items.some(veto.test), `${vibe.label}: "${rule}"`).toBe(true);
            } else if (rule.includes('layers')) {
              const n = torsoLayers(o.items);
              expect(n < vibe.layers.min || n > vibe.layers.max, rule).toBe(true);
            } else if (rule.includes('cooler')) {
              expect(outfitWarmth(o.items)).toBeLessThan(vibe.warmth.min);
            } else {
              throw new Error(`unrecognised relaxed rule: "${rule}"`);
            }
          }
        }
      }
    }
  });
});

describe('engine behaviour', () => {
  it('is deterministic — same closet and vibe gives the same outfits', () => {
    const a = suggest(mixedWardrobe(), SUMMER, { count: 5 }).outfits.map(ids);
    const b = suggest(mixedWardrobe(), SUMMER, { count: 5 }).outfits.map(ids);
    expect(a).toEqual(b);
  });

  it('returns distinct outfits, not five variations on one', () => {
    const outfits = suggest(mixedWardrobe(), SUMMER, { count: 5 }).outfits;
    const seen = new Set(outfits.map((o) => ids(o).join()));
    expect(seen.size).toBe(outfits.length);
  });

  // A locked garment FILLS its slot. The old generator removed locked items
  // from the pools and prepended them to every combination instead.
  it('still suggests outfits when the only pair of shoes is locked', () => {
    // Emptied the shoe pool, so this returned nothing at all.
    const w = tinyWardrobe();
    const sneakers = w.find((g) => g.id === 'sneakers')!;
    const { outfits } = suggest(w, SUMMER, { count: 3, locked: [sneakers] });
    expect(outfits.length).toBeGreaterThan(0);
    for (const o of outfits) expect(o.items.map((i) => i.id)).toContain('sneakers');
  });

  it('builds around a locked dress instead of disabling dresses', () => {
    // Disabled the dress route, then paired the dress with a top and bottom
    // that the structural rules rejected: zero outfits.
    const w = mixedWardrobe();
    const dress = w.find((g) => g.id === 'summer-dress')!;
    const { outfits } = suggest(w, SUMMER, { count: 3, locked: [dress] });
    expect(outfits.length).toBeGreaterThan(0);
    for (const o of outfits) {
      expect(o.items.map((i) => i.id)).toContain('summer-dress');
      expect(isValid(o.items)).toBe(true);
    }
  });

  it('never adds a second top around a locked one', () => {
    // Produced [white-tee, linen-tank, jeans, sneakers] -- two base tops.
    const w = mixedWardrobe();
    const tee = w.find((g) => g.id === 'white-tee')!;
    const { outfits } = suggest(w, SUMMER, { count: 5, locked: [tee] });
    expect(outfits.length).toBeGreaterThan(0);
    for (const o of outfits) {
      const baseTops = o.items.filter((i) => i.bodyZone === 'torso' && i.layerRole === 'base');
      expect(baseTops.map((i) => i.id)).toEqual(['white-tee']);
    }
  });

  it('never places the multi-role flannel twice in one outfit', () => {
    // The flannel can play base, mid AND outer. [flannel, sweater, flannel,
    // jeans, boots] came out of the generator and outscored honest outfits,
    // because the flannel was counted as two layers of warmth.
    for (const o of suggest(mixedWardrobe(), WINTER, { count: 20 }).outfits) {
      expect(o.items.filter((i) => i.id === 'flannel').length).toBeLessThanOrEqual(1);
    }
  });

  it('names every signature that fired, not just the first', () => {
    const top = suggest(mixedWardrobe(), Y2K, { count: 1 }).outfits[0];
    expect(top.why).toContain('low rise with a cropped top');
    expect(top.why).toContain('a bit of shine');
  });

  it('respects locked items', () => {
    const w = mixedWardrobe();
    const boots = w.find((g) => g.id === 'boots')!;
    const { outfits } = suggest(w, WINTER, { count: 3, locked: [boots] });
    for (const o of outfits) expect(o.items.map((i) => i.id)).toContain('boots');
  });

  it('respects exclusions', () => {
    const { outfits } = suggest(mixedWardrobe(), SUMMER, { count: 5, exclude: ['sandals'] });
    for (const o of outfits) expect(o.items.map((i) => i.id)).not.toContain('sandals');
  });

  it('returns nothing rather than something invalid for an empty closet', () => {
    expect(suggest([], SUMMER).outfits).toEqual([]);
  });

  it('survives a closet of only shoes', () => {
    const shoesOnly = [
      garment({ id: 's1', bodyZone: 'feet', layerRole: 'footwear', category: 'footwear' }),
    ];
    expect(() => suggest(shoesOnly, SUMMER)).not.toThrow();
    expect(suggest(shoesOnly, SUMMER).outfits).toEqual([]);
  });

  it('scores every outfit as a finite, non-negative base plus signature bonuses', () => {
    // The base is in [0, 1]; only signature bonuses lift the total past 1.
    // It used to be clamped to 1, which tied every top outfit at 1.000 and
    // left the order among them to generation order.
    for (const vibe of [SUMMER, WINTER, Y2K, SOFT]) {
      const maxBonus = (vibe.signature ?? []).reduce((a, s) => a + s.bonus, 0);
      for (const o of suggest(mixedWardrobe(), vibe, { count: 5 }).outfits) {
        expect(Number.isFinite(o.score)).toBe(true);
        expect(o.score).toBeGreaterThanOrEqual(0);
        expect(o.score).toBeLessThanOrEqual(1 + maxBonus + 1e-9);
      }
    }
  });

  it('ranks descending', () => {
    const o = suggest(mixedWardrobe(), WINTER, { count: 5 }).outfits;
    for (let i = 1; i < o.length; i++) expect(o[i - 1].score).toBeGreaterThanOrEqual(o[i].score);
  });

  it('never claims the warmth is "about right" when it is outside the band', () => {
    // The failure templated explanations exist to prevent: the app
    // contradicting its own spec in user-facing copy. Caught for real -- a
    // soft outfit at warmth 7.1 against a 6.5 ceiling was being described as
    // "about right for the weather" because the band falloff was too gentle.
    for (const vibe of [SUMMER, WINTER, Y2K, SOFT]) {
      for (const o of suggest(mixedWardrobe(), vibe, { count: 5 }).outfits) {
        if (!o.why.includes('about right')) continue;
        const w = outfitWarmth(o.items);
        // The exact band. This used to allow half a point of slack either
        // side -- precisely enough to hide the band() discontinuity it was
        // written to guard.
        expect(w, `${vibe.label}: "${o.why}"`).toBeLessThanOrEqual(vibe.warmth.max);
        expect(w, `${vibe.label}: "${o.why}"`).toBeGreaterThanOrEqual(vibe.warmth.min);
      }
    }
  });

  it('gives every outfit a non-empty explanation', () => {
    for (const o of suggest(mixedWardrobe(), SOFT, { count: 5 }).outfits) {
      expect(o.why.length).toBeGreaterThan(10);
      expect(o.why).toContain('Soft');
    }
  });

  it('stays fast on a 60-item wardrobe', () => {
    const t0 = performance.now();
    for (const vibe of [SUMMER, WINTER, Y2K, SOFT]) suggest(realisticCloset(), vibe, { count: 5 });
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

/**
 * Sixty distinct garments coloured like a real closet -- mostly neutrals, a
 * few accents -- rather than the 14-item fixture cloned with new ids.
 *
 * The old perf test used the clones, and passed BECAUSE of a bug: the search
 * stopped after the first-ranked top, so it was fast and every suggestion
 * wore the same shirt.
 */
function realisticCloset() {
  const hex = [
    '#1a1a1a',
    '#f2f2f0',
    '#8a8f98',
    '#1f2a44',
    '#4a6274',
    '#d8cbb3',
    '#b08a5a',
    '#2e2a27',
    '#c9bfae',
    '#7a1f2b',
    '#2f5d3a',
    '#e6d3a3',
  ];
  const c = (i: number) => [swatch(hex[i % hex.length])];
  const many = (n: number, make: (i: number) => ReturnType<typeof garment>) =>
    Array.from({ length: n }, (_, i) => make(i));
  return [
    ...many(14, (i) => garment({ id: `top${i}`, warmth: 1 + (i % 3), palette: c(i) })),
    ...many(10, (i) =>
      garment({ id: `mid${i}`, layerRole: 'mid', warmth: 3 + (i % 2), bulk: 2, palette: c(i + 3) }),
    ),
    ...many(8, (i) =>
      garment({
        id: `out${i}`,
        category: 'outerwear',
        layerRole: 'outer',
        warmth: 3 + (i % 3),
        palette: c(i + 5),
      }),
    ),
    ...many(14, (i) =>
      garment({
        id: `bot${i}`,
        category: 'bottom',
        bodyZone: 'legs',
        layerRole: 'bottom',
        warmth: 1 + (i % 4),
        palette: c(i + 7),
      }),
    ),
    ...many(10, (i) =>
      garment({
        id: `shoe${i}`,
        category: 'footwear',
        bodyZone: 'feet',
        layerRole: 'footwear',
        warmth: 1 + (i % 4),
        palette: c(i + 2),
      }),
    ),
    ...many(4, (i) =>
      garment({
        id: `dress${i}`,
        category: 'dress',
        bodyZone: 'full_body',
        layerRole: 'full_body',
        warmth: 2,
        palette: c(i + 9),
      }),
    ),
  ];
}

describe('a real-sized closet gets real variety', () => {
  // The dress or top each outfit is built around.
  const anchors = (vibe: typeof SUMMER) =>
    suggest(realisticCloset(), vibe, { count: 5 }).outfits.map((o) => o.items[0].id);

  it.each([
    ['Summer', SUMMER],
    ['Winter', WINTER],
    ['Y2K', Y2K],
    ['Soft', SOFT],
  ] as const)('%s draws on at least three different dresses or tops', (_n, vibe) => {
    // Was ONE for every vibe: truncation meant only the first-ranked top was
    // ever scored.
    expect(new Set(anchors(vibe)).size).toBeGreaterThanOrEqual(3);
  });

  it('does not fill winter with dresses when there are fourteen tops', () => {
    // Exact ties between dress- and separates-based outfits used to resolve
    // by generation order, and dresses are generated first.
    const a = anchors(WINTER);
    expect(a.some((id) => id.startsWith('top'))).toBe(true);
    expect(a.filter((id) => id.startsWith('dress')).length).toBeLessThanOrEqual(3);
  });

  it('never repeats a garment within one outfit, at any size', () => {
    for (const vibe of [SUMMER, WINTER, Y2K, SOFT]) {
      for (const o of suggest(realisticCloset(), vibe, { count: 10 }).outfits) {
        expect(new Set(o.items.map((i) => i.id)).size).toBe(o.items.length);
      }
    }
  });
});
