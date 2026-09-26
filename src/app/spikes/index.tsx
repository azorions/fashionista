import { Link } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

/**
 * Day-one spikes.
 *
 * Both of these test an assumption the whole capture pipeline rests on, and
 * neither can be verified from a desktop — they need Hermes and a real camera.
 * Run them before building anything on top.
 */
const SPIKES = [
  {
    href: '/spikes/camera-texture' as const,
    title: '1 · Live camera pixels',
    blocking: true,
    what: 'GLView.createCameraTextureAsync() + readPixels at 3 Hz',
    why: 'The only way to get pre-shutter pixel data inside Expo Go. If this fails, live quality warnings are cut and the gate becomes post-shutter only.',
  },
  {
    href: '/spikes/fast-png' as const,
    title: '2 · fast-png under Hermes',
    blocking: false,
    what: 'Decode a PNG to RGBA in pure JS',
    why: 'fast-png is ESM-only with no CommonJS build. If Metro cannot resolve it, palette extraction moves server-side.',
  },
];

export default function SpikesIndex() {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.intro}>
        Each spike answers one question with a real device. Run both before writing pipeline code.
      </Text>
      {SPIKES.map((s) => (
        <Link key={s.href} href={s.href} style={styles.card}>
          <View>
            <Text style={styles.title}>{s.title}</Text>
            <Text style={styles.badge}>{s.blocking ? 'BLOCKING' : 'has a cheap fallback'}</Text>
            <Text style={styles.what}>{s.what}</Text>
            <Text style={styles.why}>{s.why}</Text>
          </View>
        </Link>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  intro: { fontSize: 14, opacity: 0.7, marginBottom: 4 },
  card: { borderWidth: 1, borderColor: 'rgba(127,127,127,0.35)', borderRadius: 14, padding: 14 },
  title: { fontSize: 17, fontWeight: '600', marginBottom: 4 },
  badge: { fontSize: 11, fontWeight: '700', opacity: 0.55, marginBottom: 6 },
  what: { fontSize: 13, fontFamily: 'monospace', marginBottom: 6 },
  why: { fontSize: 13, opacity: 0.75, lineHeight: 18 },
});
