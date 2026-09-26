import { create } from 'zustand';

import type { QualityVerdict, StillMetrics } from '@/domain/quality/types';

/**
 * The in-flight capture, between the camera, the review screen and the tag form.
 *
 * A store rather than route params because file URIs are long and get lost on
 * a fast-refresh reload mid-flow, which is exactly when you are iterating on
 * these screens.
 *
 * One store, not two. The outfit canvas is local state inside a single screen
 * and does not need to be hoisted anywhere.
 */
interface CaptureState {
  localUri: string | null;
  metrics: StillMetrics | null;
  verdict: QualityVerdict | null;

  /** Set once the row exists, so a retake knows what to clean up. */
  itemId: string | null;
  imageId: string | null;
  tileUrl: string | null;
  maskVerdict: QualityVerdict | null;

  shot: (localUri: string, metrics: StillMetrics, verdict: QualityVerdict) => void;
  started: (itemId: string, imageId: string) => void;
  processed: (tileUrl: string, maskVerdict: QualityVerdict) => void;
  reset: () => void;
}

const empty = {
  localUri: null,
  metrics: null,
  verdict: null,
  itemId: null,
  imageId: null,
  tileUrl: null,
  maskVerdict: null,
};

export const useCaptureStore = create<CaptureState>((set) => ({
  ...empty,
  shot: (localUri, metrics, verdict) => set({ ...empty, localUri, metrics, verdict }),
  started: (itemId, imageId) => set({ itemId, imageId }),
  processed: (tileUrl, maskVerdict) => set({ tileUrl, maskVerdict }),
  reset: () => set(empty),
}));
