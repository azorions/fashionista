import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GarmentTile } from '@/components/garment-tile';
import { Spacing } from '@/constants/theme';
import { retakeMessage } from '@/domain/quality/score';
import { discardCapture, markKeptDespiteWarning, runCapture } from '@/lib/capturePipeline';
import { useCaptureStore } from '@/stores/captureStore';

/**
 * Upload, wait for the cutout, and show the result on the real card.
 *
 * The verdict decides how loudly we mention it:
 *   pass, no warning   keep silently. Interrupting a good capture trains
 *                      people to ignore the prompt.
 *   pass, warning      keep by default, say what is off once.
 *   fail               lead with retake, but never remove the choice -- the
 *                      scorer does not know this garment is genuinely fringed.
 *
 * Driven by pass/warn rather than raw score, so hard failures (an empty or
 * shredded mask) are treated as failures even if the blend scores well.
 */
export default function ReviewScreen() {
  const router = useRouter();
  const {
    localUri,
    metrics,
    verdict,
    itemId,
    imageId,
    tileUrl,
    maskVerdict,
    started,
    processed,
    reset,
  } = useCaptureStore();

  const [error, setError] = useState<string | null>(null);
  // Both exits are async; a second tap used to pop straight out of the flow.
  const [leaving, setLeaving] = useState(false);

  // Derived, not stored: we are working exactly while there is no tile and no
  // error. Storing it would mean a setState inside the effect, which triggers
  // a cascading render (and react-hooks/set-state-in-effect, correctly).
  const working = !tileUrl && !error;

  useEffect(() => {
    if (!localUri || !metrics || !verdict || tileUrl) return;
    let cancelled = false;

    // runCapture runs at most once per photo, so a re-run of this effect
    // reattaches to the capture already in flight instead of starting another.
    // The ids go into the store the moment the rows exist, even if this effect
    // has since been cancelled -- that is what lets Retake clean up after a
    // failure.
    runCapture(localUri, metrics, verdict, (ids) => started(ids.itemId, ids.imageId))
      .then((done) => {
        if (!cancelled) processed(done.tileUrl, done.maskVerdict);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [localUri, metrics, verdict, tileUrl, started, processed]);

  async function retake() {
    if (leaving) return;
    setLeaving(true);
    try {
      if (itemId) await discardCapture(itemId);
      router.back();
      // After navigating, so this screen does not flash "Nothing to review"
      // during the pop animation.
      reset();
    } catch (e) {
      setLeaving(false);
      setError(`Could not discard that photo: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function keep() {
    if (leaving) return;
    // Keeping a cutout the scorer flagged is the calibration signal. Logged
    // best-effort: telemetry must never block the user from moving on.
    if (imageId && maskVerdict && (!maskVerdict.pass || maskVerdict.warn)) {
      markKeptDespiteWarning(imageId).catch(() => {});
    }
    router.push('/capture/tag');
  }

  if (!localUri) {
    return (
      <ThemedView style={styles.centre}>
        <ThemedText>Nothing to review.</ThemedText>
      </ThemedView>
    );
  }

  const failed = !!maskVerdict && !maskVerdict.pass;
  // The specific issue, not a generic line: a tight crop used to be told "the
  // edges are a bit rough", which is not what was wrong with it.
  const note =
    !maskVerdict || (maskVerdict.pass && !maskVerdict.warn)
      ? null
      : (retakeMessage(maskVerdict.primaryIssue) ??
        (failed ? 'This one came out rough.' : 'The edges are a bit rough — retake?'));

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
          <GarmentTile uri={tileUrl} category="top" dimmed={failed} />
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
        <Pressable
          style={[styles.secondary, leaving && styles.dim]}
          onPress={retake}
          disabled={working || leaving}
          accessibilityRole="button">
          <ThemedText>Retake</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.primary, (working || leaving) && styles.dim]}
          disabled={working || leaving || !!error}
          onPress={keep}
          accessibilityRole="button">
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
