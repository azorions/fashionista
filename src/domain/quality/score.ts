/**
 * Turning metrics into a verdict, and a verdict into something worth saying.
 *
 * Deliberately piecewise-linear and weighted rather than clever: when a photo
 * gets rejected you need to be able to read the numbers and see why, because
 * every threshold in here is going to be re-tuned against real data.
 */

import { T } from './thresholds';
import type { CaptureIssue, LiveMetrics, MaskMetrics, QualityVerdict, StillMetrics } from './types';

/** Clamped linear ramp from `bad` (0) to `good` (1). Works in either direction. */
function ramp(v: number, bad: number, good: number): number {
  if (bad === good) return v >= good ? 1 : 0;
  return Math.max(0, Math.min(1, (v - bad) / (good - bad)));
}

/**
 * Which issue the retake sheet leads with. Ordering is about what the user can
 * actually act on: turning a light on is easy and fixes the most, so darkness
 * outranks blur even though blur usually scores worse.
 */
const ISSUE_PRIORITY: CaptureIssue[] = [
  'mask_empty',
  'too_dark',
  'too_small',
  'blurry',
  'mask_fragmented',
  'mask_uncertain',
  'mask_ragged',
  'clipped',
  'too_bright',
  'too_large',
];

export function primaryIssue(issues: CaptureIssue[]): CaptureIssue | undefined {
  for (const candidate of ISSUE_PRIORITY) {
    if (issues.includes(candidate)) return candidate;
  }
  return issues[0];
}

/**
 * Post-shutter, pre-upload. Rejecting here saves an upload and an inference
 * call, and gets the user back to the camera in ~200ms with the garment still
 * in their hands.
 */
export function scoreCapture(m: StillMetrics): QualityVerdict {
  const issues: CaptureIssue[] = [];

  const sharp = ramp(m.lapVar, T.still.lapVarReject, T.still.lapVarGood);
  if (m.lapVar < T.still.lapVarReject) issues.push('blurry');

  let expo = 1;
  if (m.luma < T.still.lumaGood[0]) {
    expo = ramp(m.luma, T.still.lumaMin, T.still.lumaGood[0]);
  } else if (m.luma > T.still.lumaGood[1]) {
    // Ramp downward by negating both ends, so the same helper works.
    expo = ramp(-m.luma, -T.still.lumaMax, -T.still.lumaGood[1]);
  }
  if (m.luma < T.still.lumaMin) issues.push('too_dark');
  if (m.luma > T.still.lumaMax) issues.push('too_bright');

  const clipPenalty = (m.clipLow / T.still.clipLowMax + m.clipHigh / T.still.clipHighMax) / 2;
  const clip = 1 - Math.min(1, clipPenalty);
  if (m.clipLow > T.still.clipLowMax || m.clipHigh > T.still.clipHighMax) issues.push('clipped');

  const score = Math.round(100 * (0.55 * sharp + 0.3 * expo + 0.15 * clip));

  return {
    score,
    pass: score >= T.GATE_PASS,
    warn: score >= T.GATE_PASS && score < T.GATE_GOOD,
    issues,
    primaryIssue: primaryIssue(issues),
  };
}

/**
 * Pre-shutter, from a 96x96 preview sample at 3 Hz.
 *
 * Returns issues only — no score. A live banner is advice, not a verdict, and
 * the caller applies hysteresis (T.live.hysteresisMs) before showing anything,
 * or the warning strobes while the user is still moving the phone.
 */
export function scorePreview(m: LiveMetrics): CaptureIssue[] {
  const issues: CaptureIssue[] = [];
  if (m.luma < T.live.lumaMin) issues.push('too_dark');
  if (m.luma > T.live.lumaMax) issues.push('too_bright');
  if (m.clipHigh > T.live.clipHighMax) issues.push('clipped');
  if (m.lapVar < T.live.lapVarMin) issues.push('blurry');
  if (m.edgeFill < T.live.edgeFillMin) issues.push('too_small');
  return issues;
}

/**
 * Only `too_dark` and `too_small` block the shutter.
 *
 * Blur is warn-only on purpose: the preview and the actual capture use
 * different exposures, so a preview that looks soft very often resolves into a
 * sharp still. Blocking on it would stop people taking perfectly good photos.
 */
export function blocksShutter(issues: CaptureIssue[]): boolean {
  return issues.includes('too_dark') || issues.includes('too_small');
}

/** Post-cutout, server-side. The mask is the only thing that can still be wrong. */
export function scoreMaskQuality(m: MaskMetrics): QualityVerdict {
  const issues: CaptureIssue[] = [];

  if (m.fgRatio < T.mask.fgRatioMin) issues.push('mask_empty');
  if (m.fgRatio > T.mask.fgRatioMax) issues.push('mask_fragmented');
  if (m.largestComponent < T.mask.largestComponentMin || m.components > T.mask.componentsMax) {
    issues.push('mask_fragmented');
  }
  if (m.roughness > T.mask.roughnessMax) issues.push('mask_ragged');
  if (m.uncertain > T.mask.uncertainMax) issues.push('mask_uncertain');

  const coverage =
    m.fgRatio < T.mask.fgRatioMin
      ? ramp(m.fgRatio, 0, T.mask.fgRatioMin)
      : ramp(-m.fgRatio, -1, -T.mask.fgRatioMax);
  const cohesion = ramp(m.largestComponent, 0.6, T.mask.largestComponentMin);
  const edges = ramp(-m.roughness, -(T.mask.roughnessMax * 2), -T.mask.roughnessMax);
  const certainty = ramp(-m.uncertain, -(T.mask.uncertainMax * 3), -T.mask.uncertainMax);

  const score = Math.round(
    100 * (0.35 * coverage + 0.3 * cohesion + 0.2 * edges + 0.15 * certainty)
  );

  return {
    score,
    pass: score >= T.GATE_PASS,
    warn: score >= T.GATE_PASS && score < T.GATE_GOOD,
    issues: [...new Set(issues)],
    primaryIssue: primaryIssue(issues),
  };
}

/**
 * What to actually say. Every message names the fix, not the defect — "turn on
 * a light" beats "luma below threshold", and a mask failure is almost always a
 * background problem the user can solve in five seconds.
 */
const RETAKE_COPY: Record<CaptureIssue, string> = {
  too_dark: 'Too dark — turn on a light or move near a window.',
  too_bright: 'Too bright — move out of direct sun.',
  clipped: 'Harsh light is losing detail. Try softer, even lighting.',
  blurry: 'Looks blurry — hold the phone steady.',
  too_small: 'Move closer, or fill more of the box.',
  too_large: 'Back up a little — leave some air around the garment.',
  mask_empty: "We couldn't find the garment. Try a plainer background.",
  mask_fragmented: 'The background confused us. Try a plain floor or bed sheet.',
  mask_ragged: 'The edges came out rough. Hold the phone steady and shoot from above.',
  mask_uncertain: 'This garment blends into the surface. Try a different background.',
};

export function retakeMessage(issue: CaptureIssue | undefined): string | undefined {
  return issue ? RETAKE_COPY[issue] : undefined;
}

/** Live coaching, rotated every few seconds while the camera is open. */
export const COACH_LINES = [
  'Lay it flat on a plain floor or bed.',
  "Shoot from directly above — don't angle the phone.",
  'Fill the box, but leave a little air around the edges.',
  'Use a surface that contrasts with the garment.',
] as const;
