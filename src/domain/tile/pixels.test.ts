import { describe, expect, it } from 'vitest';

import {
  ALPHA_FUZZ,
  alphaBounds,
  centerOnCanvas,
  crop,
  fitSize,
  type Rgba,
} from '../../../supabase/functions/process-garment/pixels';

/**
 * The tile's pixel arithmetic. It lives beside the Edge Function because Deno
 * has to import it, and is tested from here because this is where the tests
 * run. It has no imports of its own, so nothing crosses the src/domain boundary.
 */

/** An all-transparent image with some pixels set to [r, g, b, a]. */
function image(
  width: number,
  height: number,
  set: { x: number; y: number; rgba: [number, number, number, number] }[] = [],
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const { x, y, rgba } of set) data.set(rgba, (y * width + x) * 4);
  return { data, width, height };
}

const px = (img: Rgba, x: number, y: number) =>
  [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

const RED: [number, number, number, number] = [200, 10, 10, 255];

describe('alphaBounds', () => {
  it('is the tight box around the visible pixels', () => {
    const img = image(10, 10, [
      { x: 2, y: 3, rgba: RED },
      { x: 6, y: 7, rgba: RED },
    ]);
    expect(alphaBounds(img)).toEqual({ x: 2, y: 3, width: 5, height: 5 });
  });

  it('ignores a speck faint enough to be matte noise', () => {
    const img = image(10, 10, [
      { x: 5, y: 5, rgba: RED },
      { x: 0, y: 0, rgba: [200, 10, 10, ALPHA_FUZZ] },
    ]);
    expect(alphaBounds(img)).toEqual({ x: 5, y: 5, width: 1, height: 1 });
  });

  it('keeps a pixel just above the noise floor', () => {
    const img = image(10, 10, [
      { x: 5, y: 5, rgba: RED },
      { x: 0, y: 0, rgba: [200, 10, 10, ALPHA_FUZZ + 1] },
    ]);
    expect(alphaBounds(img)).toEqual({ x: 0, y: 0, width: 6, height: 6 });
  });

  it('is null when the cutout removed everything', () => {
    expect(alphaBounds(image(4, 4))).toBeNull();
  });
});

describe('crop', () => {
  it('copies exactly the box', () => {
    const img = image(4, 4, [{ x: 2, y: 1, rgba: RED }]);
    const out = crop(img, { x: 2, y: 1, width: 2, height: 2 });
    expect([out.width, out.height]).toEqual([2, 2]);
    expect(px(out, 0, 0)).toEqual(RED);
    expect(px(out, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it('owns its whole buffer, because jsquash reads data.buffer rather than the view', () => {
    const out = crop(image(4, 4), { x: 1, y: 1, width: 2, height: 2 });
    expect(out.data.buffer.byteLength).toBe(2 * 2 * 4);
  });
});

describe('fitSize', () => {
  it('scales a tall box to the limit on its long edge', () => {
    expect(fitSize(1000, 2000, 860)).toEqual({ width: 430, height: 860 });
  });

  it('scales a wide box to the limit on its long edge', () => {
    expect(fitSize(2000, 1000, 860)).toEqual({ width: 860, height: 430 });
  });

  it('enlarges a small garment too, so every tile fills the same share', () => {
    expect(fitSize(100, 100, 860)).toEqual({ width: 860, height: 860 });
  });

  it('never rounds a sliver down to nothing', () => {
    expect(fitSize(2000, 1, 860)).toEqual({ width: 860, height: 1 });
  });
});

describe('centerOnCanvas', () => {
  it('centres the image on a transparent square', () => {
    const out = centerOnCanvas(image(2, 2, [{ x: 0, y: 0, rgba: RED }]), 6);
    expect([out.width, out.height]).toEqual([6, 6]);
    expect(px(out, 2, 2)).toEqual(RED);
    expect(px(out, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(px(out, 5, 5)).toEqual([0, 0, 0, 0]);
  });

  it('leaves the same margin either side when the leftover is even', () => {
    const out = centerOnCanvas(image(2, 4, [{ x: 0, y: 0, rgba: RED }]), 8);
    expect(px(out, 3, 2)).toEqual(RED);
  });

  it('stays in bounds when the leftover is odd', () => {
    const out = centerOnCanvas(image(3, 3, [{ x: 2, y: 2, rgba: RED }]), 4);
    expect(out.width).toBe(4);
    expect(px(out, 2, 2)).toEqual(RED);
  });

  it('owns its whole buffer, because jsquash reads data.buffer rather than the view', () => {
    expect(centerOnCanvas(image(1, 1), 2).data.buffer.byteLength).toBe(2 * 2 * 4);
  });
});
