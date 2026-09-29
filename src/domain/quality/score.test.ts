import { describe, expect, it } from 'vitest';

import {
  HARD_FAIL,
  blocksShutter,
  primaryIssue,
  retakeMessage,
  scoreCapture,
  scoreMaskQuality,
  scorePreview,
} from './score';
import { T } from './thresholds';
import type { LiveMetrics, MaskMetrics, StillMetrics } from './types';

const goodStill: StillMetrics = {
  width: 256,
  height: 256,
  luma: 140,
  clipLow: 0.01,
  clipHigh: 0.01,
  lapVar: 200,
  colorCast: { r: 128, g: 128, b: 128 },
};

const still = (o: Partial<StillMetrics> = {}): StillMetrics => ({ ...goodStill, ...o });

const goodLive: LiveMetrics = { luma: 130, clipLow: 0.01, clipHigh: 0.01, lapVar: 90, edgeFill: 0.7 };
const live = (o: Partial<LiveMetrics> = {}): LiveMetrics => ({ ...goodLive, ...o });

const goodMask: MaskMetrics = {
  fgRatio: 0.4,
  largestComponent: 1,
  components: 1,
  roughness: 1.4,
  uncertain: 0.01,
  bbox: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
};
const maskM = (o: Partial<MaskMetrics> = {}): MaskMetrics => ({ ...goodMask, ...o });

describe('scoreCapture', () => {
  it('passes a well-exposed sharp photo with no complaints', () => {
    const v = scoreCapture(still());
    expect(v.pass).toBe(true);
    expect(v.warn).toBe(false);
    expect(v.issues).toEqual([]);
    expect(v.score).toBeGreaterThanOrEqual(T.GATE_GOOD);
  });

  it('flags a dark photo and fails it', () => {
    const v = scoreCapture(still({ luma: 30 }));
    expect(v.issues).toContain('too_dark');
    expect(v.primaryIssue).toBe('too_dark');
    // This line used to read `expect(v.score).toBeLessThan(goodStill.lapVar)`
    // -- a 0..100 score against a Laplacian variance of 200, true for every
    // possible input. It hid the fact that this photo PASSED the gate.
    expect(v.pass).toBe(false);
  });

  it('fails a dark photo even when it is perfectly sharp — the common case', () => {
    // A still phone in a dim room: sharpness maxes out, exposure is terrible.
    // Sharpness carries 0.55 of the score, so on score alone this lands around
    // 68 and passes. It must not.
    const v = scoreCapture(still({ luma: 30, lapVar: 400 }));
    expect(v.score).toBeGreaterThanOrEqual(T.GATE_PASS); // the score alone would pass it...
    expect(v.pass).toBe(false); // ...the hard failure does not
    expect(v.warn).toBe(false);
  });

  it('flags a blurry photo', () => {
    const v = scoreCapture(still({ lapVar: 20 }));
    expect(v.issues).toContain('blurry');
    expect(v.pass).toBe(false);
  });

  it('flags an overexposed photo and fails it', () => {
    const v = scoreCapture(still({ luma: 240 }));
    expect(v.issues).toContain('too_bright');
    expect(v.pass).toBe(false);
  });

  it('only warns on clipping — a white shirt legitimately clips a little', () => {
    const v = scoreCapture(still({ clipHigh: 0.2 }));
    expect(v.issues).toContain('clipped');
    expect(HARD_FAIL).not.toContain('clipped');
  });

  it('flags clipping independently of overall brightness', () => {
    const v = scoreCapture(still({ clipHigh: 0.5 }));
    expect(v.issues).toContain('clipped');
  });

  it('scores monotonically in sharpness', () => {
    const scores = [40, 80, 120, 200].map((lapVar) => scoreCapture(still({ lapVar })).score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });

  it('marks the band between PASS and GOOD as a warning, not a failure', () => {
    // Built to land in the band deterministically. The old version wrapped its
    // assertions in an `if` identical to the implementation, so a score
    // outside the band ran zero assertions and still passed.
    // lapVar 90 -> sharpness 0.5; luma 140 -> exposure 1; tiny clip -> ~0.9.
    const v = scoreCapture(still({ lapVar: 90, luma: 140, clipLow: 0.01, clipHigh: 0.01 }));
    expect(v.score).toBeGreaterThanOrEqual(T.GATE_PASS);
    expect(v.score).toBeLessThan(T.GATE_GOOD);
    expect(v.pass).toBe(true);
    expect(v.warn).toBe(true);
    expect(v.issues).toEqual([]);
  });

  it('never returns a score outside 0..100', () => {
    const extremes: StillMetrics[] = [
      still({ lapVar: 0, luma: 0, clipLow: 1, clipHigh: 1 }),
      still({ lapVar: 1e6, luma: 128, clipLow: 0, clipHigh: 0 }),
      still({ lapVar: -5, luma: 300 }),
    ];
    for (const m of extremes) {
      const s = scoreCapture(m).score;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it('reports a dark AND blurry photo as both, leading with the fixable one', () => {
    const v = scoreCapture(still({ luma: 30, lapVar: 10 }));
    expect(v.issues).toContain('too_dark');
    expect(v.issues).toContain('blurry');
    expect(v.primaryIssue).toBe('too_dark');
  });
});

describe('scorePreview', () => {
  it('stays quiet on a good frame', () => {
    expect(scorePreview(live())).toEqual([]);
  });

  it('warns on a dark frame', () => {
    expect(scorePreview(live({ luma: 20 }))).toContain('too_dark');
  });

  it('warns when the garment does not fill the guide', () => {
    expect(scorePreview(live({ edgeFill: 0.1 }))).toContain('too_small');
  });
});

describe('blocksShutter', () => {
  it('blocks on darkness — the user can fix that in one second', () => {
    expect(blocksShutter(['too_dark'])).toBe(true);
  });

  it('blocks when the subject is too small to segment', () => {
    expect(blocksShutter(['too_small'])).toBe(true);
  });

  it('does NOT block on blur: preview softness often resolves in the real capture', () => {
    expect(blocksShutter(['blurry'])).toBe(false);
  });

  it('does not block on an empty issue list', () => {
    expect(blocksShutter([])).toBe(false);
  });
});

describe('scoreMaskQuality', () => {
  it('passes a clean single-blob cutout', () => {
    const v = scoreMaskQuality(maskM());
    expect(v.issues).toEqual([]);
    expect(v.pass).toBe(true);
  });

  it('reports an empty mask — the model found nothing', () => {
    const v = scoreMaskQuality(maskM({ fgRatio: 0.02, largestComponent: 1, components: 1 }));
    expect(v.issues).toContain('mask_empty');
    expect(v.primaryIssue).toBe('mask_empty');
  });

  it('reports a shredded mask once, not once per triggering signal', () => {
    const v = scoreMaskQuality(maskM({ largestComponent: 0.4, components: 7 }));
    expect(v.issues.filter((i) => i === 'mask_fragmented')).toHaveLength(1);
  });

  it('reports a ragged outline', () => {
    expect(scoreMaskQuality(maskM({ roughness: 9 })).issues).toContain('mask_ragged');
  });

  it('reports a mushy matte — the black-garment-on-dark-floor case', () => {
    expect(scoreMaskQuality(maskM({ uncertain: 0.4 })).issues).toContain('mask_uncertain');
  });

  it('keeps the score within 0..100 for degenerate masks', () => {
    const s = scoreMaskQuality(
      maskM({ fgRatio: 0, largestComponent: 0, components: 0, roughness: 99, uncertain: 1 })
    ).score;
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe('primaryIssue', () => {
  it('prefers the most actionable issue over the worst-scoring one', () => {
    expect(primaryIssue(['blurry', 'too_dark'])).toBe('too_dark');
    expect(primaryIssue(['clipped', 'too_small'])).toBe('too_small');
  });

  it('is undefined when there are no issues', () => {
    expect(primaryIssue([])).toBeUndefined();
  });
});

describe('retakeMessage', () => {
  it('has copy for every issue the scorers can emit', () => {
    const all = [
      'too_dark',
      'too_bright',
      'clipped',
      'blurry',
      'too_small',
      'too_large',
      'mask_empty',
      'mask_fragmented',
      'mask_ragged',
      'mask_uncertain',
    ] as const;
    for (const i of all) {
      expect(retakeMessage(i)).toBeTruthy();
    }
  });

  it('returns undefined when there is nothing to say', () => {
    expect(retakeMessage(undefined)).toBeUndefined();
  });
});
