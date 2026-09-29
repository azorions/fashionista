import type { Term, VibeSpec } from './types';

/**
 * One sentence saying why.
 *
 * Templated from the score decomposition, never generated. There are maybe
 * forty useful things to say about an outfit, and a phrase bank keyed by
 * (term, bucket) covers them at zero cost, instantly, and — the part that
 * matters — with a guarantee it cannot contradict the ranking.
 *
 * A language model asked to explain a suggestion will cheerfully write "the
 * navy grounds the brighter pieces" about an outfit that scored badly on
 * colour. That destroys trust faster than saying nothing at all.
 */

type Bucket = 'great' | 'good' | 'poor';

const bucket = (v: number): Bucket => (v >= 0.8 ? 'great' : v >= 0.55 ? 'good' : 'poor');

const PHRASES: Record<string, Partial<Record<Bucket, (e: Record<string, unknown>) => string>>> = {
  layers: {
    great: (e) =>
      Number(e.layers) <= 1 ? 'a single easy layer' : `${e.layers} layers working together`,
    poor: (e) =>
      Number(e.layers) <= 1
        ? 'only one layer, which is thin for this'
        : 'more layers than this calls for',
  },
  warmth: {
    great: (e) => `about right for the weather at ${e.warmth}/10`,
    good: () => 'roughly the right weight',
    poor: (e) => `${e.warmth}/10 warmth, which is off for this`,
  },
  colour: {
    great: () => 'the colours sit well together',
    good: () => 'the colours get along',
    poor: () => 'the colours fight a little',
  },
  contrast: {
    great: () => 'nothing sharp in it',
    poor: () => 'more contrast than this wants',
  },
  chroma: {
    great: () => 'a muted palette',
    poor: () => 'louder than this usually goes',
  },
  formality: {
    poor: () => 'the register is a bit mixed',
  },
  pattern: {
    poor: () => 'two big patterns is a lot',
  },
  coherence: {
    poor: () => 'the shoes are from a different season',
  },
  preference: {
    great: () => 'the fabrics and shapes are right for it',
  },
};

/** Sentence-case and join with commas and a final "and". */
function join(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function explain(terms: Term[], vibe: VibeSpec, relaxed: string[] = []): string {
  // A signature IS the reason, so lead with every one that fired -- y2k can
  // fire two, and naming only the first dropped half of why it was chosen.
  const signatures = terms
    .filter((t) => t.name === 'signature')
    .map((t) => String(t.evidence?.describe ?? 'a signature look'));

  const ranked = terms
    .filter((t) => t.weight > 0 && PHRASES[t.name])
    .sort((a, b) => b.weight * Math.abs(b.value - 0.6) - a.weight * Math.abs(a.value - 0.6));

  const said: string[] = [];
  said.push(...signatures);

  for (const t of ranked) {
    if (said.length >= 3) break;
    const phrase = PHRASES[t.name]?.[bucket(t.value)];
    if (phrase) said.push(phrase(t.evidence ?? {}));
  }

  const body = said.length ? join(said) : `reads as ${vibe.label.toLowerCase()}`;
  const head = `${vibe.label}: ${body}.`;

  // Say what was bent, always. A suggestion that quietly ignored a rule is
  // how the app loses the benefit of the doubt.
  if (relaxed.length) {
    return `${head} Bent a rule to get here — ${join(relaxed)}.`;
  }
  return head;
}

/**
 * What the closet is missing, phrased as something worth acting on.
 *
 * This is the most useful thing the app can say to someone with twelve items,
 * and it is why the relaxation ladder returns fewer results instead of padding
 * to five with nonsense.
 */
export function gapMessage(role: string, count: number): string {
  const nice: Record<string, string> = {
    base: 'tops',
    mid: 'mid layers like a cardigan or sweater',
    outer: 'outer layers like a jacket or coat',
    bottom: 'bottoms',
    footwear: 'shoes',
  };
  const what = nice[role] ?? `${role} pieces`;
  // Only ever called for roles with zero or one option -- see closetGaps.
  return count === 0
    ? `You have no ${what} yet — that is what is blocking this.`
    : `Only one option for ${what}, so every outfit here repeats it.`;
}
