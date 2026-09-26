import { useQuery } from '@tanstack/react-query';

import { rowToGarment, type WardrobeItemRow } from '@/lib/garmentRow';
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
}

type Row = WardrobeItemRow & {
  cover: { thumb_path: string | null; tile_path: string | null; status: string } | null;
};

const SELECT = '*, cover:item_images!wardrobe_items_cover_fk(thumb_path, tile_path, status)';

/** One round trip for N urls instead of N. */
async function signMany(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;

  const { data } = await supabase.storage.from('wardrobe').createSignedUrls(paths, 3600);
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) out.set(entry.path, entry.signedUrl);
  }
  return out;
}

async function toClosetItems(rows: Row[]): Promise<ClosetItem[]> {
  const paths = rows.map((r) => r.cover?.thumb_path).filter((p): p is string => !!p);
  const urls = await signMany(paths);

  return rows.map((row) => ({
    ...rowToGarment(row),
    thumbUrl: row.cover?.thumb_path ? (urls.get(row.cover.thumb_path) ?? null) : null,
  }));
}

export function useCloset() {
  return useQuery({
    queryKey: ['closet'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wardrobe_items')
        .select(SELECT)
        .eq('archived', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return toClosetItems((data ?? []) as unknown as Row[]);
    },
  });
}

export function useGarment(id: string | null) {
  return useQuery({
    queryKey: ['garment', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wardrobe_items')
        .select(SELECT)
        .eq('id', id!)
        .single();
      if (error) throw error;
      return (await toClosetItems([data as unknown as Row]))[0];
    },
  });
}
