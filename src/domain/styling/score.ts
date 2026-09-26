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

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 1.0 inside [min,max] with a peak at `ideal`, falling off outside.
 *
 * The falloff is scaled to HALF THE BAND WIDTH, not to the bound itself.
 * Scaling by the bound made leaving a wide band nearly free: a soft outfit at
 * warmth 7.1 against a 6.5 ceiling still scored 0.91, which the explanation
 * layer then rendered as "about right for the weather" — the app contradicting
 * its own spec in user-facing copy. Templated explanations only stay honest if
 * the buckets underneath them are.
 */
function band(value: number, min: number, max: number, ideal?: number): number {
  const scale = Math.max(1, (max - min) / 2);
  if (value < min) return clamp01(1 - (min - value) / scale);
  if (value > max) return clamp01(1 - (value - max) / scale);
  if (ideal === undefined) return 1;
  const reach = Math.max(ideal - min, max - ideal) || 1;
  return clamp01(1 - Math.abs(value - ideal) / reach / 2);
}

/** Share of items matching a preference list. Absent list means "no opinion". */
function preferenceHit<T>(items: Garment[], list: T[] | undefined, pick: (g: Garment) => T | T[]): number | null {
  if (!list || list.length === 0) return null;
  let hits = 0;
  for (const g of items) {
    const v = pick(g);
    const arr = Array.isArray(v) ? v : [v];
    if (arr.some((x) => (list as unknown[]).includes(x))) hits++;
  }
  return items.length ? hits / items.length : 0;
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
    preferenceHit(items, vibe.prefer?.rises, (g) => g.rise),
    preferenceHit(items, vibe.prefer?.lengths, (g) => g.length),
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

  return { score: clamp01(score), terms };
}
