import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GarmentTile } from '@/components/garment-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useCloset, type ClosetItem } from '@/features/useCloset';
import { saveOutfit } from '@/lib/outfits';

/**
 * Two slots. That is the whole outfit builder in milestone 1.
 *
 * The point of the slice is to prove you can see two of your own garments
 * together without putting them on. Drag, z-order, free positioning and more
 * than two items are all M2+ — none of them change whether the idea works.
 *
 * Local state, no store: nothing outside this screen needs to know.
 */
export default function OutfitsScreen() {
  const { data, isLoading } = useCloset();
  const [top, setTop] = useState<ClosetItem | null>(null);
  const [bottom, setBottom] = useState<ClosetItem | null>(null);
  const [picking, setPicking] = useState<'top' | 'bottom'>('top');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = !!top && !!bottom;

  // Each slot only offers garments that belong in it. That is what makes "two
  // slots" mean top and bottom rather than any two things -- and it makes the
  // same garment in both slots impossible, since every item has one body zone.
  const candidates = (data ?? []).filter(
    (i) =>
      i.thumbUrl &&
      (picking === 'top'
        ? i.bodyZone === 'torso' || i.bodyZone === 'full_body'
        : i.bodyZone === 'legs'),
  );

  async function save() {
    if (!top || !bottom) return;
    setSaving(true);
    setError(null);
    try {
      await saveOutfit([top.id, bottom.id]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      // Previously there was no catch at all: a failure became an unhandled
      // rejection and the link quietly flipped back to "Save outfit".
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="title">Outfits</ThemedText>
        </View>

        <View style={styles.canvas}>
          <Slot
            item={top}
            label="Top"
            active={picking === 'top'}
            onPress={() => setPicking('top')}
          />
          <Slot
            item={bottom}
            label="Bottom"
            active={picking === 'bottom'}
            onPress={() => setPicking('bottom')}
          />
        </View>

        <View style={styles.pickerHeader}>
          <ThemedText type="smallBold">Pick a {picking === 'top' ? 'top' : 'bottom'}</ThemedText>
          {ready ? (
            <Pressable onPress={save} disabled={saving} accessibilityRole="button">
              <ThemedText type="link">
                {saved ? 'Saved' : saving ? 'Saving…' : 'Save outfit'}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

        {isLoading ? (
          <ActivityIndicator style={styles.pad} />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
          >
            {candidates.map((item) => (
              <Pressable
                key={item.id}
                style={styles.stripItem}
                onPress={() => (picking === 'top' ? setTop(item) : setBottom(item))}
              >
                <GarmentTile
                  uri={item.thumbUrl!}
                  category={item.category}
                  label={item.name ?? item.subcategory.replace(/_/g, ' ')}
                  priority="low"
                />
              </Pressable>
            ))}
            {candidates.length === 0 ? (
              <ThemedText style={styles.pad}>
                {data?.length
                  ? `No ${picking === 'top' ? 'tops' : 'bottoms'} yet.`
                  : 'Add some garments first.'}
              </ThemedText>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function Slot({
  item,
  label,
  active,
  onPress,
}: {
  item: ClosetItem | null;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.slot, active && styles.slotActive]} onPress={onPress}>
      {item?.thumbUrl ? (
        <GarmentTile uri={item.thumbUrl} category={item.category} />
      ) : (
        <View style={styles.slotEmpty}>
          <ThemedText type="small">{label}</ThemedText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.three },
  canvas: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  slot: { flex: 1, borderRadius: 20, justifyContent: 'center' },
  slotActive: { borderWidth: 2, borderColor: '#111', padding: 2 },
  slotEmpty: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(127,127,127,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  strip: { paddingHorizontal: Spacing.four, gap: Spacing.two, paddingBottom: Spacing.four },
  stripItem: { width: 96 },
  pad: { padding: Spacing.four },
  error: { color: '#C62828', paddingHorizontal: Spacing.four, paddingBottom: Spacing.two },
});
