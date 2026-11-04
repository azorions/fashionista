/**
 * Deterministic post-processing. No AI, no per-image cost.
 *
 * This is what turns "a cutout" into "a tile that looks like part of a set":
 * every tile has identical dimensions, identical margin, identical centre. The
 * silhouette inside differs; the box never does.
 *
 * sharp is not an option here: it binds native libvips, and Edge Functions
 * cannot load it. magick-wasm was the first choice and is out for two reasons.
 * It ships two 15 MB wasm builds, about 10 MB compressed, against a 5 MB limit
 * when deploying without Docker. And it compiles all of that on a cold start,
 * inside a 2s CPU budget for the whole request. These three modules are about
 * 1.5 MB between them. The geometry between them is pixels.ts.
 *
 * ponytail: no colour correction. A level stretch was designed here and cut
 * before it ever ran. It maps each garment's darkest and brightest pixels to 0
 * and 255, which only works if the garment contains true black and true white:
 * black jeans would come out grey and a navy jumper bright blue, and the Style
 * tab scores outfits on the colours read from this tile. Without a reference
 * white in a cutout, the camera's own white balance is the best estimate we
 * have. Revisit if real photos come out with a visible cast.
 */

import { decode, init as initPng } from 'npm:@jsquash/png@3.1.1/decode.js';
import resize, { initResize } from 'npm:@jsquash/resize@2.1.1';
import encode, { init as initWebp } from 'npm:@jsquash/webp@1.5.0/encode.js';

import { alphaBounds, centerOnCanvas, crop, fitSize, type Rgba } from './pixels.ts';

/** Canonical tile edge. Every tile in the grid is exactly this. */
export const TILE = 1024;
/** Garment occupies this share of the canvas, leaving consistent breathing room. */
export const FIT = 0.84;
export const THUMB = 256;

/** Read a wasm file out of an npm package, relative to one of its modules. */
async function compile(moduleSpecifier: string, wasmPath: string): Promise<WebAssembly.Module> {
  const bytes = await Deno.readFile(new URL(wasmPath, import.meta.resolve(moduleSpecifier)));
  return WebAssembly.compile(bytes);
}

let ready: Promise<void> | null = null;

/**
 * Hand each library its wasm as a compiled module.
 *
 * Left to themselves they fetch() the file relative to import.meta.url, which
 * is not something to rely on inside a bundled function.
 *
 * The webp file must be the SIMD build: init() picks its JS glue by feature
 * detection, and V8 has SIMD, so the glue it picks expects this binary.
 */
function init(): Promise<void> {
  ready ??= (async () => {
    const [png, scaler, webp] = await Promise.all([
      compile('npm:@jsquash/png@3.1.1/decode.js', './codec/pkg/squoosh_png_bg.wasm'),
      compile('npm:@jsquash/resize@2.1.1', './lib/resize/pkg/squoosh_resize_bg.wasm'),
      compile('npm:@jsquash/webp@1.5.0/encode.js', './codec/enc/webp_enc_simd.wasm'),
    ]);
    await Promise.all([initPng(png), initResize(scaler), initWebp(webp)]);
  })().catch((e) => {
    // Memoising a REJECTED promise would poison the isolate: every later
    // request would fail instantly with the same error. Allow a retry.
    ready = null;
    throw e;
  });
  return ready;
}

/**
 * TypeScript's ImageData allows float pixels too, but these libraries only ever
 * produce and read 8-bit, which is what Rgba says.
 */
const toRgba = (img: ImageData) => img as unknown as Rgba;

/** Premultiplied, so edges do not pick up the colour behind the garment. */
const scaled = async (img: Rgba, width: number, height: number) =>
  toRgba(await resize(img as ImageData, { width, height, premultiply: true }));

const webp = async (img: Rgba, quality: number) =>
  new Uint8Array(await encode(img as ImageData, { quality }));

export interface Tiles {
  tile: Uint8Array;
  thumb: Uint8Array;
}

export async function postprocess(cutoutPng: Uint8Array): Promise<Tiles> {
  const marks: string[] = [];
  let last = performance.now();
  const mark = (name: string) => {
    const now = performance.now();
    marks.push(`${name} ${Math.round(now - last)}ms`);
    last = now;
  };

  await init();
  mark('init');

  const decoded = toRgba(await decode(cutoutPng.buffer as ArrayBuffer));
  mark(`decode ${decoded.width}x${decoded.height}`);

  const box = alphaBounds(decoded);
  if (!box) throw new Error('the cutout found no garment in this photo');

  const garment = crop(decoded, box);
  const size = fitSize(box.width, box.height, Math.round(TILE * FIT));
  mark('trim');

  const canvas = centerOnCanvas(await scaled(garment, size.width, size.height), TILE);
  mark('fit');

  const tile = await webp(canvas, 92);
  mark('tile');

  const thumb = await webp(await scaled(canvas, THUMB, THUMB), 82);
  mark('thumb');

  // Wall clock, but all of this is CPU-bound, so it is close to what counts
  // against the 2s limit. This line is how an overrun gets diagnosed.
  console.log(`postprocess: ${marks.join(', ')}`);
  return { tile, thumb };
}
