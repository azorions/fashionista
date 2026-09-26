import { isValid, structuralViolations } from './constraints';
import { explain, gapMessage } from './explain';
import { scoreOutfit } from './score';
import type { ClosetGap, Garment, ScoredOutfit, SuggestOptions, SuggestResult, VibeSpec } from './types';

/**
 * Turning a closet into outfits.
 *
 * A 60-item wardrobe has roughly 95,000 structurally valid combinations, and
 * scoring all of them with every term would be tens of millions of float ops
 * — several hundred milliseconds in Hermes, for an interaction that should
 * feel instant. Two things fix that, in this order:
 *
 *   1. Filter per slot BEFORE combining. A summer vibe throws out every
 *      warmth-4 garment up front, so the combinatorial explosion never
 *      happens on items that were going to score zero.
 *   2. Cap the per-slot candidate pool. Beyond a handful of options per slot,
 *      extra combinations are near-duplicates that add nothing a human would
 *      notice.
 *
 * The result is tens of milliseconds, deterministic, and offline.
 */

/** Per-slot cap. Raising this multiplies the search space, not the quality. */
const POOL = 8;
const MAX_COMBINATIONS = 4000;

type Slot = 'top' | 'mid' | 'outer' | 'bottom' | 'dress' | 'shoes';

function slotOf(g: Garment): Slot | null {
  if (g.bodyZone === 'feet') return 'shoes';
  if (g.bodyZone === 'full_body') return 'dress';
  if (g.bodyZone === 'legs') return 'bottom';
  if (g.bodyZone === 'torso') {
    if (g.layerRole === 'outer') return 'outer';
    if (g.layerRole === 'mid') return 'mid';
    if (g.layerRole === 'base') return 'top';
  }
  return null;
}

/** Slots a garment could fill, honouring altLayerRoles. A flannel is two slots. */
function slotsOf(g: Garment): Slot[] {
  const primary = slotOf(g);
  if (!primary) return [];
  if (g.bodyZone !== 'torso') return [primary];

  const extra = g.altLayerRoles
    .map((r): Slot | null => (r === 'outer' ? 'outer' : r === 'mid' ? 'mid' : r === 'base' ? 'top' : null))
    .filter((s): s is Slot => s !== null);

  return [...new Set([primary, ...extra])];
}

interface Vetoed {
  kept: Garment[];
  /** Describes of vetoes that removed something, so relaxing can report them. */
  applied: string[];
}

function applyVetoes(items: Garment[], vibe: VibeSpec, tiers: ('H1' | 'H2')[]): Vetoed {
  const applied = new Set<string>();
  const kept = items.filter((g) => {
    for (const v of vibe.veto ?? []) {
      if (!tiers.includes(v.tier)) continue;
      if (v.test(g)) {
        applied.add(v.describe);
        return false;
      }
    }
    return true;
  });
  return { kept, applied: [...applied] };
}

function pools(items: Garment[], vibe: VibeSpec): Record<Slot, Garment[]> {
  const out: Record<Slot, Garment[]> = {
    top: [],
    mid: [],
    outer: [],
    bottom: [],
    dress: [],
    shoes: [],
  };
  for (const g of items) for (const s of slotsOf(g)) out[s].push(g);

  // Rank each pool by how well the garment alone fits the vibe, then cap.
  // Solo-scoring is crude, but it is only deciding what gets CONSIDERED.
  for (const slot of Object.keys(out) as Slot[]) {
    out[slot] = out[slot]
      .map((g) => ({ g, s: soloAffinity(g, vibe) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, POOL)
      .map((x) => x.g);
  }
  return out;
}

/** Cheap single-garment fit, used only for pruning. */
function soloAffinity(g: Garment, vibe: VibeSpec): number {
  let s = 0.5;
  if (g.warmth >= vibe.warmth.min / 2 && g.warmth <= vibe.warmth.max) s += 0.2;
  if (g.formality >= vibe.formality.min && g.formality <= vibe.formality.max) s += 0.1;
  const p = vibe.prefer;
  if (p?.materials?.some((m) => g.materials.includes(m))) s += 0.15;
  if (p?.silhouettes?.includes(g.silhouette)) s += 0.1;
  if (p?.rises?.includes(g.rise)) s += 0.15;
  if (p?.lengths?.includes(g.length)) s += 0.1;
  if (p?.sheens?.includes(g.sheen)) s += 0.05;
  for (const [tag, w] of Object.entries(vibe.tagWeights ?? {})) {
    const t = g.styleTags.find((x) => x.tag === tag);
    if (t) s += (w ?? 0) * t.weight * 0.3;
  }
  return s;
}

/** Enumerate structurally valid combinations from the pools. */
function* combinations(p: Record<Slot, Garment[]>, locked: Garment[]): Generator<Garment[]> {
  const lockedIds = new Set(locked.map((l) => l.id));
  const free = (list: Garment[]) => list.filter((g) => !lockedIds.has(g.id));

  const shoes = free(p.shoes);
  if (!shoes.length) return;

  // Route A: dress (+ optional outer). A dress is the top and the bottom.
  for (const dress of free(p.dress)) {
    for (const shoe of shoes) {
      yield [...locked, dress, shoe];
      for (const outer of free(p.outer)) yield [...locked, dress, outer, shoe];
    }
  }

  // Route B: top + bottom, with optional mid and outer layers.
  for (const top of free(p.top)) {
    for (const bottom of free(p.bottom)) {
      for (const shoe of shoes) {
        yield [...locked, top, bottom, shoe];
        for (const mid of free(p.mid)) {
          if (mid.id === top.id) continue;
          yield [...locked, top, mid, bottom, shoe];
          for (const outer of free(p.outer)) {
            if (outer.id === mid.id) continue;
            yield [...locked, top, mid, outer, bottom, shoe];
          }
        }
        for (const outer of free(p.outer)) {
          if (outer.id === top.id) continue;
          yield [...locked, top, outer, bottom, shoe];
        }
      }
    }
  }
}

/** Two outfits sharing everything but the shoes are one suggestion, not two. */
function distinct(outfits: ScoredOutfit[], want: number): ScoredOutfit[] {
  const picked: ScoredOutfit[] = [];
  for (const o of outfits) {
    const ids = new Set(o.items.map((i) => i.id));
    const tooSimilar = picked.some((p) => {
      const shared = p.items.filter((i) => ids.has(i.id)).length;
      return shared >= Math.max(p.items.length, o.items.length) - 1;
    });
    if (!tooSimilar) picked.push(o);
    if (picked.length >= want) break;
  }
  return picked;
}

function closetGaps(items: Garment[]): ClosetGap[] {
  const counts = { base: 0, mid: 0, outer: 0, bottom: 0, footwear: 0 };
  for (const g of items) {
    for (const r of [g.layerRole, ...g.altLayerRoles]) {
      if (r in counts) counts[r as keyof typeof counts]++;
    }
  }
  return Object.entries(counts)
    .filter(([, n]) => n <= 1)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([role, n]) => ({ role: role as ClosetGap['role'], message: gapMessage(role, n) }));
}

/**
 * Suggest outfits for a vibe.
 *
 * Synchronous and pure: no I/O, no async, no network. Call it in a useMemo.
 * At these sizes it does not need a worker.
 */
export function suggest(
  wardrobe: Garment[],
  vibe: VibeSpec,
  options: SuggestOptions = {}
): SuggestResult {
  const want = options.count ?? 5;
  const excluded = new Set(options.exclude ?? []);
  const available = wardrobe.filter((g) => !g.archived && !excluded.has(g.id));

  /*
   * The relaxation ladder. Each rung drops a tier of vibe vetoes and records
   * what it dropped, so a thin closet gets fewer HONEST outfits with a caption
   * rather than five padded ones. H0 is never in this list: structural rules
   * are not preferences.
   */
  const rungs: { tiers: ('H1' | 'H2')[] }[] = [
    { tiers: ['H1', 'H2'] },
    { tiers: ['H1'] },
    { tiers: [] },
  ];

  for (const rung of rungs) {
    const { kept, applied } = applyVetoes(available, vibe, rung.tiers);
    const dropped = (vibe.veto ?? [])
      .filter((v) => !rung.tiers.includes(v.tier))
      .map((v) => v.describe);

    const p = pools(kept, vibe);
    const scored: ScoredOutfit[] = [];
    let seen = 0;

    for (const combo of combinations(p, options.locked ?? [])) {
      if (++seen > MAX_COMBINATIONS) break;
      if (!isValid(combo)) continue;

      const { score, terms } = scoreOutfit(combo, vibe);
      scored.push({ items: combo, score, terms, why: '', relaxed: dropped });
    }

    scored.sort((a, b) => b.score - a.score);
    const chosen = distinct(scored, want);

    // Stop at the first rung that produces a decent set. Only keep relaxing
    // if we genuinely cannot fill the request.
    if (chosen.length >= Math.min(3, want) || rung === rungs[rungs.length - 1]) {
      return {
        outfits: chosen.map((o) => ({ ...o, why: explain(o.terms, vibe, o.relaxed) })),
        gaps: chosen.length < want ? closetGaps(available) : [],
      };
    }
    void applied;
  }

  return { outfits: [], gaps: closetGaps(available) };
}

/** Why a specific combination is not allowed. Used by the outfit canvas. */
export function whyInvalid(items: Garment[]): string[] {
  return structuralViolations(items).map((v) => v.describe);
}
