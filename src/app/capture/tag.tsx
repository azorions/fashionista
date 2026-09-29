import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ColourSwatches, GarmentForm } from '@/components/garment-form';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import type { SubcategoryRow } from '@/domain/garment/row';
import type { GarmentForm as FormValues } from '@/domain/tagging/schema';
import { useGarment } from '@/features/useCloset';
import { fetchSubcategories, saveTags } from '@/lib/capturePipeline';
import { useCaptureStore } from '@/stores/captureStore';

/**
 * Two taps and an optional name. That is the whole form, unless you ask.
 *
 * Everything else a garment needs — layer role, warmth, breathability, bulk,
 * formality, silhouette, length, rise — comes from the chosen subcategory's
 * defaults, and the colour was extracted from the cutout for free. Asking for
 * fifteen fields per garment is how a closet stays empty at four items.
 *
 * Pattern, material, finish and vibe sit folded under "More details",
 * prefilled from the same defaults, for the garment the defaults get wrong.
 * Warmth and formality are shown but not editable on purpose: correcting them
 * is not something to slow down the twentieth garment of a session.
 */
export default function TagScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const { itemId, reset } = useCaptureStore();
  const { data: item } = useGarment(itemId);

  const subs = useQuery({
    queryKey: ['subcategories'],
    queryFn: fetchSubcategories,
    staleTime: Infinity, // reference data; it changes only via a migration
  });

  const swatches = item?.palette ?? [];

  async function save(form: FormValues, sub: SubcategoryRow) {
    if (!itemId) throw new Error('This capture is no longer in progress.');
    await saveTags(itemId, form, sub);
    // Not awaited: the write has already succeeded. Awaiting held the button
    // spinner through a full closet refetch, re-signing every thumbnail.
    qc.invalidateQueries({ queryKey: ['closet'] });
    // This screen cached the untagged placeholder under this key; without
    // this, opening the new garment within 30s showed "Unsorted".
    qc.invalidateQueries({ queryKey: ['garment', itemId] });
    // One POP_TO back to the closet. dismissAll() only popped the NEAREST
    // stack -- the capture flow -- which refocused the camera before the
    // follow-up replace('/') ran.
    router.dismissTo('/');
    // After navigating, so the screens underneath do not re-render into
    // their empty states during the transition.
    reset();
  }

  return (
    <GarmentForm
      subcategories={subs.data}
      subcategoriesFailed={!!subs.error}
      submitLabel="Add to closet"
      onSubmit={save}
      header={
        <>
          {swatches.length > 0 ? (
            <View style={styles.section}>
              <ThemedText type="smallBold">Colour</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Read from the cutout. No typing needed.
              </ThemedText>
              <ColourSwatches palette={swatches} />
            </View>
          ) : null}
          {subs.error ? (
            <View style={styles.section}>
              <ThemedText themeColor="danger">Could not load the garment kinds.</ThemedText>
              <Button
                variant="text"
                label="Try again"
                onPress={() => subs.refetch()}
                style={styles.retry}
              />
            </View>
          ) : null}
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  retry: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
});
