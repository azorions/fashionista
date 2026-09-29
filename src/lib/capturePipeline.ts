import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from './supabase';
import { analyzeTile, prepareForUpload } from './imageIo';
import { rowToDefaults, tagsToRow, type SubcategoryRow } from '@/domain/garment/row';
import { applyDefaults, type GarmentForm } from '@/domain/tagging/schema';
import { scoreMaskQuality } from '@/domain/quality/score';
import type { QualityVerdict, StillMetrics } from '@/domain/quality/types';

/**
 * Photo on disk to finished closet tile.
 *
 * Ordering matters and is not negotiable: the wardrobe row is inserted FIRST,
 * because its id is what the storage path is built from. Upload before the row
 * exists and you get objects nothing can reach.
 *
 *   1. insert wardrobe_items (as 'unknown' -- tags come later)
 *   2. insert item_images    (status pending, source path)
 *      -> the ids are handed to the caller HERE, before anything can fail
 *   3. upload source.jpg
 *   4. invoke process-garment
 *   5. poll until ready
 *   6. score the returned tile on-device, write the results
 *   7. (tag screen) update the row with real tags
 *
 * Step 1 uses the 'unknown' subcategory deliberately. A garment exists the
 * moment it is photographed; making that conditional on the user finishing a
 * form is how captures get lost.
 */

const BUCKET = 'wardrobe';
const POLL_MS = 800;
const POLL_TIMEOUT_MS = 90_000;

export interface CaptureIds {
  itemId: string;
  imageId: string;
}

export interface ProcessedTile {
  tileUrl: string;
  thumbUrl: string;
  maskVerdict: QualityVerdict;
}

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('not signed in');
  return data.user.id;
}

export async function fetchSubcategories(): Promise<SubcategoryRow[]> {
  const { data, error } = await supabase.from('garment_subcategory').select('*').order('sort');
  if (error) throw error;
  return data as SubcategoryRow[];
}

/** Steps 1-2. */
async function createRows(
  metrics: StillMetrics,
  verdict: QualityVerdict
): Promise<{ ids: CaptureIds; sourcePath: string }> {
  const userId = await requireUserId();

  const { data: unknownSub, error: subErr } = await supabase
    .from('garment_subcategory')
    .select('*')
    .eq('code', 'unknown')
    .single();
  if (subErr) throw subErr;

  const placeholder = applyDefaults(
    { category: (unknownSub as SubcategoryRow).category, subcategory: 'unknown' },
    rowToDefaults(unknownSub as SubcategoryRow)
  );

  const { data: item, error: itemErr } = await supabase
    .from('wardrobe_items')
    .insert({ user_id: userId, ...tagsToRow(placeholder) })
    .select('id')
    .single();
  if (itemErr) throw itemErr;

  const itemId = item.id as string;
  const sourcePath = `${userId}/${itemId}/v1/source.jpg`;

  const { data: image, error: imgErr } = await supabase
    .from('item_images')
    .insert({
      item_id: itemId,
      user_id: userId,
      version: 1,
      source_path: sourcePath,
      status: 'pending',
      score: verdict.score,
      issues: verdict.issues,
      still_metrics: metrics,
      // A failed verdict only reaches the pipeline through "Use it anyway", so
      // this records a real decision. It used to be `!pass || warn`, written
      // before the user had chosen anything at all.
      kept_despite_warning: !verdict.pass,
    })
    .select('id')
    .single();
  if (imgErr) throw imgErr;

  return { ids: { itemId, imageId: image.id as string }, sourcePath };
}

/** Step 3. */
async function upload(sourcePath: string, localUri: string) {
  const prepared = await prepareForUpload(localUri);
  // Supabase's documented React Native pattern; Expo 57's fetch reads file://.
  const bytes = await (await fetch(prepared.uri)).arrayBuffer();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(sourcePath, bytes, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
}

/** Step 4. */
async function invoke(imageId: string) {
  const { error } = await supabase.functions.invoke('process-garment', { body: { imageId } });
  if (!error) return;

  // FunctionsHttpError means the function RAN and returned non-2xx -- and it
  // has already written its real failure reason onto the row, which the poll
  // surfaces. Throwing here used to replace that reason with supabase-js's
  // generic "Edge Function returned a non-2xx status code".
  if (error instanceof FunctionsHttpError) return;

  // A relay or fetch error means it never ran, so nothing will ever update
  // the row. Fail now rather than poll for 90 seconds.
  throw error;
}

/**
 * In-flight captures, keyed by the photo's local URI.
 *
 * The review screen's effect can run more than once for the same photo: a
 * Fast Refresh mid-capture re-runs it with the photo still in the store and no
 * tile yet. Every re-run used to insert another wardrobe row, upload again and
 * pay for another cutout, leaving the first row where no retake could reach
 * it. A module-level map survives a refresh of the screen that calls it.
 *
 * Failed runs are kept too. Retrying is what Retake is for, and Retake brings
 * a NEW photo; the same photo never needs a second run. So a re-run after a
 * failure must reattach to that failure, not quietly insert a second set of
 * rows and orphan the first.
 *
 * ponytail: one settled promise per capture per session, a few hundred bytes.
 */
const runs = new Map<string, Promise<ProcessedTile>>();

/**
 * The whole pipeline, run at most once per photo, however often it is asked.
 *
 * `onCreated` fires as soon as the rows exist. The ids used to reach the store
 * only after everything resolved, so a failed upload -- or a function that was
 * never deployed, the likeliest first-run failure of all -- left a row that no
 * retake could clean up: a ghost tile spinning in the closet forever.
 *
 * Deliberately NOT cancelled when the screen unmounts. If you swipe away
 * mid-cutout the capture still finishes and gets its palette and cover image;
 * cancelling would leave exactly the half-built row that spins forever. The
 * caller simply stops listening.
 */
export function runCapture(
  localUri: string,
  metrics: StillMetrics,
  verdict: QualityVerdict,
  onCreated: (ids: CaptureIds) => void
): Promise<ProcessedTile> {
  const existing = runs.get(localUri);
  if (existing) return existing;

  const run = (async () => {
    const { ids, sourcePath } = await createRows(metrics, verdict);
    onCreated(ids);
    await upload(sourcePath, localUri);
    await invoke(ids.imageId);
    return awaitProcessed(ids.imageId);
  })();

  runs.set(localUri, run);
  // Marks the stored promise as handled; every caller still sees the rejection
  // through its own .catch.
  run.catch(() => {});
  return run;
}

/**
 * Steps 5-6. Polls the row, then scores the tile on-device.
 *
 * Polling rather than Realtime on purpose: this is a single user waiting ~5s
 * on their own row. A websocket plus replication config is a lot of moving
 * parts to avoid six HTTP requests.
 */
async function awaitProcessed(imageId: string): Promise<ProcessedTile> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  for (;;) {
    const { data, error } = await supabase
      .from('item_images')
      .select('status, tile_path, thumb_path, error')
      .eq('id', imageId)
      .maybeSingle();
    if (error) throw error;

    // The row is gone because the capture was discarded. Stop cleanly rather
    // than throw PGRST116 at whoever is still listening.
    if (!data) throw new Error('capture was discarded');
    if (data.status === 'failed') throw new Error(data.error ?? 'processing failed');
    if (data.status === 'ready' && data.tile_path && data.thumb_path) {
      return finishTile(imageId, data.tile_path, data.thumb_path);
    }
    if (Date.now() > deadline) throw new Error('processing timed out');

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function finishTile(
  imageId: string,
  tilePath: string,
  thumbPath: string
): Promise<ProcessedTile> {
  const [tile, thumb] = await Promise.all([signed(tilePath), signed(thumbPath)]);

  const { mask, palette } = await analyzeTile(tile);
  const maskVerdict = scoreMaskQuality(mask);

  // `issues` is deliberately NOT overwritten here. It holds the capture-time
  // issues -- the calibration signal the column exists to keep -- and writing
  // the mask issues over them destroyed it. Mask issues are recomputable from
  // mask_metrics at any time.
  const { data: img, error: imgErr } = await supabase
    .from('item_images')
    .update({ mask_metrics: mask, bbox: mask.bbox })
    .eq('id', imageId)
    .select('item_id')
    .single();
  if (imgErr) throw imgErr;

  // Without the cover pointer the grid can never find this tile and shows a
  // spinner forever, so failing to set it is a failed capture, not a detail.
  const { error: itemErr } = await supabase
    .from('wardrobe_items')
    .update({ palette, cover_image_id: imageId })
    .eq('id', img.item_id);
  if (itemErr) throw itemErr;

  return { tileUrl: tile, thumbUrl: thumb, maskVerdict };
}

export async function signed(path: string, ttlSeconds = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data) throw error ?? new Error('could not sign url');
  return data.signedUrl;
}

/** The user kept a cutout the mask scorer flagged. Logged for threshold calibration. */
export async function markKeptDespiteWarning(imageId: string) {
  const { error } = await supabase
    .from('item_images')
    .update({ kept_despite_warning: true })
    .eq('id', imageId);
  if (error) throw error;
}

/** Step 7. The tag screen's only write. */
export async function saveTags(itemId: string, form: GarmentForm, sub: SubcategoryRow) {
  const tags = applyDefaults(form, rowToDefaults(sub));
  const { data, error } = await supabase
    .from('wardrobe_items')
    .update(tagsToRow(tags))
    .eq('id', itemId)
    .select('id');
  if (error) throw error;
  // PostgREST answers 204 when an update matches nothing -- a stale id, or a
  // row RLS hides -- and the tag screen used to navigate home as if it saved.
  if (!data?.length) throw new Error('that garment no longer exists');
  return tags;
}

/**
 * Nothing is orphaned by a retake: the row AND its objects both go.
 *
 * The paths have to be collected BEFORE the row is deleted. item_images
 * cascades away with the item, and a database cascade does not touch storage
 * -- so deleting the row first loses the only record of what to clean up.
 *
 * Every step checks its error. If the objects cannot be removed the row is
 * kept, because it is the only record of them; deleting it anyway would be
 * precisely the leak this function exists to prevent.
 *
 * ponytail: client-side because this is the only delete path in M1, and a
 * Postgres trigger cannot reach the storage API without pg_net plus a service
 * key. Revisit with a pg_cron orphan sweep if bulk delete arrives in M3.
 */
export async function discardCapture(itemId: string) {
  const { data: images, error: readErr } = await supabase
    .from('item_images')
    .select('source_path, tile_path, thumb_path')
    .eq('item_id', itemId);
  if (readErr) throw readErr;

  const paths = (images ?? [])
    .flatMap((i) => [i.source_path, i.tile_path, i.thumb_path])
    .filter((p): p is string => !!p);

  if (paths.length) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
    if (rmErr) throw rmErr;
  }

  const { error: delErr } = await supabase.from('wardrobe_items').delete().eq('id', itemId);
  if (delErr) throw delErr;
}
