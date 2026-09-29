import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { GarmentForm } from '@/components/garment-form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import type { SubcategoryRow } from '@/domain/garment/row';
import type { GarmentForm as FormValues } from '@/domain/tagging/schema';
import { useGarment } from '@/features/useCloset';
import { fetchSubcategories, saveTags } from '@/lib/capturePipeline';

/** The capture form again, prefilled with what was saved. */
export default function EditGarmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: item, isLoading, isFetching, isStale, error, refetch } = useGarment(id);
  const subs = useQuery({
    queryKey: ['subcategories'],
    queryFn: fetchSubcategories,
    staleTime: Infinity, // reference data; it changes only via a migration
  });

  // The form reads `initial` once, at mount, so it must not mount before the
  // garment has loaded -- nor from a stale cached copy that is being replaced.
  if (isLoading || (isFetching && isStale)) {
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

  async function save(form: FormValues, sub: SubcategoryRow) {
    await saveTags(id, form, sub);
    // Not awaited, as on the tag screen: the write has already succeeded.
    qc.invalidateQueries({ queryKey: ['closet'] });
    qc.invalidateQueries({ queryKey: ['garment', id] });
    // Saved outfits embed their garments, so their cards show the old details too.
    qc.invalidateQueries({ queryKey: ['outfits'] });
    router.back();
  }

  return (
    <GarmentForm
      subcategories={subs.data}
      subcategoriesFailed={!!subs.error}
      initial={{
        category: item.category,
        subcategory: item.subcategory,
        name: item.name,
        pattern: item.pattern,
        patternScale: item.patternScale,
        materials: item.materials,
        sheen: item.sheen,
        styleTags: item.styleTags,
      }}
      submitLabel="Save changes"
      onSubmit={save}
      header={
        subs.error ? (
          <View style={styles.section}>
            <ThemedText themeColor="danger">Could not load the garment kinds.</ThemedText>
            <Button
              variant="text"
              label="Try again"
              onPress={() => subs.refetch()}
              style={styles.textButton}
            />
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  section: { gap: Spacing.two },
  textButton: { minHeight: 44, justifyContent: 'center' },
});
