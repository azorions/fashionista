/**
 * Deterministic post-processing. No AI, no per-image cost.
 *
 * This is what turns "a cutout" into "a tile that looks like part of a set":
 * fixed colour correction, then a fixed canvas.
 *
 * sharp is not an option here: it binds native libvips and Deno cannot load
 * it. magick-wasm is Supabase's own documented recommendation for image work
 * in Edge Functions.
 *
 * Every call below was checked against @imagemagick/magick-wasm 0.0.43's type
 * definitions. Four of them were wrong on the first pass and would have failed
 * on deploy: AlphaOption does not exist (it is AlphaAction), repage() does not
 * exist (it is resetPage()), sigmoidalContrast has no boolean-first overload,
 * and the wasm asset is exported at /magick.wasm rather than /dist/magick.wasm.
 *
 * STILL UNVERIFIED: that this runs at all. The WASM build is a subset of full
 * ImageMagick and nothing here has executed. Confirm a 1024x1024 RGBA decode
 * plus two WebP-with-alpha encodes fits the Edge Function memory limit. If it
 * is slow, move the call into a Background Task so the HTTP response returns
 * immediately. If magick-wasm cannot do it, a ~100-line Node+sharp service is
 * the escape hatch.
 */

import {
  AlphaAction,
  Channels,
  Gravity,
  ImageMagick,
  initializeImageMagick,
  MagickColors,
  MagickFormat,
  MagickGeometry,
  Percentage,
} from 'npm:@imagemagick/magick-wasm@0.0.43';

/** Canonical tile edge. Every tile in the grid is exactly this. */
export const TILE = 1024;
/** Garment occupies this share of the canvas, leaving consistent breathing room. */
export const FIT = 0.84;
export const THUMB = 256;

let ready: Promise<void> | null = null;

function init(): Promise<void> {
  // initializeImageMagick accepts a URL directly, so there is no need to fetch
  // the bytes ourselves.
  ready ??= initializeImageMagick(
    new URL(import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.43/magick.wasm'))
  );
  return ready;
}

export interface Tiles {
  tile: Uint8Array;
  thumb: Uint8Array;
}

export async function postprocess(cutoutPng: Uint8Array): Promise<Tiles> {
  await init();

  let tile: Uint8Array | null = null;
  let thumb: Uint8Array | null = null;

  ImageMagick.read(cutoutPng, (img) => {
    // 1. Per-channel level stretch == white-patch white balance. This is what
    //    kills the warm indoor-bulb cast that makes every tile look yellow,
    //    and it lifts an underexposed shot at the same time.
    //
    //    NOT gray-world (scaling channels toward a common mean): a single
    //    strongly coloured garment filling the frame drags the grey point and
    //    comes out desaturated -- the exact failure a wardrobe app must not
    //    have. Restricted to RGB so alpha is never touched.
    img.autoLevel(Channels.RGB);

    // A separate sigmoidal shadow-lift pass was designed here and cut. The
    // only valid overloads are (contrast) and (contrast, midpoint), and
    // whether a negative contrast flattens or inverts the curve in this build
    // is not something to guess at in code that has never run. autoLevel
    // already covers the stated goal. Revisit during the spike, with real
    // photos to compare against.

    // 2. Trim to the garment using the alpha channel. 2% fuzz so a stray
    //    semi-transparent speck cannot defeat the trim.
    img.alpha(AlphaAction.Set);
    img.trim(new Percentage(2));
    img.resetPage();

    // 3. Fit to FIT of the box, then centre on a square transparent canvas.
    //    THIS is what makes a grid of mediocre cutouts read as a set: every
    //    tile has identical dimensions, identical margin, identical centre.
    //    The silhouette inside differs; the box never does.
    const inner = Math.round(TILE * FIT);
    img.resize(new MagickGeometry(`${inner}x${inner}`));
    img.backgroundColor = MagickColors.Transparent;
    img.extent(new MagickGeometry(`${TILE}x${TILE}`), Gravity.Center);

    img.quality = 92;
    img.write(MagickFormat.WebP, (d) => {
      tile = new Uint8Array(d); // copy: the buffer is reused after the callback
    });

    img.resize(new MagickGeometry(`${THUMB}x${THUMB}`));
    img.quality = 82;
    img.write(MagickFormat.WebP, (d) => {
      thumb = new Uint8Array(d);
    });
  });

  if (!tile || !thumb) throw new Error('postprocess produced no output');
  return { tile, thumb };
}
