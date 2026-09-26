import { describe, expect, it } from 'vitest';

import { channelMeans, edgeFill, exposure, laplacianVariance, scoreMask, toGray } from './metrics';

/** Build an RGBA buffer from a per-pixel colour function. */
function rgba(w: number, h: number, fn: (x: number, y: number) => [number, number, number]) {
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const p = (y * w + x) * 4;
      buf[p] = r;
      buf[p + 1] = g;
      buf[p + 2] = b;
      buf[p + 3] = 255;
    }
  }
  return buf;
}

/** Build an 8-bit alpha channel from a predicate. */
function mask(w: number, h: number, inside: (x: number, y: number) => boolean) {
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) a[y * w + x] = inside(x, y) ? 255 : 0;
  }
  return a;
}

describe('toGray', () => {
  it('applies Rec.709 weights', () => {
    const g = toGray(new Uint8Array([255, 0, 0, 255]), 1);
    expect(g[0]).toBeCloseTo(0.2126 * 255, 4);
  });

  it('maps white to 255 and black to 0', () => {
    const g = toGray(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]), 2);
    expect(g[0]).toBeCloseTo(255, 3);
    expect(g[1]).toBe(0);
  });
});

describe('laplacianVariance', () => {
  it('is zero for a flat field — no edges means no energy', () => {
    const g = toGray(
      rgba(16, 16, () => [128, 128, 128]),
      256
    );
    expect(laplacianVariance(g, 16, 16)).toBeCloseTo(0, 6);
  });

  it('is large for a checkerboard', () => {
    const g = toGray(
      rgba(16, 16, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0])),
      256
    );
    expect(laplacianVariance(g, 16, 16)).toBeGreaterThan(10000);
  });

  it('ranks a sharp edge above a gradual one', () => {
    const sharp = toGray(
      rgba(32, 32, (x) => (x < 16 ? [0, 0, 0] : [255, 255, 255])),
      1024
    );
    const soft = toGray(
      rgba(32, 32, (x) => [x * 8, x * 8, x * 8]),
      1024
    );
    expect(laplacianVariance(sharp, 32, 32)).toBeGreaterThan(laplacianVariance(soft, 32, 32));
  });

  it('returns 0 rather than NaN for a degenerate size', () => {
    expect(laplacianVariance(new Float32Array(4), 2, 2)).toBe(0);
  });
});

describe('exposure', () => {
  it('reports crushed blacks', () => {
    const e = exposure(toGray(rgba(8, 8, () => [0, 0, 0]), 64));
    expect(e.luma).toBe(0);
    expect(e.clipLow).toBe(1);
    expect(e.clipHigh).toBe(0);
  });

  it('reports blown highlights', () => {
    const e = exposure(toGray(rgba(8, 8, () => [255, 255, 255]), 64));
    expect(e.clipHigh).toBe(1);
    expect(e.clipLow).toBe(0);
  });

  it('leaves a well-exposed mid-grey unclipped', () => {
    const e = exposure(toGray(rgba(8, 8, () => [128, 128, 128]), 64));
    expect(e.luma).toBeCloseTo(128, 0);
    expect(e.clipLow).toBe(0);
    expect(e.clipHigh).toBe(0);
  });
});

describe('channelMeans', () => {
  it('detects a warm cast', () => {
    const m = channelMeans(rgba(4, 4, () => [200, 150, 100]), 16);
    expect(m.r).toBeCloseTo(200, 5);
    expect(m.b).toBeCloseTo(100, 5);
    expect(m.r).toBeGreaterThan(m.b);
  });
});

describe('edgeFill', () => {
  const guide = { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 };

  it('is high when the detail sits inside the guide', () => {
    const g = toGray(
      rgba(32, 32, (x, y) => {
        const inside = x >= 8 && x < 24 && y >= 8 && y < 24;
        return inside && (x + y) % 2 ? [255, 255, 255] : [0, 0, 0];
      }),
      1024
    );
    // Not ~1.0: the block's own boundary transition straddles the guide edge,
    // so a slice of its gradient is counted outside. 0.75 is the honest answer
    // for a subject that exactly fills the box.
    expect(edgeFill(g, 32, 32, guide)).toBeGreaterThan(0.7);
  });

  it('is low when the detail sits outside the guide', () => {
    const g = toGray(
      rgba(32, 32, (x, y) => {
        const outside = x < 6 || x >= 26 || y < 6 || y >= 26;
        return outside && (x + y) % 2 ? [255, 255, 255] : [0, 0, 0];
      }),
      1024
    );
    expect(edgeFill(g, 32, 32, guide)).toBeLessThan(0.2);
  });

  it('returns 0 for a featureless frame instead of dividing by zero', () => {
    const g = toGray(
      rgba(16, 16, () => [90, 90, 90]),
      256
    );
    expect(edgeFill(g, 16, 16, guide)).toBe(0);
  });
});

describe('scoreMask', () => {
  it('measures a single solid blob as one clean component', () => {
    const w = 40;
    const h = 40;
    const m = scoreMask(
      mask(w, h, (x, y) => x >= 10 && x < 30 && y >= 10 && y < 30),
      w,
      h
    );
    expect(m.fgRatio).toBeCloseTo(400 / 1600, 5);
    expect(m.components).toBe(1);
    expect(m.largestComponent).toBe(1);
    expect(m.uncertain).toBe(0);
  });

  it('locates the bounding box', () => {
    const w = 40;
    const h = 40;
    const m = scoreMask(
      mask(w, h, (x, y) => x >= 10 && x < 30 && y >= 10 && y < 30),
      w,
      h
    );
    expect(m.bbox.x).toBeCloseTo(0.25, 5);
    expect(m.bbox.y).toBeCloseTo(0.25, 5);
    expect(m.bbox.w).toBeCloseTo(0.5, 2);
    expect(m.bbox.h).toBeCloseTo(0.5, 2);
  });

  it('counts a shredded mask as multiple components — the patterned-bedsheet failure', () => {
    const w = 40;
    const h = 40;
    const m = scoreMask(
      mask(w, h, (x, y) => {
        const a = x >= 4 && x < 16 && y >= 4 && y < 16;
        const b = x >= 24 && x < 36 && y >= 24 && y < 36;
        return a || b;
      }),
      w,
      h
    );
    expect(m.components).toBe(2);
    expect(m.largestComponent).toBeCloseTo(0.5, 2);
  });

  it('scores a ragged outline as rougher than a compact one of equal area', () => {
    const w = 48;
    const h = 48;
    const compact = scoreMask(
      mask(w, h, (x, y) => x >= 12 && x < 36 && y >= 12 && y < 36),
      w,
      h
    );
    // Same pixel count, scattered into a comb — far more perimeter.
    const ragged = scoreMask(
      mask(w, h, (x, y) => y >= 4 && y < 28 && x % 2 === 0 && x >= 0 && x < 48),
      w,
      h
    );
    expect(ragged.roughness).toBeGreaterThan(compact.roughness);
  });

  it('handles an empty mask without NaN', () => {
    const m = scoreMask(mask(16, 16, () => false), 16, 16);
    expect(m.fgRatio).toBe(0);
    expect(m.components).toBe(0);
    expect(m.roughness).toBe(0);
    expect(Number.isNaN(m.largestComponent)).toBe(false);
  });

  it('flags semi-transparent mush as uncertain', () => {
    const w = 16;
    const h = 16;
    const a = new Uint8Array(w * h).fill(128); // right in the ambiguous band
    const m = scoreMask(a, w, h);
    expect(m.uncertain).toBe(1);
  });
});
