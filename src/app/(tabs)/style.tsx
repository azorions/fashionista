import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StylePanel } from '@/components/style-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import type { ScoredOutfit } from '@/domain/styling/types';
import { useCloset } from '@/features/useCloset';
import { saveOutfit } from '@/lib/outfits';

/**
 * The Style tab: the closet, run through the engine.
 *
 * ?lock=<id> styles around one garment (the garment screen links here);
 * ?vibe=<id> opens on a vibe.
 */
export default function StyleScreen() {
  const qc = useQueryClient();
  const { lock, vibe } = useLocalSearchParams<{ lock?: string; vibe?: string }>();
  const { data, isLoading, error, refetch } = useCloset();

  // A garment with no tile yet cannot be drawn in an outfit, so it is not
  // offered. Memoised: a fresh array every render would rerun the engine on
  // every render.
  const wardrobe = useMemo(
    () => (data ?? []).filter((i) => i.thumbPath && i.subcategory !== 'unknown'),
    [data],
  );

  async function save(outfit: ScoredOutfit, vibeId: string) {
    await saveOutfit(
      outfit.items.map((i) => i.id),
      { source: 'suggested', vibe: vibeId },
    );
    // Not awaited: the save has succeeded, and the button should say so now.
    qc.invalidateQueries({ queryKey: ['outfits'] });
  }

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="title">Style</ThemedText>
        </View>

        {isLoading ? (
          <View style={styles.centre}>
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View style={styles.centre}>
            <ThemedText themeColor="danger">Could not load your closet.</ThemedText>
            <Button variant="text" label="Try again" onPress={() => refetch()} />
          </View>
        ) : (
          <StylePanel
            // A new ?vibe= from a link starts the panel over on that vibe.
            key={vibe}
            wardrobe={wardrobe}
            initialVibe={vibe}
            lockedId={lock}
            onClearLock={() => router.setParams({ lock: undefined })}
            onSave={save}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.three },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
});
