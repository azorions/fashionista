import { supabase } from './supabase';

/**
 * Save the current canvas as ONE atomic write.
 *
 * Goes through the save_outfit database function rather than two table
 * inserts. Two inserts could not be atomic: when the second failed -- the same
 * garment picked twice violates the (outfit_id, item_id) key -- the first had
 * already committed an empty outfit that nothing could see or delete. The
 * function also removes duplicates and refuses fewer than two distinct
 * garments.
 */
export async function saveOutfit(itemIds: string[], name?: string): Promise<string> {
  const { data, error } = await supabase.rpc('save_outfit', {
    p_item_ids: itemIds,
    p_name: name ?? null,
  });
  if (error) throw error;
  return data as string;
}
