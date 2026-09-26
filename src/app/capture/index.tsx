import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COACH_LINES, retakeMessage, scoreCapture } from '@/domain/quality/score';
import type { QualityVerdict } from '@/domain/quality/types';
import { analyzeStill } from '@/lib/imageIo';
import { useCaptureStore } from '@/stores/captureStore';

/**
 * The capture screen.
 *
 * NO LIVE QUALITY WARNINGS YET, deliberately. Reading preview pixels before
 * the shutter depends on GLView.createCameraTextureAsync(), which is spike 1
 * and has not been run on a device. Building on it now would mean either
 * shipping something unverified or writing it twice.
 *
 * What ships instead is the guaranteed-working half: a framing guide, rotating
 * coaching copy, and a post-shutter gate that offers a retake in ~200ms while
 * the garment is still in your hands. That is the difference between "warn
 * before you shoot" and "retake right after" — annoying, not broken.
 *
 * If /spikes/camera-texture reports PASS, graft its loop in here as a banner
 * above the shutter. If it reports FAIL, this screen is already the final
 * design and nothing needs to change.
 */

const GUIDE = { widthPct: 0.78, aspect: 3 / 4 };

export default function CaptureScreen() {
  const router = useRouter();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<{ verdict: QualityVerdict; uri: string } | null>(null);
  const [coach, setCoach] = useState(0);
  const shot = useCaptureStore((s) => s.shot);

  useEffect(() => {
    const t = setInterval(() => setCoach((i) => (i + 1) % COACH_LINES.length), 4000);
    return () => clearInterval(t);
  }, []);

  const proceed = useCallback(
    (uri: string, verdict: QualityVerdict, metrics: Parameters<typeof shot>[1]) => {
      shot(uri, metrics, verdict);
      setRejected(null);
      router.push('/capture/review');
    },
    [router, shot]
  );

  const onShutter = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const photo = await camera.current?.takePictureAsync({ quality: 0.9, skipProcessing: false });
      if (!photo?.uri) return;

      // Gate BEFORE upload: a bad shot costs nothing here, and costs an upload
      // plus an inference call one step later.
      const metrics = await analyzeStill(photo.uri);
      const verdict = scoreCapture(metrics);

      if (verdict.pass) proceed(photo.uri, verdict, metrics);
      else setRejected({ verdict, uri: photo.uri });
    } catch {
      // A capture that throws is not worth a modal; the shutter is right there.
    } finally {
      setBusy(false);
    }
  }, [busy, proceed]);

  if (!permission) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.centre}>
        <Text style={styles.permTitle}>Fashionista needs the camera</Text>
        <Text style={styles.permBody}>
          Photographs stay in your own closet. Nobody else can see them.
        </Text>
        <Pressable style={styles.primary} onPress={requestPermission}>
          <Text style={styles.primaryLabel}>Allow camera</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView ref={camera} style={styles.fill} facing="back" />

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.header}>Add a garment</Text>

        {/* Corner ticks, not a full box: a complete border reads as a crop
            frame and people shoot far too tight. */}
        <View style={styles.guideWrap} pointerEvents="none">
          <View style={styles.guide}>
            <View style={[styles.tick, styles.tl]} />
            <View style={[styles.tick, styles.tr]} />
            <View style={[styles.tick, styles.bl]} />
            <View style={[styles.tick, styles.br]} />
          </View>
        </View>

        <View style={styles.bottom} pointerEvents="box-none">
          {rejected ? (
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>
                {retakeMessage(rejected.verdict.primaryIssue) ?? 'That one came out rough.'}
              </Text>
              <View style={styles.sheetRow}>
                <Pressable style={styles.primary} onPress={() => setRejected(null)}>
                  <Text style={styles.primaryLabel}>Retake</Text>
                </Pressable>
                <Pressable
                  style={styles.secondary}
                  onPress={() => {
                    // Always available. The scorer does not know this hem is
                    // genuinely fringed, or that this is the only photo you
                    // will ever get of a borrowed coat.
                    const r = rejected;
                    setRejected(null);
                    analyzeStill(r.uri).then((m) => proceed(r.uri, r.verdict, m));
                  }}>
                  <Text style={styles.secondaryLabel}>Use it anyway</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Text style={styles.coach}>{COACH_LINES[coach]}</Text>
          )}

          <Pressable
            style={[styles.shutter, busy && styles.dim]}
            onPress={onShutter}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            accessibilityState={{ disabled: busy, busy }}>
            {busy ? <ActivityIndicator color="#111" /> : <View style={styles.shutterInner} />}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const TICK = 26;
const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
  },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  permTitle: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  permBody: { fontSize: 14, opacity: 0.7, textAlign: 'center', marginBottom: 8 },

  header: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center', paddingTop: 12 },

  guideWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  guide: {
    width: `${GUIDE.widthPct * 100}%`,
    aspectRatio: GUIDE.aspect,
  },
  tick: { position: 'absolute', width: TICK, height: TICK, borderColor: 'rgba(255,255,255,0.9)' },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },

  bottom: { paddingBottom: 24, paddingHorizontal: 16, gap: 16, alignItems: 'center' },
  coach: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },

  sheet: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  sheetTitle: { color: '#fff', fontSize: 15, lineHeight: 21 },
  sheetRow: { flexDirection: 'row', gap: 10 },

  primary: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  primaryLabel: { color: '#111', fontWeight: '600' },
  secondary: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  secondaryLabel: { color: '#fff' },

  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  dim: { opacity: 0.5 },
});
