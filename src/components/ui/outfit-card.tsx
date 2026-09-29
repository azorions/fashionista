import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { GarmentThumb } from '@/components/garment-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import type { Garment } from '@/domain/styling/types';

type CardGarment = Garment & { thumbUrl?: string | null; thumbPath?: string | null };

/** Outside in, top down: how you would put it on, read left to right. */
const ORDER: Record<string, number> = {
  outer: 0,
  mid: 1,
  base: 2,
  full_body: 2,
  overbottom: 3,
  bottom: 4,
  footwear: 5,
  accessory: 6,
};

/**
 * The piece the outfit is built around: its dress, else its base top, else
 * any top -- a hand-built sweater and jeans has no base layer at all.
 */
const anchorOf = (items: CardGarment[]) =>
  (
    items.find((g) => g.bodyZone === 'full_body') ??
    items.find((g) => g.layerRole === 'base') ??
    items.find((g) => g.bodyZone === 'torso') ??
    items[0]
  )?.id;

interface Props {
  items: CardGarment[];
  title?: string;
  /** The one-line reason. */
  why?: string;
  /** Actions: save, delete, and so on. */
  children?: ReactNode;
}

/**
 * One outfit: the anchor large, the rest beside it in wearing order.
 */
export function OutfitCard({ items, title, why, children }: Props) {
  const anchorId = anchorOf(items);
  const anchor = items.find((g) => g.id === anchorId);
  const rest = items
    .filter((g) => g.id !== anchorId)
    .sort((a, b) => (ORDER[a.layerRole] ?? 9) - (ORDER[b.layerRole] ?? 9));

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {title ? <ThemedText type="smallBold">{title}</ThemedText> : null}
      <View style={styles.pieces}>
        {anchor ? (
          <View style={styles.anchor}>
            <GarmentThumb garment={anchor} />
          </View>
        ) : null}
        <View style={styles.rest}>
          {rest.map((g) => (
            <View key={g.id} style={styles.small}>
              <GarmentThumb garment={g} />
            </View>
          ))}
        </View>
      </View>
      {why ? (
        <ThemedText type="small" themeColor="textSecondary">
          {why}
        </ThemedText>
      ) : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two },
  pieces: { flexDirection: 'row', gap: Spacing.two },
  anchor: { flex: 1 },
  rest: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    alignContent: 'flex-start',
  },
  // Two to a row, leaving room for the gap so they never wrap early.
  small: { width: '47%' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.three,
    alignItems: 'center',
  },
});
