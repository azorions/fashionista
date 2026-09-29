import { clamp01 } from '../color/oklab';
import { lightnessSpread, meanChroma, outfitHarmony } from './color';
import { outfitFormality, outfitWarmth, patternClash, torsoLayers } from './constraints';
import type { Garment, Term, VibeSpec } from './types';

/**
 * How well does this outfit express this vibe?
 *
 * The score is kept as a LIST of terms rather than a number, and only summed
 * at the end. That is not bookkeeping: the explanation is templated from the
 * decomposition, so the sentence shown to the user is by construction
 * consistent with the ranking. A generated explanation would happily praise
 * the colour harmony of an outfit that scored badly on colour.
 */

/**
 * 1.0 at `ideal` -- or anywhere inside the band when there is no ideal --
 * falling away from it, and CONTINUOUS at both bounds.
 *
 * The previous version scaled its inside and outside branches by unrelated
 * denominators, so the curve jumped UPWARD at each bound: a soft outfit at
 * warmth 6.5 (the legal ceiling) scored 0.500, and at 6.6 (over it) scored
 * 0.956. Leaving the band paid. That bug was introduced while fixing a
 * different one in this same function, which is why it now has a property
 * test rather than a spot check.
 *
 * Outside the band the score keeps falling from wherever the edge left it, at
 * twice the inside slope, scaled by the band's own geometry. There is no floor
 * of 1 any more: that made narrow bands such as chroma (0..0.1) nearly inert.
 *
 * Exported only so the property test can reach it.
 */
export function band(value: number, min: number, max: number, ideal?: number): number {
  // With no ideal the band is flat, and falling to zero half a band-width
  // past an edge is the tolerance. A full width made falling short far too
  // cheap: winter (6.5..10) still gave a warmth-5.0 outfit 0.57, and a dress
  // with a denim jacket turned up under "winter".
  const reach =
    ideal === undefined
      ? Math.max((max - min) / 2, Number.EPSILON)
      : Math.max(ideal - min, max - ideal, Number.EPSILON);
  const inside = (v: number) => (ideal === undefined ? 1 : 1 - Math.abs(v - ideal) / reach / 2);

  if (value >= min && value <= max) return clamp01(inside(value));
  const edge = value < min ? min : max;
  return clamp01(inside(edge) - Math.abs(value - edge) / reach);
}

/**
 * Share of the items a preference APPLIES to that match it. Absent list, or
 * nothing it applies to, means "no opinion".
 *
 * Dividing by every item capped zone-specific preferences: only a bottom has a
 * rise, so a perfect low-rise outfit scored rise 1/3 or 1/5, and the "fabrics
 * and shapes are right for it" line could essentially never be said.
 */
function preferenceHit<T>(
  items: Garment[],
  list: T[] | undefined,
  pick: (g: Garment) => T | T[],
  applies: (g: Garment) => boolean = () => true
): number | null {
  if (!list || list.length === 0) return null;
  const relevant = items.filter(applies);
  if (!relevant.length) return null;
  let hits = 0;
  for (const g of relevant) {
    const v = pick(g);
    const arr = Array.isArray(v) ? v : [v];
    if (arr.some((x) => (list as unknown[]).includes(x))) hits++;
  }
  return hits / relevant.length;
}

/**
 * Attribute confidence gates influence, it does not veto.
 *
 * A garment tagged with 0.4 confidence on warmth should pull the score around
 * less than one the user confirmed by hand — but it should never be excluded,
 * because a low-confidence guess is still usually right.
 */
function confidenceFactor(items: Garment[], attr: keyof Garment): number {
  const scores = items
    .map((g) => g.confidence?.[attr as keyof NonNullable<Garment['confidence']>])
    .filter((c): c is number => typeof c === 'number');
  if (!scores.length) return 1; // user-asserted
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return mean < 0.6 ? 0.5 : 1;
}

export const WEIGHTS = {
  layers: 1.6,
  warmth: 1.6,
  colour: 1.3,
  formality: 0.8,
  preference: 0.8,
  tags: 0.7,
  pattern: 0.5,
  contrast: 0.6,
} as const;

export function scoreOutfit(items: Garment[], vibe: VibeSpec): { score: number; terms: Term[] } {
  const terms: Term[] = [];
  const palettes = items.map((i) => i.palette);

  const layers = torsoLayers(items);
  terms.push({
    name: 'layers',
    value: band(layers, vibe.layers.min, vibe.layers.max, vibe.layers.ideal),
    weight: WEIGHTS.layers,
    evidence: { layers, want: vibe.layers },
  });

  const warmth = outfitWarmth(items);
  terms.push({
    name: 'warmth',
    value: band(warmth, vibe.warmth.min, vibe.warmth.max, vibe.warmth.ideal),
    weight: WEIGHTS.warmth * confidenceFactor(items, 'warmth'),
    evidence: { warmth: Math.round(warmth * 10) / 10, want: vibe.warmth },
  });

  terms.push({
    name: 'colour',
    value: outfitHarmony(palettes),
    weight: WEIGHTS.colour,
    evidence: {},
  });

  const formality = outfitFormality(items);
  terms.push({
    name: 'formality',
    value: band(formality, vibe.formality.min, vibe.formality.max),
    weight: WEIGHTS.formality,
    evidence: { formality: Math.round(formality * 10) / 10 },
  });

  // Contrast and chroma only score when the vibe has an opinion about them.
  if (vibe.maxContrast !== undefined) {
    const spread = lightnessSpread(palettes);
    terms.push({
      name: 'contrast',
      value: clamp01(1 - Math.max(0, spread - vibe.maxContrast) / 0.4),
      weight: WEIGHTS.contrast,
      evidence: { spread: Math.round(spread * 100) / 100 },
    });
  }
  if (vibe.chroma) {
    const c = meanChroma(palettes);
    terms.push({
      name: 'chroma',
      value: band(c, vibe.chroma.min, vibe.chroma.max),
      weight: WEIGHTS.contrast,
      evidence: { chroma: Math.round(c * 1000) / 1000 },
    });
  }

  const prefs = [
    preferenceHit(items, vibe.prefer?.materials, (g) => g.materials),
    preferenceHit(items, vibe.prefer?.silhouettes, (g) => g.silhouette),
    preferenceHit(items, vibe.prefer?.sheens, (g) => g.sheen),
    preferenceHit(items, vibe.prefer?.rises, (g) => g.rise, (g) => g.rise !== 'n_a'),
    preferenceHit(items, vibe.prefer?.lengths, (g) => g.length, (g) => g.length !== 'n_a'),
    preferenceHit(items, vibe.prefer?.patterns, (g) => g.pattern),
  ].filter((v): v is number => v !== null);

  if (prefs.length) {
    terms.push({
      name: 'preference',
      // Not a mean over items: matching ANY preference strongly is worth more
      // than matching all of them weakly, which is how style actually works.
      value: clamp01(Math.max(...prefs) * 0.7 + (prefs.reduce((a, b) => a + b, 0) / prefs.length) * 0.3),
      weight: WEIGHTS.preference,
      evidence: {},
    });
  }

  if (vibe.tagWeights) {
    let dot = 0;
    let norm = 0;
    for (const [tag, w] of Object.entries(vibe.tagWeights)) {
      norm += w ?? 0;
      for (const g of items) {
        const t = g.styleTags.find((s) => s.tag === tag);
        if (t) dot += (w ?? 0) * t.weight;
      }
    }
    terms.push({
      name: 'tags',
      value: norm ? clamp01(dot / (norm * Math.max(1, items.length * 0.5))) : 0.5,
      weight: WEIGHTS.tags,
      evidence: {},
    });
  }

  terms.push({
    name: 'pattern',
    value: patternClash(items) ? 0.2 : 1,
    weight: WEIGHTS.pattern,
    evidence: { clash: patternClash(items) },
  });

  const total = terms.reduce((a, t) => a + t.value * t.weight, 0);
  const maxTotal = terms.reduce((a, t) => a + t.weight, 0);
  let score = maxTotal ? total / maxTotal : 0;

  // Signatures are additive on top, because they are the difference between
  // "consistent with the vibe" and "unmistakably the vibe".
  for (const sig of vibe.signature ?? []) {
    if (sig.test(items)) {
      score += sig.bonus;
      terms.push({ name: 'signature', value: 1, weight: 0, evidence: { describe: sig.describe } });
    }
  }

  // Deliberately NOT clamped to 1. Every term is already clamped, so the base
  // is in [0, 1]; only a signature bonus can lift the total past it. Clamping
  // flattened every top outfit to exactly 1.000 -- three of five winter
  // suggestions tied -- and a tie is then settled by generation order, which
  // is arbitrary. The total is only ever used to rank; nothing displays it.
  return { score, terms };
}
