import { useQuery } from '@tanstack/react-query';

import { rowToGarment, type WardrobeItemWithTags } from '@/domain/garment/row';
import { supabase } from '@/lib/supabase';
import type { Garment } from '@/domain/styling/types';

/**
 * Reading the closet.
 *
 * PostgREST resource embedding rather than a database view, deliberately: a
 * view runs with its owner's privileges and silently bypasses RLS unless it is
 * created with security_invoker, which is the single most dangerous footgun in
 * this schema. An embedded select respects RLS with nothing to remember.
 */

export interface ClosetItem extends Garment {
  /** Signed URL for the 256px thumb, or null while the cutout is still running. */
  thumbUrl: string | null;
  /** Storage paths. Stable across refetches, unlike signed URLs: use as cache keys. */
  thumbPath: string | null;
  tilePath: string | null;
}

export type ClosetRow = WardrobeItemWithTags & {
  cover: { thumb_path: string | null; tile_path: string | null; status: string } | null;
};

/** A wardrobe_items select with cover image and style tags. Embeddable: `item:wardrobe_items(${CLOSET_SELECT})`. */
export const CLOSET_SELECT =
  '*, cover:item_images!wardrobe_items_cover_fk(thumb_path, tile_path, status), tags:item_style_tags(tag_code, weight)';

/** One round trip for N urls instead of N. */
async function signMany(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;

  const { data, error } = await supabase.storage.from('wardrobe').createSignedUrls(paths, 3600);
  // This error used to be discarded. One failure -- an expired session, a
  // missing storage policy -- left every thumbUrl null, so the whole closet
  // rendered as spinners with no error state reachable. Fail the query.
  if (error) throw error;
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) out.set(entry.path, entry.signedUrl);
  }
  return out;
}

/** Rows to closet items, signing every thumb in one round trip. */
export async function toClosetItems(rows: ClosetRow[]): Promise<ClosetItem[]> {
  const paths = rows.map((r) => r.cover?.thumb_path).filter((p): p is string => !!p);
  const urls = await signMany(paths);

  return rows.map((row) => ({
    ...rowToGarment(row),
    thumbUrl: row.cover?.thumb_path ? (urls.get(row.cover.thumb_path) ?? null) : null,
    thumbPath: row.cover?.thumb_path ?? null,
    tilePath: row.cover?.tile_path ?? null,
  }));
}

export function useCloset() {
  return useQuery({
    queryKey: ['closet'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wardrobe_items')
        .select(CLOSET_SELECT)
        .eq('archived', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return toClosetItems((data ?? []) as unknown as ClosetRow[]);
    },
  });
}

export function useGarment(id: string | null) {
  return useQuery({
    queryKey: ['garment', id],
    enabled: !!id,
    queryFn: async (): Promise<ClosetItem | null> => {
      // maybeSingle: an item that has been deleted is a normal outcome here,
      // not an error. .single() threw PGRST116 at the tag screen instead.
      const { data, error } = await supabase
        .from('wardrobe_items')
        .select(CLOSET_SELECT)
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return (await toClosetItems([data as unknown as ClosetRow]))[0];
    },
  });
}
