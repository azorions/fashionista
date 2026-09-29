import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GarmentThumb } from '@/components/garment-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { ChipRow } from '@/components/ui/chip';
import { OutfitCard } from '@/components/ui/outfit-card';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { VIBES } from '@/domain/styling/vibes';
import { useCloset, type ClosetItem } from '@/features/useCloset';
import { useOutfits, type SavedOutfit } from '@/features/useOutfits';
import { useTheme } from '@/hooks/use-theme';
import { deleteOutfit, saveOutfit } from '@/lib/outfits';

type Mode = 'saved' | 'build';
const MODES = [
  { value: 'saved', label: 'Saved' },
  { value: 'build', label: 'Build your own' },
] as const;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const nameOf = (g: ClosetItem) => g.name ?? g.subcategory.replace(/_/g, ' ');

export default function OutfitsScreen() {
  const { data } = useOutfits();
  const [mode, setMode] = useState<Mode | null>(null);

  // Decided once, when the list first arrives. Re-deriving it every render
  // would yank you out of the builder the moment Style saved an outfit.
  if (mode === null && data) setMode(data.length ? 'saved' : 'build');

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={[styles.fill, styles.column]} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="title">Outfits</ThemedText>
          <ChipRow options={MODES} selected={mode} onToggle={setMode} />
        </View>

        {/* Kept mounted while hidden, so a half-built outfit survives a peek at Saved. */}
        <View style={[styles.fill, mode !== 'build' && styles.hidden]}>
          <Builder />
        </View>
        {mode !== 'build' ? <SavedList /> : null}
      </SafeAreaView>
    </ThemedView>
  );
}

function SavedList() {
  const { data, error, refetch } = useOutfits();

  if (data?.length) {
    return (
      <FlatList
        data={data}
        keyExtractor={(o) => o.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <SavedCard outfit={item} />}
      />
    );
  }
  return (
    <View style={styles.centre}>
      {data ? (
        <ThemedText themeColor="textSecondary" style={styles.centred}>
          No saved outfits yet. Save one from Style, or build your own.
        </ThemedText>
      ) : error ? (
        <>
          <ThemedText themeColor="danger">Could not load your outfits.</ThemedText>
          <Button variant="text" label="Try again" onPress={() => refetch()} />
        </>
      ) : (
        <ActivityIndicator />
      )}
    </View>
  );
}

function SavedCard({ outfit }: { outfit: SavedOutfit }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title =
    outfit.name ??
    (outfit.source === 'suggested' ? (VIBES[outfit.vibe ?? '']?.label ?? 'Suggested') : 'Your own');

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteOutfit(outfit.id);
      // Gone at once, rather than after a refetch that re-signs every thumb.
      qc.setQueryData<SavedOutfit[]>(['outfits'], (old) => old?.filter((o) => o.id !== outfit.id));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
    // Either way: a "no longer exists" failure means the card is a ghost.
    qc.invalidateQueries({ queryKey: ['outfits'] });
  }

  return (
    <OutfitCard items={outfit.items} title={title}>
      {error ? (
        <ThemedText type="small" themeColor="danger" style={styles.cardError}>
          {error}
        </ThemedText>
      ) : null}
      <Button
        variant="text"
        destructive
        label="Delete"
        busy={busy}
        accessibilityHint="Deletes this outfit. The garments stay in your closet."
        style={styles.cardAction}
        onPress={() => confirmDelete(remove)}
      />
    </OutfitCard>
  );
}

function confirmDelete(onYes: () => void) {
  const title = 'Delete this outfit?';
  const message = 'The garments stay in your closet.';
  // Alert.alert does nothing on react-native-web.
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n${message}`)) onYes();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onYes },
  ]);
}

/**
 * Two slots. That is the whole outfit builder in milestone 1.
 *
 * The point of the slice is to prove you can see two of your own garments
 * together without putting them on. Drag, z-order, free positioning and more
 * than two items are all M2+ — none of them change whether the idea works.
 *
 * Local state, no store: nothing outside this screen needs to know.
 */
function Builder() {
  const qc = useQueryClient();
  const { data, error: loadError, refetch } = useCloset();
  // Ids, not items: read back from the closet each render, so a re-signed
  // thumb URL or a garment deleted elsewhere never goes stale in a slot.
  const [topId, setTopId] = useState<string | null>(null);
  const [bottomId, setBottomId] = useState<string | null>(null);
  const [picking, setPicking] = useState<'top' | 'bottom'>('top');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State lands a render late; two taps in one frame would both see saving=false.
  const savingRef = useRef(false);

  const top = data?.find((i) => i.id === topId) ?? null;
  const bottom = data?.find((i) => i.id === bottomId) ?? null;
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
    if (!top || !bottom || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await saveOutfit([top.id, bottom.id]);
      // A clean slate for the next one; the Saved list picks this one up.
      setTopId(null);
      setBottomId(null);
      setPicking('top');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      qc.invalidateQueries({ queryKey: ['outfits'] });
    } catch (e) {
      // Previously there was no catch at all: a failure became an unhandled
      // rejection and the link quietly flipped back to "Save outfit".
      setError(errorText(e));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <View style={styles.fill}>
      <View style={styles.canvas}>
        <Slot item={top} label="Top" active={picking === 'top'} onPress={() => setPicking('top')} />
        <Slot
          item={bottom}
          label="Bottom"
          active={picking === 'bottom'}
          onPress={() => setPicking('bottom')}
        />
      </View>

      <View style={styles.pickerHeader}>
        <ThemedText type="smallBold">Pick a {picking}</ThemedText>
        {ready ? (
          <Button label="Save outfit" onPress={save} busy={saving} />
        ) : saved ? (
          <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
            Saved
          </ThemedText>
        ) : null}
      </View>

      {error ? (
        <ThemedText themeColor="danger" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}

      {data ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // A horizontal ScrollView grows by default: it took half the free
          // height from the canvas and the tiles overflowed their slots.
          style={styles.stripBar}
          contentContainerStyle={styles.strip}
        >
          {candidates.map((item) => {
            const chosen = item.id === (picking === 'top' ? topId : bottomId);
            return (
              <Pressable
                key={item.id}
                style={styles.stripItem}
                onPress={() => (picking === 'top' ? setTopId(item.id) : setBottomId(item.id))}
                accessibilityRole="button"
                accessibilityLabel={nameOf(item)}
                accessibilityState={{ selected: chosen }}
              >
                <GarmentThumb garment={item} />
              </Pressable>
            );
          })}
          {candidates.length === 0 ? (
            <ThemedText themeColor="textSecondary" style={styles.pad}>
              {data.length
                ? `No ${picking === 'top' ? 'tops' : 'bottoms'} yet.`
                : 'Add some garments first.'}
            </ThemedText>
          ) : null}
        </ScrollView>
      ) : loadError ? (
        <View style={styles.pad}>
          <ThemedText themeColor="danger">Could not load your closet.</ThemedText>
          <Button variant="text" label="Try again" onPress={() => refetch()} />
        </View>
      ) : (
        <ActivityIndicator style={styles.pad} />
      )}
    </View>
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
  const theme = useTheme();
  return (
    <Pressable
      style={[styles.slot, active && { borderColor: theme.text }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${item ? nameOf(item) : 'empty'}`}
      accessibilityState={{ selected: active }}
      accessibilityHint={`Pick the ${label.toLowerCase()} from the row below`}
    >
      {item ? (
        <GarmentThumb garment={item} />
      ) : (
        <View style={styles.slotEmpty}>
          <ThemedText type="small" themeColor="textSecondary">
            {label}
          </ThemedText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  hidden: { display: 'none' },
  header: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.three, gap: Spacing.three },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  centred: { textAlign: 'center' },

  list: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.four, gap: Spacing.three },
  cardError: { flex: 1 },
  cardAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.two },

  canvas: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  // The border is always there, only its colour changes, so picking a slot
  // does not shrink the tile inside it by the border's width.
  slot: {
    flex: 1,
    borderRadius: Radius.card + 4,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 2,
    justifyContent: 'center',
  },
  slotEmpty: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: Radius.card,
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
    minHeight: 48,
    paddingHorizontal: Spacing.four,
    marginBottom: Spacing.two,
  },
  stripBar: { flexGrow: 0, flexShrink: 0 },
  strip: { paddingHorizontal: Spacing.four, gap: Spacing.two, paddingBottom: Spacing.four },
  stripItem: { width: 96 },
  pad: { padding: Spacing.four },
  error: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.two },
});
