import { supabase } from './supabase';

/** Save the current canvas. z_index is slot order; M1 only ever has two. */
export async function saveOutfit(itemIds: string[], name?: string) {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('not signed in');

  const { data: outfit, error } = await supabase
    .from('outfits')
    .insert({ user_id: user.user.id, name: name ?? null, source: 'manual' })
    .select('id')
    .single();
  if (error) throw error;

  const { error: linkErr } = await supabase.from('outfit_items').insert(
    itemIds.map((item_id, z_index) => ({
      outfit_id: outfit.id,
      item_id,
      // Overwritten by the inherit_user_id_from_outfit trigger; sent only to
      // satisfy the not-null column on insert.
      user_id: user.user!.id,
      z_index,
    }))
  );
  if (linkErr) throw linkErr;

  return outfit.id as string;
}
