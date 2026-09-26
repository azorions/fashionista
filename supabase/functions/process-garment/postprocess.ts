/**
 * Deterministic post-processing. No AI, no per-image cost.
 *
 * This is what turns "a cutout" into "a tile that looks like part of a set":
 * fixed colour correction, then a fixed canvas. Order matters and is not
 * arbitrary -- see the comments on each step.
 *
 * sharp is not an option here: it binds native libvips and Deno cannot load
 * it. magick-wasm is Supabase's own documented recommendation for image work
 * in Edge Functions.
 *
 * UNVERIFIED (spike 3): the WASM build of ImageMagick is a SUBSET of the full
 * library. Confirm that autoLevel, sigmoidalContrast, alpha-fuzz trim and
 * WebP-with-alpha encoding all exist in it, and that a 1024x1024 RGBA decode
 * plus two encodes fits the Edge Function memory limit, before trusting this
 * path. If it is too slow, move the call into a Supabase Background Task so
 * the HTTP response returns immediately. If magick-wasm cannot do it at all,
 * the escape hatch is a ~100-line Node+sharp service.
 */

import {
  ImageMagick,
  initializeImageMagick,
  MagickColors,
  MagickFormat,
  MagickGeometry,
  Percentage,
  Channels,
  Gravity,
  AlphaOption,
} from 'npm:@imagemagick/magick-wasm@0.0.35';

/** Canonical tile edge. Every tile in the grid is exactly this. */
export const TILE = 1024;
/** Garment occupies this share of the canvas, leaving consistent breathing room. */
export const FIT = 0.84;
export const THUMB = 256;

let ready: Promise<void> | null = null;

function init(): Promise<void> {
  ready ??= (async () => {
    const wasm = await fetch(
      import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.35/dist/magick.wasm')
    ).then((r) => r.arrayBuffer());
    await initializeImageMagick(new Uint8Array(wasm));
  })();
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
    //    kills the warm indoor-bulb cast that makes every tile look yellow.
    //
    //    NOT gray-world (scaling channels toward a common mean): a single
    //    strongly coloured garment filling the frame drags the grey point and
    //    comes out desaturated -- the exact failure a wardrobe app must not
    //    have. Restricted to RGB so alpha is never touched.
    img.autoLevel(Channels.RGB);

    // 2. Shadow lift: raise the low end without blowing the highlights.
    img.sigmoidalContrast(false, 3.0, new Percentage(35));

    // 3. Trim to the garment using the alpha channel. 2% fuzz so a stray
    //    semi-transparent speck cannot defeat the trim.
    img.alpha(AlphaOption.Set);
    img.trim(new Percentage(2));
    img.repage();

    // 4. Fit to FIT of the box, then centre on a square transparent canvas.
    //    THIS is what makes a grid of mediocre cutouts read as a set: every
    //    tile has identical dimensions, identical margin, identical centre.
    //    The silhouette inside differs; the box never does.
    const inner = Math.round(TILE * FIT);
    img.resize(new MagickGeometry(`${inner}x${inner}`));
    img.backgroundColor = MagickColors.Transparent;
    img.extent(new MagickGeometry(`${TILE}x${TILE}`), Gravity.Center);

    img.quality = 92;
    img.write(MagickFormat.WebP, (d) => {
      tile = new Uint8Array(d);
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
