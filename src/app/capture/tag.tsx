import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { oklchToRgb, rgbToHex } from '@/domain/color/oklab';
import { CATEGORIES, type Category } from '@/domain/tagging/schema';
import { fetchSubcategories, saveTags } from '@/lib/capturePipeline';
import type { SubcategoryRow } from '@/domain/garment/row';
import { useCaptureStore } from '@/stores/captureStore';
import { useGarment } from '@/features/useCloset';

/**
 * Three fields. That is the whole form.
 *
 * Everything else a garment needs — layer role, warmth, breathability, bulk,
 * formality, silhouette, length, rise — comes from the chosen subcategory's
 * defaults, and the colour was extracted from the cutout for free. Asking for
 * fifteen fields per garment is how a closet stays empty at four items.
 *
 * The defaults are visible but not editable here on purpose: correcting a
 * warmth value is an edit-screen job (M3), not something to slow down the
 * twentieth garment of a session.
 */
export default function TagScreen() {
  const router = useRouter();
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];
  const qc = useQueryClient();

  const { itemId, reset } = useCaptureStore();
  const { data: item } = useGarment(itemId);

  const { data: subcategories } = useQuery({
    queryKey: ['subcategories'],
    queryFn: fetchSubcategories,
    staleTime: Infinity, // reference data; it changes only via a migration
  });

  const [category, setCategory] = useState<Category>('top');
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forCategory = useMemo(
    () => (subcategories ?? []).filter((s) => s.category === category && s.code !== 'unknown'),
    [subcategories, category]
  );

  const swatches = (item?.palette ?? []).slice(0, 3);

  async function save() {
    const sub = (subcategories ?? []).find((s) => s.code === subcategory);
    if (!itemId || !sub) return;
    setSaving(true);
    setError(null);
    try {
      await saveTags(itemId, { category, subcategory: sub.code, name: name || undefined }, sub);
      // Not awaited: the write has already succeeded. Awaiting held the button
      // spinner through a full closet refetch, re-signing every thumbnail.
      qc.invalidateQueries({ queryKey: ['closet'] });
      // One POP_TO back to the closet. dismissAll() only popped the NEAREST
      // stack -- the capture flow -- which refocused the camera before the
      // follow-up replace('/') ran.
      router.dismissTo('/');
      // After navigating, so the screens underneath do not re-render into
      // their empty states during the transition.
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={styles.page}>
        {swatches.length > 0 ? (
          <View style={styles.section}>
            <ThemedText type="smallBold">Colour</ThemedText>
            <ThemedText type="small" style={styles.hint}>
              Read from the cutout. No typing needed.
            </ThemedText>
            <View style={styles.swatchRow}>
              {swatches.map((s, i) => (
                <View
                  key={i}
                  accessible
                  accessibilityLabel={`Colour ${i + 1}: ${rgbToHex(oklchToRgb(s))}`}
                  style={[styles.swatch, { backgroundColor: rgbToHex(oklchToRgb(s)) }]}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <ThemedText type="smallBold">What is it?</ThemedText>
          <View style={styles.chips}>
            {CATEGORIES.map((c) => (
              <Pressable
                key={c}
                onPress={() => {
                  setCategory(c);
                  setSubcategory(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={c}
                accessibilityState={{ selected: category === c }}
                style={[
                  styles.chip,
                  { borderColor: colors.backgroundSelected },
                  category === c && { backgroundColor: colors.text, borderColor: colors.text },
                ]}>
                <ThemedText
                  type="small"
                  style={category === c ? { color: colors.background } : undefined}>
                  {c}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText type="smallBold">Which kind?</ThemedText>
          {subcategories ? (
            <View style={styles.chips}>
              {forCategory.map((s) => (
                <Pressable
                  key={s.code}
                  onPress={() => setSubcategory(s.code)}
                  accessibilityRole="button"
                  accessibilityLabel={s.label}
                  accessibilityState={{ selected: subcategory === s.code }}
                  style={[
                    styles.chip,
                    { borderColor: colors.backgroundSelected },
                    subcategory === s.code && {
                      backgroundColor: colors.text,
                      borderColor: colors.text,
                    },
                  ]}>
                  <ThemedText
                    type="small"
                    style={subcategory === s.code ? { color: colors.background } : undefined}>
                    {s.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          ) : (
            <ActivityIndicator />
          )}
        </View>

        <View style={styles.section}>
          <ThemedText type="smallBold">Name it (optional)</ThemedText>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="the good flannel"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.text, borderColor: colors.backgroundSelected }]}
            maxLength={80}
          />
        </View>

        {subcategory ? <Defaults sub={forCategory.find((s) => s.code === subcategory)} /> : null}
        {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.primary, (!subcategory || saving) && styles.dim]}
          disabled={!subcategory || saving}
          onPress={save}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText style={styles.primaryLabel}>Add to closet</ThemedText>
          )}
        </Pressable>
      </View>
    </ThemedView>
  );
}

/** Shown, not asked. Makes it obvious what the three answers bought. */
function Defaults({ sub }: { sub?: SubcategoryRow }) {
  if (!sub) return null;
  return (
    <View style={styles.section}>
      <ThemedText type="small" style={styles.hint}>
        Filled in from {sub.label.toLowerCase()}: warmth {sub.default_warmth}/5, layers as{' '}
        {sub.default_layer_role}, formality {sub.default_formality}/5. Editable later.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.five },
  section: { gap: Spacing.two },
  hint: { opacity: 0.65 },
  swatchRow: { flexDirection: 'row', gap: Spacing.two },
  swatch: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  footer: { padding: Spacing.four, paddingTop: 0 },
  primary: {
    backgroundColor: '#111',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  primaryLabel: { color: '#fff', fontWeight: '600' },
  dim: { opacity: 0.45 },
  error: { color: '#C62828' },
});
