/**
 * The tile's pixel arithmetic: where the garment is, and where it goes.
 *
 * No imports and no Deno APIs, so the Edge Function can run this and vitest can
 * test it (from src/domain/tile, where the tests run).
 *
 * Every function that returns pixels returns a fresh buffer. jsquash reads
 * `data.buffer` rather than the typed array, so a subarray view would hand it
 * the whole parent image.
 */

export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Alpha at or below this is matte noise, not garment: 2% of 255. Without it, one
 * faint stray pixel in a corner would stop the trim doing anything.
 */
export const ALPHA_FUZZ = 5;

/** The tight box around the visible pixels, or null if there are none. */
export function alphaBounds({ data, width, height }: Rgba): Box | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[(row + x) * 4 + 3] <= ALPHA_FUZZ) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function crop({ data, width }: Rgba, box: Box): Rgba {
  const out = new Uint8ClampedArray(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) {
    const start = ((y + box.y) * width + box.x) * 4;
    out.set(data.subarray(start, start + box.width * 4), y * box.width * 4);
  }
  return { data: out, width: box.width, height: box.height };
}

/**
 * Scale a box so its long edge is exactly `limit`, enlarging if it has to:
 * every garment fills the same share of its tile, however it was framed.
 */
export function fitSize(width: number, height: number, limit: number) {
  const scale = limit / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Centre an image on a transparent square. It must fit: `size` >= both edges. */
export function centerOnCanvas(img: Rgba, size: number): Rgba {
  const out = new Uint8ClampedArray(size * size * 4);
  const left = Math.floor((size - img.width) / 2);
  const top = Math.floor((size - img.height) / 2);
  for (let y = 0; y < img.height; y++) {
    const row = img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4);
    out.set(row, ((y + top) * size + left) * 4);
  }
  return { data: out, width: size, height: size };
}
