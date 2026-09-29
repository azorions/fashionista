import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { ColourSwatches, humanize } from '@/components/garment-form';
import { GarmentThumb, GarmentTile } from '@/components/garment-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useGarment } from '@/features/useCloset';
import { discardCapture, fetchSubcategories, signed } from '@/lib/capturePipeline';

/** One garment: the full tile, what it is, and what to do with it. */
export default function GarmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: item, isLoading, error, refetch } = useGarment(id);
  const { data: subs } = useQuery({
    queryKey: ['subcategories'],
    queryFn: fetchSubcategories,
    staleTime: Infinity, // reference data; it changes only via a migration
  });

  // The closet only signs the 256px thumb. The full tile is signed here, keyed
  // on its path so reopening the page reuses the URL, and re-signed before the
  // hour-long signature lapses.
  const tilePath = item?.tilePath ?? null;
  const { data: tileUrl } = useQuery({
    queryKey: ['tile', tilePath],
    queryFn: () => signed(tilePath!),
    staleTime: 50 * 60_000,
    enabled: !!tilePath,
  });

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // The Alert callback closes over a stale `deleting`; a ref sees a second tap.
  const deletingNow = useRef(false);

  if (isLoading) {
    return (
      <ThemedView style={styles.centre}>
        <ActivityIndicator />
      </ThemedView>
    );
  }
  if (error) {
    return (
      <ThemedView style={styles.centre}>
        <ThemedText themeColor="danger">Could not load this garment.</ThemedText>
        <Button
          variant="text"
          label="Try again"
          onPress={() => refetch()}
          style={styles.textButton}
        />
      </ThemedView>
    );
  }
  if (!item) {
    return (
      <ThemedView style={styles.centre}>
        <ThemedText>This garment is gone.</ThemedText>
        <Button
          variant="text"
          label="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={styles.textButton}
        />
      </ThemedView>
    );
  }

  const kind = subs?.find((s) => s.code === item.subcategory)?.label ?? humanize(item.subcategory);
  const name = item.name ?? kind;
  const typeLabel = [item.name ? kind : null, humanize(item.category)].filter(Boolean).join(' · ');

  const details = [
    ['Warmth', `${item.warmth}/5`],
    ['Formality', `${item.formality}/5`],
    ['Material', item.materials.map(humanize).join(', ')],
    [
      'Pattern',
      item.pattern === 'solid' ? 'Solid' : `${humanize(item.pattern)}, ${item.patternScale}`,
    ],
    ['Finish', humanize(item.sheen)],
    ['Vibe tags', item.styleTags.map((t) => humanize(t.tag)).join(', ')],
  ].filter(([, value]) => value);

  async function remove() {
    if (deletingNow.current) return;
    deletingNow.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      await discardCapture(id);
      // Not awaited: the delete has already happened. The outfits query goes
      // too, because a DB trigger drops saved outfits left under two garments.
      qc.invalidateQueries({ queryKey: ['closet'] });
      qc.invalidateQueries({ queryKey: ['outfits'] });
      // Opened directly (a web refresh), there is nothing to go back to, and
      // back() left the Delete spinner running on a garment that is gone.
      if (router.canGoBack()) router.back();
      else router.replace('/');
      // Removed, not invalidated: a refetch could only find nothing.
      qc.removeQueries({ queryKey: ['garment', id] });
    } catch (e) {
      deletingNow.current = false;
      setDeleting(false);
      setDeleteError(`Could not delete: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function confirmDelete() {
    const title = `Delete ${name}?`;
    const body = 'Outfits that need it will be removed too.';
    // Alert.alert is a no-op on react-native-web.
    if (Platform.OS === 'web') {
      if (window.confirm(`${title} ${body}`)) remove();
      return;
    }
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: remove },
    ]);
  }

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ title: name }} />
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.tile}>
          {tileUrl && tilePath ? (
            <GarmentTile
              uri={tileUrl}
              cacheKey={tilePath}
              category={item.category}
              label={name}
              priority="high"
            />
          ) : (
            // Still signing, or no tile yet: the cached thumb, else its colour.
            <GarmentThumb garment={item} />
          )}
        </View>

        <View>
          <ThemedText type="subtitle">{name}</ThemedText>
          <ThemedText themeColor="textSecondary">{typeLabel}</ThemedText>
        </View>

        {item.palette.length > 0 ? <ColourSwatches palette={item.palette} /> : null}

        <ThemedView type="backgroundElement" style={styles.details}>
          {details.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <ThemedText type="small" themeColor="textSecondary">
                {label}
              </ThemedText>
              <ThemedText type="small" style={styles.value}>
                {value}
              </ThemedText>
            </View>
          ))}
        </ThemedView>

        <View style={styles.actions}>
          {/* The engine has no slot for accessories, and the Style tab leaves out
              garments with no tile or no type yet -- a lock on any of those
              would only ever produce "nothing goes with this". */}
          {item.category !== 'accessory' && item.subcategory !== 'unknown' && item.thumbPath ? (
            <Button
              label="Style around this"
              // dismissTo, not push: a push stacked a second copy of the whole
              // tab navigator on top of this page, with no back button, while
              // the Style tab already open underneath never got the lock.
              onPress={() => router.dismissTo({ pathname: '/style', params: { lock: id } })}
              disabled={deleting}
              accessibilityHint="Suggests outfits built around this garment"
            />
          ) : null}
          <Button
            variant="secondary"
            label="Edit details"
            onPress={() => router.push({ pathname: '/garment/[id]/edit', params: { id } })}
            disabled={deleting}
          />
          <Button
            variant="text"
            destructive
            label="Delete"
            onPress={confirmDelete}
            busy={deleting}
            accessibilityHint="Asks before deleting this garment"
            style={styles.textButton}
          />
          {deleteError ? <ThemedText themeColor="danger">{deleteError}</ThemedText> : null}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  page: {
    padding: Spacing.four,
    gap: Spacing.four,
    paddingBottom: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  // A 3:4 card at full phone width is taller than the screen on a tablet.
  tile: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  details: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  value: { flexShrink: 1, textAlign: 'right' },
  actions: { gap: Spacing.two },
  textButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
});
