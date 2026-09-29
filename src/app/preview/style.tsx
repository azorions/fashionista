import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { StylePanel } from '@/components/style-panel';
import { ThemedView } from '@/components/themed-view';
import { styleWardrobe } from '@/domain/styling/fixtures';

/** Stands in for saveOutfit; slow enough that the saving state is visible. */
const fakeSave = () => new Promise<void>((resolve) => setTimeout(resolve, 300));

/**
 * The Style screen over the fixture closet: no account, no database.
 *
 * ?vibe=winter opens on a vibe; ?lock=flannel (any fixture id) shows the lock
 * banner. The fixtures have no images, so garments draw as colour blocks.
 */
export default function StylePreview() {
  const { vibe, lock } = useLocalSearchParams<{ vibe?: string; lock?: string }>();
  const wardrobe = useMemo(() => styleWardrobe(), []);

  if (!__DEV__) return null;

  return (
    <ThemedView style={styles.fill}>
      <StylePanel
        key={vibe}
        wardrobe={wardrobe}
        initialVibe={vibe}
        lockedId={lock}
        onClearLock={() => router.setParams({ lock: undefined })}
        onSave={fakeSave}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
