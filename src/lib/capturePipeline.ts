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

export interface StartedCapture {
  itemId: string;
  imageId: string;
}

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('not signed in');
  return data.user.id;
}

export async function fetchSubcategories(): Promise<SubcategoryRow[]> {
  const { data, error } = await supabase
    .from('garment_subcategory')
    .select('*')
    .order('sort');
  if (error) throw error;
  return data as SubcategoryRow[];
}

/** Steps 1-4. Returns as soon as processing has been kicked off. */
export async function startCapture(
  localUri: string,
  stillMetrics: StillMetrics,
  verdict: QualityVerdict
): Promise<StartedCapture> {
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
      still_metrics: stillMetrics,
      kept_despite_warning: !verdict.pass || verdict.warn,
    })
    .select('id')
    .single();
  if (imgErr) throw imgErr;

  const prepared = await prepareForUpload(localUri);
  const bytes = await (await fetch(prepared.uri)).arrayBuffer();

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(sourcePath, bytes, { contentType: 'image/jpeg', upsert: true });
  if (upErr) throw upErr;

  const { error: fnErr } = await supabase.functions.invoke('process-garment', {
    body: { imageId: image.id },
  });
  if (fnErr) throw fnErr;

  return { itemId, imageId: image.id as string };
}

export interface ProcessedTile {
  tileUrl: string;
  thumbUrl: string;
  maskVerdict: QualityVerdict;
}

/**
 * Steps 5-6. Polls the row, then scores the tile on-device.
 *
 * Polling rather than Realtime on purpose: this is a single user waiting ~5s
 * on their own row. A websocket plus replication config is a lot of moving
 * parts to avoid six HTTP requests.
 */
export async function awaitProcessed(imageId: string): Promise<ProcessedTile> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  for (;;) {
    const { data, error } = await supabase
      .from('item_images')
      .select('status, tile_path, thumb_path, error')
      .eq('id', imageId)
      .single();
    if (error) throw error;

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

  await supabase
    .from('item_images')
    .update({ mask_metrics: mask, bbox: mask.bbox, issues: maskVerdict.issues })
    .eq('id', imageId);

  const { data: img } = await supabase
    .from('item_images')
    .select('item_id')
    .eq('id', imageId)
    .single();

  if (img?.item_id) {
    await supabase
      .from('wardrobe_items')
      .update({ palette, cover_image_id: imageId })
      .eq('id', img.item_id);
  }

  return { tileUrl: tile, thumbUrl: thumb, maskVerdict };
}

export async function signed(path: string, ttlSeconds = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data) throw error ?? new Error('could not sign url');
  return data.signedUrl;
}

/** Step 7. The tag screen's only write. */
export async function saveTags(itemId: string, form: GarmentForm, sub: SubcategoryRow) {
  const tags = applyDefaults(form, rowToDefaults(sub));
  const { error } = await supabase
    .from('wardrobe_items')
    .update(tagsToRow(tags))
    .eq('id', itemId);
  if (error) throw error;
  return tags;
}

/**
 * Nothing is orphaned by a retake: the row AND its objects both go.
 *
 * The paths have to be collected BEFORE the row is deleted. item_images
 * cascades away with the item, and a database cascade does not touch storage
 * -- so deleting the row first loses the only record of what to clean up, and
 * every retake silently leaks a source.jpg (plus tile and thumb if the cutout
 * had finished).
 *
 * ponytail: client-side because this is the only delete path in M1, and a
 * Postgres trigger cannot reach the storage API without pg_net plus a service
 * key. Revisit with a pg_cron orphan sweep if bulk delete arrives in M3.
 */
export async function discardCapture(itemId: string) {
  const { data: images } = await supabase
    .from('item_images')
    .select('source_path, tile_path, thumb_path')
    .eq('item_id', itemId);

  const paths = (images ?? [])
    .flatMap((i) => [i.source_path, i.tile_path, i.thumb_path])
    .filter((p): p is string => !!p);

  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  await supabase.from('wardrobe_items').delete().eq('id', itemId);
}
