import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { extractPalette, type Swatch } from '@/domain/color/palette';
import { channelMeans, exposure, laplacianVariance, scoreMask, toGray } from '@/domain/quality/metrics';
import type { MaskMetrics, StillMetrics } from '@/domain/quality/types';

/**
 * The impure half of image analysis: everything that touches expo-* or the
 * filesystem lives here so src/domain stays a pile of pure functions that run
 * under `npm test` in two seconds with no simulator attached.
 *
 * This file does the pixel-fetching. src/domain does the maths.
 */

/** Analysis resolution. 256px is plenty and keeps the JS work around 10ms. */
const ANALYSIS_EDGE = 256;
/** Palette clustering resolution. ~2,300 pixels beats 1M for identical answers. */
const PALETTE_EDGE = 48;

interface Rgba {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Resize an image and hand back raw RGBA bytes.
 *
 * PNG, never JPEG: JPEG ringing artefacts inflate Laplacian variance, which
 * would make a blurry photo measure as sharp. PNG also preserves the alpha
 * channel, which the mask scoring depends on entirely.
 */
async function decodeToRgba(uri: string, edge: number): Promise<Rgba> {
  const rendered = await ImageManipulator.manipulate(uri).resize({ width: edge }).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!saved.base64) throw new Error('image manipulator returned no base64');

  const bytes = Uint8Array.from(atob(saved.base64), (c) => c.charCodeAt(0));

  // Dynamic import: fast-png is ESM-only, and keeping it off the synchronous
  // startup path means a resolution failure surfaces here rather than as a
  // blank app. See the spike at /spikes/fast-png.
  const { decode } = await import('fast-png');
  const png = decode(bytes);

  const n = png.width * png.height;
  const src = png.data as ArrayLike<number>;
  const ch = png.channels;
  const out = new Uint8Array(n * 4);

  for (let i = 0; i < n; i++) {
    const s = i * ch;
    const d = i * 4;
    if (ch >= 3) {
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = ch === 4 ? src[s + 3] : 255;
    } else {
      // Greyscale, with or without alpha.
      out[d] = out[d + 1] = out[d + 2] = src[s];
      out[d + 3] = ch === 2 ? src[s + 1] : 255;
    }
  }

  return { data: out, width: png.width, height: png.height };
}

/**
 * Post-shutter, pre-upload. Runs in ~150ms.
 *
 * Rejecting here saves an upload and a paid inference call, and gets the user
 * back to the camera while the garment is still in their hands. That last part
 * is the whole point: a retake costs five seconds now and nothing later.
 */
export async function analyzeStill(uri: string): Promise<StillMetrics> {
  const { data, width, height } = await decodeToRgba(uri, ANALYSIS_EDGE);
  const gray = toGray(data, width * height);
  return {
    width,
    height,
    ...exposure(gray),
    lapVar: laplacianVariance(gray, width, height),
    colorCast: channelMeans(data, width * height),
  };
}

export interface TileAnalysis {
  mask: MaskMetrics;
  palette: Swatch[];
}

/**
 * Post-cutout. Scores the matte and extracts the garment's colours.
 *
 * Runs on the client rather than in the Edge Function for two reasons: the
 * client downloads the tile to display it anyway, so the bytes are free; and
 * src/domain uses extensionless imports that Deno rejects, so putting it
 * server-side would mean maintaining a second copy of tested code.
 *
 * Both measurements need the ALPHA channel — the mask score is alpha, and the
 * palette must cluster only pixels where alpha > 0.5. Cluster the transparent
 * ones in and every garment's colour becomes the colour of the floor behind it.
 */
export async function analyzeTile(tileUri: string): Promise<TileAnalysis> {
  const [forMask, forPalette] = await Promise.all([
    decodeToRgba(tileUri, ANALYSIS_EDGE),
    decodeToRgba(tileUri, PALETTE_EDGE),
  ]);

  const alpha = new Uint8Array(forMask.width * forMask.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = forMask.data[i * 4 + 3];

  return {
    mask: scoreMask(alpha, forMask.width, forMask.height),
    palette: extractPalette(forPalette.data, forPalette.width, forPalette.height),
  };
}

/** Shrink a capture before upload. Long edge 2048 keeps reprocessing viable. */
export async function prepareForUpload(uri: string): Promise<{ uri: string }> {
  const rendered = await ImageManipulator.manipulate(uri).resize({ width: 2048 }).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  return { uri: saved.uri };
}
