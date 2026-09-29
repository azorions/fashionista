import { useQuery } from '@tanstack/react-query';

import {
  CLOSET_SELECT,
  toClosetItems,
  type ClosetItem,
  type ClosetRow,
} from '@/features/useCloset';
import { supabase } from '@/lib/supabase';

/**
 * Reading saved outfits.
 *
 * Embedded selects, not a view, for the same reason as the closet: a view
 * bypasses RLS unless created with security_invoker. Embedding respects it
 * with nothing to remember.
 */

export interface SavedOutfit {
  id: string;
  name: string | null;
  source: 'manual' | 'suggested';
  vibe: string | null;
  createdAt: string;
  /** In stacking order (z_index). */
  items: ClosetItem[];
}

type OutfitRow = Omit<SavedOutfit, 'createdAt' | 'items'> & {
  created_at: string;
  // Null when RLS or a concurrent delete hides the garment.
  items: { z_index: number; item: ClosetRow | null }[];
};

export function useOutfits() {
  return useQuery({
    queryKey: ['outfits'],
    queryFn: async (): Promise<SavedOutfit[]> => {
      const { data, error } = await supabase
        .from('outfits')
        .select(
          `id, name, source, vibe, created_at, items:outfit_items(z_index, item:wardrobe_items(${CLOSET_SELECT}))`,
        )
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as OutfitRow[];

      // Every garment of every outfit through ONE signing round trip, not one
      // per outfit. Deduped, since the same shirt turns up in many outfits.
      const unique = new Map<string, ClosetRow>();
      for (const o of rows) for (const i of o.items) if (i.item) unique.set(i.item.id, i.item);
      const byId = new Map((await toClosetItems([...unique.values()])).map((g) => [g.id, g]));

      return rows.map((o) => ({
        id: o.id,
        name: o.name,
        source: o.source,
        vibe: o.vibe,
        createdAt: o.created_at,
        items: o.items
          .sort((a, b) => a.z_index - b.z_index)
          .flatMap((i) => {
            const g = i.item && byId.get(i.item.id);
            return g ? [g] : [];
          }),
      }));
    },
  });
}
