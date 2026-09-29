import { useDeferredValue, useMemo } from 'react';

import { suggest } from '@/domain/styling/generate';
import type { Garment } from '@/domain/styling/types';
import { VIBES } from '@/domain/styling/vibes';

/**
 * Outfits for a vibe, computed off the urgent path.
 *
 * suggest() takes ~40ms in Node and several times that on Hermes. Run on the
 * tap itself, the chip would not highlight until the whole search finished.
 * Deferring the vibe lets the chip repaint first, with the old outfits shown
 * (and marked pending) until the new ones are ready.
 *
 * vibeId must be a key of VIBES; the panel checks it once, at the edge.
 */
export function useSuggestions(wardrobe: Garment[], vibeId: string, lockedId?: string | null) {
  const deferredVibe = useDeferredValue(vibeId);

  const { result, locked } = useMemo(() => {
    // 'unknown' is what an untagged capture is saved as: no real layer role or
    // warmth to reason about yet.
    const usable = wardrobe.filter((g) => g.subcategory !== 'unknown');
    // A lock on a garment that is not usable is ignored rather than returning
    // nothing: it only arrives through a URL param.
    const locked = usable.find((g) => g.id === lockedId) ?? null;
    const result = suggest(usable, VIBES[deferredVibe], {
      count: 5,
      locked: locked ? [locked] : [],
    });
    return { result, locked };
  }, [wardrobe, deferredVibe, lockedId]);

  return {
    result,
    /** The vibe `result` was made for. Lags the vibe asked for while pending. */
    resultVibe: deferredVibe,
    pending: vibeId !== deferredVibe,
    /** The garment actually locked, or null when the lock was ignored. */
    locked,
  };
}
