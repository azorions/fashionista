import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';

import { extractPalette, type Swatch } from '@/domain/color/palette';
import { oklchToRgb, rgbToHex } from '@/domain/color/oklab';

/**
 * SPIKE 2 — can we decode PNG pixels in pure JS, on the phone?
 *
 * fast-png is ESM-only ("type": "module", no CommonJS build). Metro's
 * package-exports resolution SHOULD handle that on SDK 57, but "should" is not
 * "does", and the whole on-device palette path depends on it.
 *
 * PASS -> palette extraction can run on-device, so a cutout can be analysed
 *         without a round trip.
 * FAIL -> move palette extraction into the Edge Function next to the cutout.
 *         Deno handles ESM natively, so the code moves unchanged. This is a
 *         cheap fallback, which is why this spike is not blocking.
 *
 * Note the test image is generated in-process rather than shipped as an asset:
 * that keeps the spike self-contained and lets us assert on known pixel values.
 */

// A 2x2 PNG: red, green / blue, transparent. Hand-built so the expected decode
// is known exactly. (base64 of a minimal 8-bit RGBA non-interlaced PNG)
const TEST_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGUlEQVR4AWP8z8DwnwEJMDEgAbgAXAYGABlbAQfS6De/AAAAAElFTkSuQmCC';

type Step = { label: string; ok: boolean; detail: string };

type DecodeFn = (bytes: Uint8Array) => {
  width: number;
  height: number;
  data: ArrayLike<number>;
  channels: number;
};

export default function FastPngSpike() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [palette, setPalette] = useState<Swatch[] | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setSteps([]);
    setPalette(null);
    const out: Step[] = [];
    const push = (s: Step) => {
      out.push(s);
      setSteps([...out]);
    };

    // 1. Can Metro even resolve the ESM-only package under Hermes?
    let decode: DecodeFn | null = null;
    try {
      const mod = await import('fast-png');
      decode = mod.decode as unknown as DecodeFn;
      push({ label: 'import fast-png', ok: !!decode, detail: typeof decode });
    } catch (e) {
      push({ label: 'import fast-png', ok: false, detail: String(e) });
      setRunning(false);
      return;
    }

    // 2. Does expo-image-manipulator round-trip to base64 PNG?
    let base64: string | undefined;
    try {
      const ctx = ImageManipulator.manipulate(TEST_PNG_DATA_URI).resize({ width: 16 });
      const img = await ctx.renderAsync();
      const saved = await img.saveAsync({ format: SaveFormat.PNG, base64: true });
      base64 = saved.base64;
      push({
        label: 'expo-image-manipulator -> base64 PNG',
        ok: !!base64,
        detail: `${base64?.length ?? 0} chars`,
      });
    } catch (e) {
      push({ label: 'expo-image-manipulator -> base64 PNG', ok: false, detail: String(e) });
      setRunning(false);
      return;
    }

    // 3. Does the decode actually produce sane pixels?
    try {
      const bytes = Uint8Array.from(atob(base64!), (c) => c.charCodeAt(0));
      const png = decode!(bytes);
      const ok = png.width > 0 && png.height > 0 && png.data.length > 0;
      push({
        label: 'decode to RGBA',
        ok,
        detail: `${png.width}x${png.height}, ${png.channels}ch, ${png.data.length} bytes`,
      });

      // 4. End to end: feed real decoded pixels through palette extraction.
      const rgba = new Uint8Array(png.width * png.height * 4);
      for (let i = 0; i < png.width * png.height; i++) {
        const src = i * png.channels;
        rgba[i * 4] = png.data[src];
        rgba[i * 4 + 1] = png.data[src + (png.channels > 2 ? 1 : 0)];
        rgba[i * 4 + 2] = png.data[src + (png.channels > 2 ? 2 : 0)];
        rgba[i * 4 + 3] = png.channels === 4 ? png.data[src + 3] : 255;
      }
      const p = extractPalette(rgba, png.width, png.height);
      setPalette(p);
      push({ label: 'extractPalette on device', ok: p.length > 0, detail: `${p.length} swatches` });
    } catch (e) {
      push({ label: 'decode to RGBA', ok: false, detail: String(e) });
    }

    setRunning(false);
  }

  const verdict = steps.length === 0 ? null : steps.every((s) => s.ok);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.intro}>
        Decodes a PNG to raw pixels in pure JavaScript, then runs the real palette extractor over
        the result. If this passes, colour analysis can happen on-device.
      </Text>

      <Button title={running ? 'Running...' : 'Run spike'} onPress={run} disabled={running} />

      {verdict !== null && (
        <Text style={[styles.verdict, verdict ? styles.ok : styles.bad]}>
          {verdict ? 'PASS - on-device palette works' : 'FAIL - move palette to the Edge Function'}
        </Text>
      )}

      {steps.map((s) => (
        <View key={s.label} style={styles.step}>
          <Text style={[styles.stepLabel, s.ok ? styles.ok : styles.bad]}>
            {s.ok ? 'ok' : 'FAIL'} {s.label}
          </Text>
          <Text style={styles.detail}>{s.detail}</Text>
        </View>
      ))}

      {palette && palette.length > 0 && (
        <View style={styles.swatches}>
          {palette.map((s, i) => {
            const hex = rgbToHex(oklchToRgb(s));
            return (
              <View key={`${hex}-${i}`} style={styles.swatchRow}>
                <View style={[styles.chip, { backgroundColor: hex }]} />
                <Text style={styles.detail}>
                  {hex} · {(s.fraction * 100).toFixed(0)}% · L {s.l.toFixed(2)} C {s.c.toFixed(3)} h{' '}
                  {s.h.toFixed(0)}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  intro: { fontSize: 14, opacity: 0.75, lineHeight: 20 },
  verdict: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  ok: { color: '#1F8A3B' },
  bad: { color: '#C62828' },
  step: { borderTopWidth: 1, borderTopColor: 'rgba(127,127,127,0.25)', paddingTop: 8 },
  stepLabel: { fontSize: 14, fontWeight: '600' },
  detail: { fontSize: 12, fontFamily: 'monospace', opacity: 0.75, marginTop: 2 },
  swatches: { marginTop: 8, gap: 8 },
  swatchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chip: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' },
});
