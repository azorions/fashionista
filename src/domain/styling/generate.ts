import { isValid, outfitWarmth, structuralViolations, torsoLayers } from './constraints';
import { explain, gapMessage } from './explain';
import { scoreOutfit } from './score';
import type {
  ClosetGap,
  Garment,
  ScoredOutfit,
  SuggestOptions,
  SuggestResult,
  VibeSpec,
} from './types';

/**
 * Turning a closet into outfits.
 *
 * A 60-item wardrobe has roughly 95,000 structurally valid combinations --
 * far too many to score on every refresh. The search is split in two:
 *
 *   1. CORES. Every dress+shoes and every top+bottom+shoes from the per-slot
 *      pools: at most 8x8x8 + 8x8 = 576, all scored.
 *   2. LAYERS. The best three cores for EACH top or dress are extended with
 *      mid and outer layers.
 *
 * The previous version enumerated depth-first under a flat 4,000-combination
 * cap. One top's layered variants cost more than the whole cap, so on a real
 * closet only the first-ranked top was ever scored and every suggestion wore
 * the same shirt. Keeping the best cores per top, rather than the best cores
 * overall, is what guarantees every top a fair hearing.
 *
 * Deterministic, offline, and tens of milliseconds.
 */

/** Per-slot candidate cap for cores. Raising it multiplies work, not quality. */
const POOL = 8;
/** Mid and outer candidates tried when extending a core. */
const EXT_POOL = 5;
/** Cores kept per top or dress for extension. */
const CORES_PER_ANCHOR = 3;
/** No garment (shoes aside) appears in more than this many suggestions, while the closet allows it. */
const MAX_REUSE = 2;

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

/** Slots a garment could fill, honouring altLayerRoles. A flannel is three. */
function slotsOf(g: Garment): Slot[] {
  const primary = slotOf(g);
  if (!primary) return [];
  if (g.bodyZone !== 'torso') return [primary];

  const extra = g.altLayerRoles
    .map((r): Slot | null =>
      r === 'outer' ? 'outer' : r === 'mid' ? 'mid' : r === 'base' ? 'top' : null,
    )
    .filter((s): s is Slot => s !== null);

  return [...new Set([primary, ...extra])];
}

function withoutVetoed(items: Garment[], vibe: VibeSpec, tiers: ('H1' | 'H2')[]): Garment[] {
  return items.filter((g) => !(vibe.veto ?? []).some((v) => tiers.includes(v.tier) && v.test(g)));
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

/**
 * A locked garment FILLS its slot.
 *
 * The old code removed locked items from the pools and prepended them to every
 * combination, so locking the only pair of shoes emptied the shoe pool and
 * returned zero outfits, locking a dress disabled the dress route entirely,
 * and locking a top produced outfits with two tops.
 */
type Pick = (slot: Slot) => Garment[];

function picker(p: Record<Slot, Garment[]>, locked: Garment[]): Pick {
  const fixed: Partial<Record<Slot, Garment>> = {};
  for (const g of locked) {
    const s = slotOf(g);
    if (s && !fixed[s]) fixed[s] = g;
  }
  const lockedIds = new Set(locked.map((g) => g.id));
  return (slot) => {
    const f = fixed[slot];
    if (f) return [f];
    // A locked garment must not ALSO turn up in a slot it can play secondarily.
    return p[slot].filter((g) => !lockedIds.has(g.id));
  };
}

/** Stage 1: every dress+shoes and top+bottom+shoes. */
function* cores(pick: Pick, locked: Garment[]): Generator<Garment[]> {
  const lockedSlots = new Set(locked.map(slotOf));
  const shoes = pick('shoes');

  // A locked top or bottom rules the dress route out; a locked dress rules
  // the top route out. Otherwise both are open.
  if (!lockedSlots.has('top') && !lockedSlots.has('bottom')) {
    for (const d of pick('dress')) for (const s of shoes) yield [d, s];
  }
  if (!lockedSlots.has('dress')) {
    for (const t of pick('top')) {
      for (const b of pick('bottom')) for (const s of shoes) yield [t, b, s];
    }
  }
}

/**
 * Stage 2: layers over a core.
 *
 * A running set of ids already placed replaces the old pairwise `id ===`
 * guards, which missed one pairing: a flannel can play base, mid AND outer,
 * and `[flannel, sweater, flannel, jeans, boots]` came out of the generator
 * -- and scored BETTER than the honest outfit, because the flannel counted as
 * two layers of warmth. It even clashed with itself on pattern.
 */
function* layered(core: Garment[], pick: Pick): Generator<Garment[]> {
  const placed = new Set(core.map((g) => g.id));
  const mids = pick('mid')
    .filter((g) => !placed.has(g.id))
    .slice(0, EXT_POOL);
  const outers = pick('outer')
    .filter((g) => !placed.has(g.id))
    .slice(0, EXT_POOL);

  for (const m of mids) {
    yield [...core, m];
    for (const o of outers) if (o.id !== m.id) yield [...core, m, o];
  }
  for (const o of outers) yield [...core, o];
}

/** The garment an outfit is built around: its dress, or its top. */
const anchorOf = (outfit: Garment[]) => outfit[0].id;

/**
 * Choose which ranked outfits to show.
 *
 * Two rules. The same clothes in different shoes are one suggestion, not two.
 * And while the closet allows it, no garment (shoes aside -- most people own
 * few) appears in more than MAX_REUSE suggestions, so one strong top cannot
 * take every slot. A second pass relaxes the reuse rule, because a small
 * closet genuinely cannot always vary.
 */
function select(ranked: ScoredOutfit[], want: number): ScoredOutfit[] {
  const picked: ScoredOutfit[] = [];
  const clothes = new Set<string>();
  const uses = new Map<string, number>();

  // Dress-based and separates-based outfits often tie exactly, and a tie is
  // settled by generation order -- dresses are generated first -- so a closet
  // with fourteen tops was offered five dresses for winter. While the other
  // route has candidates, neither may take more than half the slots.
  const routeOf = (o: ScoredOutfit) =>
    o.items.some((g) => g.bodyZone === 'full_body') ? 'dress' : 'separates';
  const routes = new Map<string, number>();
  const routeCap = Math.ceil(want / 2);
  const bothRoutes = new Set(ranked.map(routeOf)).size > 1;

  const clothesKey = (o: ScoredOutfit) =>
    o.items
      .filter((g) => g.bodyZone !== 'feet')
      .map((g) => g.id)
      .sort()
      .join('|');
  const overused = (o: ScoredOutfit) =>
    o.items.some((g) => g.bodyZone !== 'feet' && (uses.get(g.id) ?? 0) >= MAX_REUSE) ||
    (bothRoutes && (routes.get(routeOf(o)) ?? 0) >= routeCap);
  const take = (o: ScoredOutfit) => {
    picked.push(o);
    clothes.add(clothesKey(o));
    for (const g of o.items) uses.set(g.id, (uses.get(g.id) ?? 0) + 1);
    routes.set(routeOf(o), (routes.get(routeOf(o)) ?? 0) + 1);
  };

  for (const o of ranked) {
    if (picked.length >= want) break;
    if (!clothes.has(clothesKey(o)) && !overused(o)) take(o);
  }
  for (const o of ranked) {
    if (picked.length >= want) break;
    if (!clothes.has(clothesKey(o))) take(o);
  }
  // The passes decide WHICH outfits to show; they still read best-first. The
  // fill pass used to append its picks after the variety pass, so a 0.93
  // outfit could be listed beneath a 0.71 one.
  return picked.sort((a, b) => b.score - a.score);
}

/**
 * What the closet is missing, for the roles this vibe actually needs.
 *
 * Mid and outer layers only count when the vibe requires layering -- a thin
 * closet asked for "summer" used to be told a missing coat was the problem.
 * And a dress covers both the top and the bottom, so a closet built around
 * dresses is no longer told it has no tops.
 */
function closetGaps(items: Garment[], vibe: VibeSpec): ClosetGap[] {
  const counts: Record<string, number> = { base: 0, bottom: 0, footwear: 0 };
  if (vibe.layers.min >= 2) {
    counts.mid = 0;
    counts.outer = 0;
  }

  for (const g of items) {
    const roles =
      g.layerRole === 'full_body' ? ['base', 'bottom'] : [g.layerRole, ...g.altLayerRoles];
    for (const r of new Set(roles)) if (r in counts) counts[r]++;
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
  options: SuggestOptions = {},
): SuggestResult {
  const want = options.count ?? 5;
  const locked = options.locked ?? [];
  const lockedIds = locked.map((g) => g.id);
  const excluded = new Set(options.exclude ?? []);
  const available = wardrobe.filter((g) => !g.archived && !excluded.has(g.id));

  /*
   * The relaxation ladder. Each rung lifts a tier of vibe vetoes. H0 is never
   * on it: structural rules are not preferences.
   */
  const rungs: { tiers: ('H1' | 'H2')[] }[] = [
    { tiers: ['H1', 'H2'] },
    { tiers: ['H1'] },
    { tiers: [] },
  ];

  /*
   * The layer bounds are a REQUIREMENT of the vibe, not a preference: "summer
   * isn't layered, winter is" is the definition of both. They used to be only
   * scored, and once the variety rule below capped the few winter-suitable
   * pieces, the best outfit that reused nothing was a single-layer summer
   * dress -- which then appeared under "winter". Enforced at H1: held unless
   * the closet genuinely cannot meet it, and captioned when it cannot.
   */
  const layersOk = (items: Garment[]) => {
    const n = torsoLayers(items);
    return n >= vibe.layers.min && n <= vibe.layers.max;
  };

  /*
   * The warmth FLOOR is a requirement too, but deliberately not the ceiling.
   * Too cold is a failure; too warm is a preference -- you can take a layer
   * off, not add one you left at home. Enforcing summer's 3.5 ceiling would
   * ban tee + jeans + sandals (3.7). Enforcing winter's 6.5 floor stops a
   * dress and a denim jacket (5.0) appearing under "winter". Summer's floor is
   * 0, so this changes nothing there.
   */
  const warmEnough = (items: Garment[]) => outfitWarmth(items) >= vibe.warmth.min;
  const fitsVibe = (items: Garment[]) => layersOk(items) && warmEnough(items);

  for (const rung of rungs) {
    const pick = picker(pools(withoutVetoed(available, vibe, rung.tiers), vibe), locked);
    const enforceLayers = rung.tiers.includes('H1');

    // Only rules that were lifted at this rung AND that this outfit actually
    // breaks. The old list was every veto lifted by the tier, whether or not
    // anything in the outfit needed it -- so a perfectly ordinary outfit was
    // captioned "bent a rule to get here".
    const relaxedFor = (items: Garment[]) => {
      const bent = (vibe.veto ?? [])
        .filter((v) => !rung.tiers.includes(v.tier) && items.some(v.test))
        .map((v) => v.describe);
      if (!layersOk(items)) {
        bent.push(
          torsoLayers(items) < vibe.layers.min
            ? 'fewer layers than this usually wants'
            : 'more layers than this usually wants',
        );
      }
      if (!warmEnough(items)) bent.push('cooler than this usually wants');
      return bent;
    };

    const score = (items: Garment[]): ScoredOutfit => {
      const { score: s, terms } = scoreOutfit(items, vibe);
      return { items, score: s, terms, why: '', relaxed: relaxedFor(items) };
    };

    // Stage 1.
    const coreList: ScoredOutfit[] = [];
    for (const c of cores(pick, locked)) if (isValid(c)) coreList.push(score(c));

    // Stage 2, skipped outright when the vibe allows no second layer.
    const layeredList: ScoredOutfit[] = [];
    if (vibe.layers.max > 1) {
      const byAnchor = new Map<string, ScoredOutfit[]>();
      for (const c of coreList) {
        const k = anchorOf(c.items);
        byAnchor.set(k, [...(byAnchor.get(k) ?? []), c]);
      }
      for (const group of byAnchor.values()) {
        group.sort((a, b) => b.score - a.score);
        for (const c of group.slice(0, CORES_PER_ANCHOR)) {
          for (const l of layered(c.items, pick)) if (isValid(l)) layeredList.push(score(l));
        }
      }
    }

    const ranked = [...coreList, ...layeredList]
      .filter((o) => lockedIds.every((id) => o.items.some((g) => g.id === id)))
      .filter((o) => !enforceLayers || fitsVibe(o.items))
      .sort((a, b) => b.score - a.score);
    const chosen = select(ranked, want);

    // Stop at the first rung that yields three. Relaxing further only trades
    // honesty for volume: a closet that can manage three good outfits gets
    // three and a note on what is missing, not five padded out with bent rules.
    if (chosen.length >= Math.min(3, want) || rung === rungs[rungs.length - 1]) {
      return {
        outfits: chosen.map((o) => ({ ...o, why: explain(o.terms, vibe, o.relaxed) })),
        gaps: chosen.length < want ? closetGaps(available, vibe) : [],
      };
    }
  }

  return { outfits: [], gaps: closetGaps(available, vibe) };
}

/** Why a specific combination is not allowed. Used by the outfit canvas. */
export function whyInvalid(items: Garment[]): string[] {
  return structuralViolations(items).map((v) => v.describe);
}
