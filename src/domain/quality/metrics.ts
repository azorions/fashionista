/**
 * The actual image maths. Pure functions over pixel buffers — no I/O, no
 * platform APIs, so every one of these is directly unit-testable in Node.
 *
 * The caller is responsible for getting pixels here:
 *   - live:   expo-gl readPixels into a 96x96 RGBA buffer  (src/lib/imageIo.ts)
 *   - still:  expo-image-manipulator -> 256px PNG -> fast-png  (src/lib/imageIo.ts)
 *   - mask:   the Edge Function, where the alpha channel exists
 */

import type { MaskMetrics } from './types';

/** Rec.709 luma from an RGBA byte buffer. */
export function toGray(rgba: Uint8Array | Uint8ClampedArray, n: number): Float32Array {
  const g = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    g[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
  }
  return g;
}

/**
 * Variance of the 3x3 discrete Laplacian — the standard sharpness proxy.
 *
 * Scale-sensitive, so ALWAYS measure at a fixed long edge (96 live, 256 still)
 * or the numbers are not comparable between captures.
 */
export function laplacianVariance(g: Float32Array, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = -4 * g[i] + g[i - 1] + g[i + 1] + g[i - w] + g[i + w];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export function exposure(g: Float32Array): { luma: number; clipLow: number; clipHigh: number } {
  let sum = 0;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < g.length; i++) {
    sum += g[i];
    if (g[i] < 8) lo++;
    if (g[i] > 247) hi++;
  }
  const n = g.length || 1;
  return { luma: sum / n, clipLow: lo / n, clipHigh: hi / n };
}

/** Per-channel means. A wide spread means a colour cast the Edge Function will correct. */
export function channelMeans(
  rgba: Uint8Array | Uint8ClampedArray,
  n: number
): { r: number; g: number; b: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    r += rgba[p];
    g += rgba[p + 1];
    b += rgba[p + 2];
  }
  const d = n || 1;
  return { r: r / d, g: g / d, b: b / d };
}

export interface GuideRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Share of gradient energy falling inside the framing guide. A proxy for "is
 * the garment actually in the box, and big enough to be worth capturing".
 */
export function edgeFill(g: Float32Array, w: number, h: number, guide: GuideRect): number {
  let inside = 0;
  let total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const e = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]);
      total += e;
      const u = x / w;
      const v = y / h;
      if (u >= guide.x0 && u <= guide.x1 && v >= guide.y0 && v <= guide.y1) inside += e;
    }
  }
  return total > 0 ? inside / total : 0;
}

/* ------------------------------------------------------------------ *
 * Mask analysis. Runs server-side, where the alpha channel exists.
 * ------------------------------------------------------------------ */

/** 4-connected component labelling over the thresholded alpha, iterative (no recursion). */
function componentSizes(alpha: Uint8Array, w: number, h: number, thr: number): number[] {
  const seen = new Uint8Array(w * h);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || alpha[start] <= thr) continue;
    let size = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const y = (i / w) | 0;
      const visit = (j: number) => {
        if (!seen[j] && alpha[j] > thr) {
          seen[j] = 1;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

/** Count foreground pixels with at least one background 4-neighbour. */
function perimeter(alpha: Uint8Array, w: number, h: number, thr: number): number {
  let p = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (alpha[i] <= thr) continue;
      if (
        x === 0 ||
        x === w - 1 ||
        y === 0 ||
        y === h - 1 ||
        alpha[i - 1] <= thr ||
        alpha[i + 1] <= thr ||
        alpha[i - w] <= thr ||
        alpha[i + w] <= thr
      ) {
        p++;
      }
    }
  }
  return p;
}

/**
 * Score a cutout's alpha channel.
 *
 * Downsample to a 256px long edge before calling: component labelling at 1024
 * is a million pixels of flood fill for precision nobody needs.
 */
export function scoreMask(alpha: Uint8Array, w: number, h: number): MaskMetrics {
  const thr = 127;
  let fg = 0;
  let uncertain = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha[y * w + x];
      if (a > thr) {
        fg++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (a > 38 && a < 217) uncertain++;
    }
  }

  const total = w * h || 1;
  if (fg === 0) {
    return {
      fgRatio: 0,
      largestComponent: 0,
      components: 0,
      roughness: 0,
      uncertain: uncertain / total,
      bbox: { x: 0, y: 0, w: 0, h: 0 },
    };
  }

  const sizes = componentSizes(alpha, w, h, thr);
  const perim = perimeter(alpha, w, h, thr);

  return {
    fgRatio: fg / total,
    largestComponent: sizes[0] / fg,
    components: sizes.filter((s) => s >= 0.005 * fg).length,
    roughness: perim / (2 * Math.sqrt(Math.PI * fg)),
    uncertain: uncertain / total,
    bbox: {
      x: minX / w,
      y: minY / h,
      w: (maxX - minX + 1) / w,
      h: (maxY - minY + 1) / h,
    },
  };
}
