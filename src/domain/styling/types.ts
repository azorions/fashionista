import type { Swatch } from '../color/palette';
import type { GarmentTags, LayerRole } from '../tagging/schema';

/**
 * The styling engine's view of a garment.
 *
 * Extends GarmentTags rather than restating it, so the engine and the tagger
 * can never drift apart — adding a field to the schema makes it available here
 * for free, and removing one breaks the compile instead of the runtime.
 *
 * The database row type must structurally satisfy this. That assertion is the
 * whole reason this file exists in milestone 1 with no implementation behind
 * it: a compile error now is cheaper than a migration later.
 */
export interface Garment extends GarmentTags {
  id: string;

  /**
   * Dominant colours in OKLCh, extracted from cutout-masked pixels only.
   *
   * The one attribute that cannot be backfilled: it needs the alpha mask, and
   * clustering background pixels in makes every garment's colour the colour of
   * the floor. See src/domain/color/palette.ts.
   */
  palette: Swatch[];

  /** Per-attribute confidence, 0..1. Absent means "asserted by the user". */
  confidence?: Partial<Record<keyof GarmentTags, number>>;

  lastWornAt?: string | null;
  timesWorn?: number;
  archived?: boolean;
}

/** An outfit under construction or under evaluation. */
export interface Outfit {
  items: Garment[];
}

/**
 * One term of a score, kept separate rather than summed early.
 *
 * Explanations are templated from this decomposition, never generated, so the
 * sentence the user reads is by construction consistent with the ranking. A
 * generated explanation will happily praise the colour harmony of an outfit
 * that scored badly on colour, which destroys trust faster than silence.
 */
export interface Term {
  name: string;
  /** Raw 0..1 quality for this dimension. */
  value: number;
  /** Multiplier applied when summing. */
  weight: number;
  /** Whatever the explanation template needs to fill its slots. */
  evidence?: Record<string, unknown>;
}

export interface ScoredOutfit {
  items: Garment[];
  /** Base in [0, 1], plus any signature bonuses -- so the best can exceed 1. Ranking only. */
  score: number;
  terms: Term[];
  /** One human sentence, templated from `terms`. */
  why: string;
  /** Constraints relaxed to produce this, if any. Surfaced to the user verbatim. */
  relaxed: string[];
}

/** Constraint tiers. H0 is never relaxed; H1 then H2 give way under scarcity. */
export type ConstraintTier = 'H0' | 'H1' | 'H2';

export interface Constraint {
  id: string;
  tier: ConstraintTier;
  /** Human phrasing used when this constraint is reported as relaxed. */
  describe: string;
  test: (items: Garment[]) => boolean;
}

/**
 * A vibe, as a machine-readable object rather than a prompt.
 *
 * Written to be legible to a non-programmer, because "y2k" means materially
 * different things to different people and the spec is what settles which one
 * this app means.
 */
export interface VibeSpec {
  id: string;
  label: string;

  /** Torso layers this vibe wants. "summer = not layered" lives here. */
  layers: { min: number; max: number; ideal: number };
  /** Summed outfit warmth, diminishing-returns formula. */
  /**
   * `ideal` is optional because not every vibe has a peak. Without one, the
   * whole band scores 1 -- "warm enough" is a floor, not a target.
   */
  warmth: { min: number; max: number; ideal?: number };
  formality: { min: number; max: number };

  /** Preferred OKLCh chroma and lightness bands. Soft is low chroma, low contrast. */
  chroma?: { min: number; max: number };
  lightness?: { min: number; max: number };
  /** Max perceptual lightness spread across the outfit. Low means "quiet". */
  maxContrast?: number;

  /** Additive nudges, not requirements. */
  prefer?: Partial<{
    silhouettes: Garment['silhouette'][];
    materials: Garment['materials'];
    patterns: Garment['pattern'][];
    sheens: Garment['sheen'][];
    rises: Garment['rise'][];
    lengths: Garment['length'][];
  }>;

  /** Hard exclusions at the stated tier. Summer vetoing heavy outerwear is H1. */
  veto?: { tier: Exclude<ConstraintTier, 'H0'>; describe: string; test: (g: Garment) => boolean }[];

  /**
   * Combinations that make an outfit unmistakably THIS vibe.
   *
   * Preferences nudge; a signature is the thing itself. Low rise plus a crop
   * top is not "somewhat y2k", it is the defining pair, and scoring each
   * attribute separately would never find it.
   */
  signature?: { describe: string; bonus: number; test: (items: Garment[]) => boolean }[];

  /** Style-tag affinities, scored as a weighted dot product against the item's tags. */
  tagWeights?: Partial<Record<GarmentTags['styleTags'][number]['tag'], number>>;
}

export interface SuggestOptions {
  count?: number;
  /** Items the user has pinned into the outfit; generation works around them. */
  locked?: Garment[];
  exclude?: string[];
}

/** Which slot ran out first, so the app can say something useful about a thin closet. */
export interface ClosetGap {
  role: LayerRole;
  message: string;
}

export interface SuggestResult {
  outfits: ScoredOutfit[];
  /** Populated when the relaxation ladder could not reach `count`. */
  gaps: ClosetGap[];
}
