import { Image } from 'expo-image';
import { StyleSheet, useColorScheme, View } from 'react-native';

import type { Category } from '@/domain/tagging/schema';

/**
 * One garment on one card.
 *
 * Most of what makes a closet grid look good is not the cutouts — it is that
 * every card is identical. Same size, same ground, same margin, same implied
 * light. Get that right and mediocre cutouts read as a set; get it wrong and
 * perfect ones read as clip art.
 */

/**
 * Stops a sock filling the same box as a trench coat.
 *
 * The stored tile is scale-neutral (the garment is fitted to 84% of a square
 * canvas, whatever it is), so absolute scale is applied at RENDER time. That
 * keeps one pixel asset usable by both the grid and the outfit canvas, which
 * want different relative sizes — and lets a bad value be fixed without
 * reprocessing a single image.
 */
export const CATEGORY_DISPLAY_SCALE: Record<Category, number> = {
  outerwear: 1.0,
  dress: 1.0,
  bottom: 0.95,
  top: 0.92,
  footwear: 0.7,
  accessory: 0.55,
};

interface Props {
  uri: string;
  category: Category;
  dimmed?: boolean;
  /** Accessible name. Without it a screen reader reads a grid of "image". */
  label?: string;
  /** Grid tiles use the small thumb; the review screen wants the full tile. */
  priority?: 'low' | 'normal' | 'high';
}

export function GarmentTile({ uri, category, dimmed, label, priority = 'normal' }: Props) {
  const dark = useColorScheme() === 'dark';
  const scale = CATEGORY_DISPLAY_SCALE[category] ?? 0.9;

  return (
    <View style={[styles.card, dark ? styles.cardDark : styles.cardLight]}>
      {/*
        Contact shadow. This single element does more for "these look like a
        set" than anything else: it gives every cutout the same implied light
        and the same implied ground plane, so they stop looking pasted on.

        Three stacked ellipses rather than a blur, because React Native has no
        cross-platform blur primitive and shadow props behave differently on
        each OS. Deterministic and dependency-free.
        ponytail: 3-step gradient; swap for a real radial blur only if it reads
        as banded on a high-DPI screen.
      */}
      <View style={styles.shadowAnchor} pointerEvents="none">
        <View style={[styles.shadow, styles.shadow3]} />
        <View style={[styles.shadow, styles.shadow2]} />
        <View style={[styles.shadow, styles.shadow1]} />
      </View>

      <Image
        accessible
        accessibilityRole="image"
        accessibilityLabel={label ?? `${category} garment`}
        source={{ uri }}
        style={[styles.garment, { transform: [{ scale }] }, dimmed && styles.dimmed]}
        contentFit="contain"
        transition={180}
        cachePolicy="memory-disk"
        recyclingKey={uri}
        priority={priority}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Warm near-white, NOT #FFFFFF. Pure white makes white garments vanish and
  // makes every cutout edge read as cut out.
  cardLight: { backgroundColor: '#F6F4F1', borderColor: 'rgba(0,0,0,0.05)' },
  cardDark: { backgroundColor: '#1B1A19', borderColor: 'rgba(255,255,255,0.07)' },

  shadowAnchor: {
    position: 'absolute',
    bottom: '8%',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  shadow: { position: 'absolute', backgroundColor: '#000' },
  shadow1: { width: '40%', height: 8, borderRadius: 4, opacity: 0.1 },
  shadow2: { width: '50%', height: 12, borderRadius: 6, opacity: 0.06 },
  shadow3: { width: '60%', height: 18, borderRadius: 9, opacity: 0.04 },

  // Inset 10% on all sides, then scaled by category.
  garment: { width: '80%', height: '80%' },
  dimmed: { opacity: 0.45 },
});
