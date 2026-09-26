import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GarmentTile } from '@/components/garment-tile';
import { Spacing } from '@/constants/theme';
import { retakeMessage } from '@/domain/quality/score';
import { T } from '@/domain/quality/thresholds';
import { awaitProcessed, discardCapture, startCapture } from '@/lib/capturePipeline';
import { useCaptureStore } from '@/stores/captureStore';

/**
 * Upload, wait for the cutout, and show the result on the real card.
 *
 * The score decides how loudly we mention it, and the bands matter more than
 * their exact values:
 *   >= GOOD   keep silently. Interrupting a good capture trains people to
 *             ignore the prompt.
 *   PASS..GOOD  keep by default, mention it once.
 *   < PASS    lead with retake, but never remove the choice — the scorer does
 *             not know this garment is genuinely fringed.
 */
export default function ReviewScreen() {
  const router = useRouter();
  const { localUri, metrics, verdict, itemId, tileUrl, maskVerdict, started, processed, reset } =
    useCaptureStore();

  const [error, setError] = useState<string | null>(null);

  // Derived, not stored: we are working exactly while there is no tile and no
  // error. Storing it would mean a setState inside the effect, which triggers
  // a cascading render (and react-hooks/set-state-in-effect, correctly).
  const working = !tileUrl && !error;

  useEffect(() => {
    let cancelled = false;
    if (!localUri || !metrics || !verdict || tileUrl) return;

    (async () => {
      try {
        const ids = await startCapture(localUri, metrics, verdict);
        if (cancelled) return;
        started(ids.itemId, ids.imageId);

        const done = await awaitProcessed(ids.imageId);
        if (cancelled) return;
        processed(done.tileUrl, done.maskVerdict);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [localUri, metrics, verdict, tileUrl, started, processed]);

  async function retake() {
    if (itemId) await discardCapture(itemId);
    reset();
    router.back();
  }

  if (!localUri) {
    return (
      <ThemedView style={styles.centre}>
        <ThemedText>Nothing to review.</ThemedText>
      </ThemedView>
    );
  }

  const score = maskVerdict?.score ?? 0;
  const note =
    !maskVerdict || score >= T.GATE_GOOD
      ? null
      : score >= T.GATE_PASS
        ? 'Saved. The edges are a bit rough — retake?'
        : (retakeMessage(maskVerdict.primaryIssue) ?? 'This one came out rough.');

  return (
    <ThemedView style={styles.page}>
      <View style={styles.stage}>
        {working ? (
          <View style={styles.pending}>
            {/* The source photo under a shimmer, so there is something to look
                at for the ~5s the cutout takes. */}
            <Image source={{ uri: localUri }} style={styles.pendingImage} contentFit="contain" />
            <View style={styles.pendingVeil} />
            <ActivityIndicator />
          </View>
        ) : tileUrl ? (
          // 'top' is not a placeholder: at review time the item is still the
          // 'unknown' subcategory, whose seeded category is 'top'. Tagging
          // happens on the next screen, and the grid renders the real one.
          <GarmentTile uri={tileUrl} category="top" dimmed={score < T.GATE_PASS} />
        ) : (
          <Image source={{ uri: localUri }} style={styles.pendingImage} contentFit="contain" />
        )}
      </View>

      {error ? (
        <ThemedText style={styles.error}>{error}</ThemedText>
      ) : note ? (
        <ThemedText style={styles.note}>{note}</ThemedText>
      ) : working ? (
        <ThemedText style={styles.note}>Removing the background…</ThemedText>
      ) : (
        <ThemedText style={styles.note}>Looks good.</ThemedText>
      )}

      <View style={styles.actions}>
        <Pressable style={styles.secondary} onPress={retake} disabled={working}>
          <ThemedText>Retake</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.primary, working && styles.dim]}
          disabled={working || !!error}
          onPress={() => router.push('/capture/tag')}>
          <ThemedText style={styles.primaryLabel}>Keep</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: Spacing.four, gap: Spacing.four },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pending: { width: '100%', aspectRatio: 3 / 4, alignItems: 'center', justifyContent: 'center' },
  pendingImage: { position: 'absolute', width: '100%', height: '100%', borderRadius: 20 },
  pendingVeil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 20,
  },
  note: { textAlign: 'center', opacity: 0.8 },
  error: { textAlign: 'center', color: '#C62828' },
  actions: { flexDirection: 'row', gap: Spacing.three },
  primary: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  primaryLabel: { color: '#fff', fontWeight: '600' },
  secondary: {
    flex: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.4)',
  },
  dim: { opacity: 0.5 },
});
