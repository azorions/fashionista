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
 * Every call below was checked against @imagemagick/magick-wasm 0.0.43 -- its
 * type definitions for the image operators, and its shipped implementation for
 * initialisation, because the types alone were not enough (see init()).
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

/** Must match the version in the import above; imports cannot use a variable. */
const PKG = 'npm:@imagemagick/magick-wasm@0.0.43';

let ready: Promise<void> | null = null;

/**
 * Load the wasm as BYTES, never as a URL.
 *
 * initializeImageMagick's type accepts a URL, but its implementation throws
 * "Only http/https protocol is supported" for any other scheme -- and
 * import.meta.resolve on an npm: specifier yields file://. An earlier version
 * of this file passed that URL and so failed every single capture, having
 * trusted the type signature over the code behind it.
 *
 * This is Supabase's documented pattern (resolve the package, readFile the
 * wasm relative to it), with the path corrected for 0.0.43, which moved the
 * default build into x86/.
 */
function init(): Promise<void> {
  ready ??= (async () => {
    const wasm = await Deno.readFile(new URL('x86/magick.wasm', import.meta.resolve(PKG)));
    await initializeImageMagick(wasm);
  })().catch((e) => {
    // Memoising a REJECTED promise would poison the isolate: every later
    // request would fail instantly with the same error. Allow a retry.
    ready = null;
    throw e;
  });
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
