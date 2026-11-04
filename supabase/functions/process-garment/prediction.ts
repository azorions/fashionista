/**
 * Reading a Replicate prediction, however finished it is.
 *
 * Wait mode holds the request open for up to 60s, then hands back the unfinished
 * prediction. A cold start on a community model can take that long, and treating
 * the empty output as a failure would fail a capture that was about to succeed.
 *
 * No imports and no Deno APIs, so vitest can test it (from src/domain/cutout).
 */

export class CutoutError extends Error {}

export interface Prediction {
  status?: string;
  output?: unknown;
  error?: unknown;
  urls?: { get?: string };
}

function fileOf({ output }: Prediction): string | null {
  const first = Array.isArray(output) ? output[0] : output;
  return typeof first === 'string' ? first : null;
}

/** The output file's URL, polling until it exists, it fails, or time runs out. */
export async function predictionOutput(
  first: Prediction,
  get: (url: string) => Promise<Prediction>,
  { timeoutMs, intervalMs }: { timeoutMs: number; intervalMs: number },
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let current = first;

  for (;;) {
    // Before the status: file output can arrive while status is 'processing'.
    const file = fileOf(current);
    if (file) return file;

    if (current.status === 'failed' || current.status === 'canceled') {
      throw new CutoutError(`replicate: ${current.error ?? current.status}`);
    }
    const pollUrl = current.urls?.get;
    if (current.status === 'succeeded' || !pollUrl) {
      throw new CutoutError('replicate returned no image url');
    }
    if (Date.now() >= deadline) {
      throw new CutoutError(`replicate timed out, still ${current.status}`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
    current = await get(pollUrl);
  }
}
