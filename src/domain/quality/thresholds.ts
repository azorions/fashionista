/**
 * Every tunable number in the capture pipeline, in one file.
 *
 * ALL OF THESE ARE COLD-START GUESSES. Laplacian variance in particular is
 * notoriously sensitive to resolution, sensor noise and scene content — a flat
 * white t-shirt legitimately has low edge energy and a naive threshold will
 * call it blurry.
 *
 * Two guards make that survivable:
 *   1. Measure sharpness only inside the framing guide (live) and inside the
 *      mask bounding box (server) — background texture is what usually rescues
 *      or ruins the number.
 *   2. The hidden calibration screen logs {metrics, verdict, didUserKeepIt} to
 *      the quality_calibration table from day one. Refit after ~100 real photos.
 *
 * Until then, "Use it anyway" stays on every rejection, so a bad threshold can
 * annoy the user but can never block them.
 */
export const T = {
  live: {
    lumaMin: 60,
    lumaMax: 205,
    clipHighMax: 0.1,
    /** On the 96px sample, which is much noisier than the still. */
    lapVarMin: 25,
    edgeFillMin: 0.45,
    /** Sample rate in Hz. Deliberately low: battery and thermals. */
    hz: 3,
    /** A warning must hold this long before it shows, or it strobes as you move. */
    hysteresisMs: 900,
  },
  still: {
    lumaMin: 55,
    lumaMax: 215,
    lumaGood: [90, 185] as [number, number],
    clipLowMax: 0.12,
    clipHighMax: 0.08,
    /** At a 256px long edge, grayscale 0..255. */
    lapVarReject: 60,
    lapVarGood: 120,
  },
  mask: {
    fgRatioMin: 0.12,
    fgRatioMax: 0.8,
    largestComponentMin: 0.92,
    componentsMax: 3,
    roughnessMax: 3.2,
    uncertainMax: 0.08,
  },
  /** Below this, lead with a retake. */
  GATE_PASS: 60,
  /** At or above this, keep silently. Between the two, mention it once. */
  GATE_GOOD: 78,
} as const;
