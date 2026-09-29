import { supabase } from './supabase';

export interface SaveOutfitOptions {
  name?: string;
  /** 'suggested' when the user kept one of the engine's outfits. */
  source?: 'manual' | 'suggested';
  /** The vibe a suggestion was made for. */
  vibe?: string;
}

/**
 * Save an outfit as ONE atomic write.
 *
 * Goes through the save_outfit database function rather than two table
 * inserts. Two inserts could not be atomic: when the second failed -- the same
 * garment picked twice violates the (outfit_id, item_id) key -- the first had
 * already committed an empty outfit that nothing could see or delete. The
 * function also removes duplicates and refuses fewer than two distinct
 * garments.
 */
export async function saveOutfit(itemIds: string[], opts: SaveOutfitOptions = {}): Promise<string> {
  const { data, error } = await supabase.rpc('save_outfit', {
    p_item_ids: itemIds,
    p_name: opts.name ?? null,
    p_source: opts.source ?? 'manual',
    p_vibe: opts.vibe ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** outfit_items cascade away with it. */
export async function deleteOutfit(id: string): Promise<void> {
  const { data, error } = await supabase.from('outfits').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('that outfit no longer exists');
}
