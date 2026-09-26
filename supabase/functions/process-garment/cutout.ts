/**
 * Background removal, behind a provider adapter.
 *
 * The adapter is the whole point: "free" and "paid" are the same code path and
 * differ by one environment variable. Milestone 1 runs on Replicate's signup
 * credits; swapping to fal.ai when you want the best edge quality on knit
 * fuzz, lace and fringe is `CUTOUT_PROVIDER=fal`.
 *
 * This runs server-side for one reason only: the API token must not ship in
 * the app bundle, which anyone can unzip.
 */

export type Provider = 'replicate' | 'fal';

export interface CutoutResult {
  /** PNG bytes with an alpha channel. PNG, not WebP, so the matte is lossless. */
  png: Uint8Array;
  provider: string;
  ms: number;
}

export class CutoutError extends Error {}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new CutoutError(`could not download result: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** ~$0.0004/run, and new accounts get signup credits. The milestone 1 default. */
async function viaReplicate(imageUrl: string): Promise<Uint8Array> {
  const token = Deno.env.get('REPLICATE_API_TOKEN');
  if (!token) throw new CutoutError('REPLICATE_API_TOKEN is not set');

  const r = await fetch('https://api.replicate.com/v1/models/851-labs/background-remover/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Blocks until done instead of making us poll a prediction id.
      Prefer: 'wait',
    },
    body: JSON.stringify({ input: { image: imageUrl, format: 'png' } }),
  });

  if (!r.ok) throw new CutoutError(`replicate ${r.status}: ${await r.text()}`);
  const body = await r.json();
  if (body.error) throw new CutoutError(`replicate: ${body.error}`);

  const out = Array.isArray(body.output) ? body.output[0] : body.output;
  if (typeof out !== 'string') throw new CutoutError('replicate returned no image url');
  return fetchBytes(out);
}

/**
 * BiRefNet v2, ~$0.0008/compute-second (verified). Best matte quality on the
 * garments that actually break cheap models: mohair, lace, fringe.
 *
 * 'General Use (Light)' is the deliberate default over 'Heavy' -- escalate per
 * item only when the mask gate fails, rather than paying Heavy prices for
 * every sock.
 */
async function viaFal(imageUrl: string): Promise<Uint8Array> {
  const key = Deno.env.get('FAL_KEY');
  if (!key) throw new CutoutError('FAL_KEY is not set');

  const r = await fetch('https://fal.run/fal-ai/birefnet/v2', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      model: 'General Use (Light)',
      operating_resolution: '1024x1024',
      output_format: 'png',
      refine_foreground: true,
      output_mask: false,
    }),
  });

  if (!r.ok) throw new CutoutError(`fal ${r.status}: ${await r.text()}`);
  const { image } = await r.json();
  if (!image?.url) throw new CutoutError('fal returned no image');
  return fetchBytes(image.url);
}

export async function cutout(imageUrl: string, provider?: Provider): Promise<CutoutResult> {
  const chosen = (provider ?? Deno.env.get('CUTOUT_PROVIDER') ?? 'replicate') as Provider;
  const started = Date.now();

  const png =
    chosen === 'fal' ? await viaFal(imageUrl) : await viaReplicate(imageUrl);

  // ponytail: single attempt, single provider. The seam for a failover ladder
  // exists (swap `chosen` and retry) but the logic does not -- a garment is
  // never lost either way, because the source upload happens first and the row
  // can be reprocessed. Add failover when a provider outage actually bites.
  return { png, provider: chosen, ms: Date.now() - started };
}
