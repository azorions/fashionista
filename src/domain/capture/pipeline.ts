/** Decisions in the capture pipeline, kept apart from the network and the camera. */

/**
 * Why process-garment's non-2xx answer needs reporting, or null if it does not.
 *
 * Only `{ status: 'failed' }` means our code ran far enough to write its reason
 * onto the row, where the poll will find it. Anything else never updated the
 * row: a 401 from the platform's JWT check, a 546 when the worker is killed for
 * exceeding its CPU budget, the function's own early refusals. Polling for those
 * would wait the full 90s and then say "timed out".
 */
export function invokeFailure(status: number, body: unknown): string | null {
  const { status: outcome, error, message } = (body ?? {}) as Record<string, unknown>;
  if (outcome === 'failed') return null;

  const reason = error ?? message;
  return `Could not process this photo (${status})${typeof reason === 'string' ? `: ${reason}` : ''}`;
}

/** Long edge of what gets uploaded. Enough to reprocess at a better model later. */
const UPLOAD_EDGE = 2048;

/**
 * The resize that caps a photo's long edge, or null if it is already small
 * enough. Giving only one side keeps the aspect ratio. Which side matters: a
 * width of 2048 on a portrait photo leaves it 2731 tall, nearly twice the pixels
 * for the Edge Function to decode inside its CPU budget.
 */
export function uploadResize(
  width: number,
  height: number,
): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= UPLOAD_EDGE) return null;
  return height > width ? { height: UPLOAD_EDGE } : { width: UPLOAD_EDGE };
}
