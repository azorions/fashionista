/**
 * The contract every stage of the capture pipeline speaks.
 *
 * Three metric shapes, because three different things are knowable at three
 * different moments:
 *   - LiveMetrics   from a 96x96 preview sample, before the shutter
 *   - StillMetrics  from the full capture, on-device, before upload
 *   - MaskMetrics   only once an alpha channel exists, so only server-side
 */

export type CaptureIssue =
  // from RGB pixels alone
  | 'too_dark'
  | 'too_bright'
  | 'clipped'
  | 'blurry'
  | 'too_small'
  | 'too_large'
  // only decidable once the cutout has produced an alpha channel
  | 'mask_fragmented'
  | 'mask_empty'
  | 'mask_ragged'
  | 'mask_uncertain';

/** Cheap metrics from a 96x96 live preview sample, computed at ~3 Hz. */
export interface LiveMetrics {
  /** Rec.709 luma mean, 0..255. */
  luma: number;
  /** Fraction of pixels crushed to black (Y < 8). */
  clipLow: number;
  /** Fraction of pixels blown to white (Y > 247). */
  clipHigh: number;
  /** Variance of the 3x3 Laplacian. Normalised to a 96px long edge. */
  lapVar: number;
  /** 0..1 share of total edge energy falling inside the framing guide. */
  edgeFill: number;
}

/** Metrics from the full still, always measured at a 256px long edge. */
export interface StillMetrics {
  width: number;
  height: number;
  luma: number;
  clipLow: number;
  clipHigh: number;
  /** Variance of the 3x3 Laplacian. Normalised to a 256px long edge. */
  lapVar: number;
  /** Per-channel means. A large spread implies a colour cast to correct. */
  colorCast: { r: number; g: number; b: number };
}

/** Metrics only computable once an alpha channel exists (server-side). */
export interface MaskMetrics {
  /** Foreground pixels (alpha > 0.5) as a fraction of the whole frame. */
  fgRatio: number;
  /** 0..1 share of foreground held by the single largest blob. */
  largestComponent: number;
  /** Count of blobs holding at least 0.5% of the foreground. */
  components: number;
  /** perimeter / (2*sqrt(pi*area)). 1.0 is a perfect circle; higher is raggeder. */
  roughness: number;
  /** Fraction of pixels with a genuinely ambiguous alpha (0.15..0.85). */
  uncertain: number;
  /** Garment bounding box, normalised 0..1. */
  bbox: { x: number; y: number; w: number; h: number };
}

export interface QualityVerdict {
  /** 0..100. */
  score: number;
  /** score >= GATE_PASS — good enough to keep without comment. */
  pass: boolean;
  /** Passed, but worth offering a retake. */
  warn: boolean;
  issues: CaptureIssue[];
  /** What the retake sheet leads with. Highest-priority issue, if any. */
  primaryIssue?: CaptureIssue;
}
