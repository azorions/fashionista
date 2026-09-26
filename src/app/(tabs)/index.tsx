import { FlashList } from '@shopify/flash-list';
import { Link, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GarmentTile } from '@/components/garment-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useCloset, type ClosetItem } from '@/features/useCloset';

/**
 * The closet.
 *
 * FlashList rather than FlatList: fine at 50 items either way, visibly bad at
 * 500 cutout tiles, which is what a wardrobe looks like after bulk import in
 * M3. v2 is a JS-only rewrite with no native module, so it runs in Expo Go and
 * choosing it now costs nothing.
 */
export default function ClosetScreen() {
  const router = useRouter();
  const { data, isLoading, error, refetch, isRefetching } = useCloset();

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="title">Closet</ThemedText>
          {data?.length ? <ThemedText type="small">{data.length} items</ThemedText> : null}
        </View>

        {isLoading ? (
          <View style={styles.centre}>
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View style={styles.centre}>
            <ThemedText style={styles.error}>Could not load your closet.</ThemedText>
            <Pressable onPress={() => refetch()}>
              <ThemedText type="link">Try again</ThemedText>
            </Pressable>
          </View>
        ) : !data?.length ? (
          <Empty />
        ) : (
          <FlashList
            data={data}
            numColumns={2}
            keyExtractor={(i) => i.id}
            onRefresh={refetch}
            refreshing={isRefetching}
            contentContainerStyle={styles.grid}
            renderItem={({ item }) => <Cell item={item} />}
          />
        )}

        <Pressable style={styles.fab} onPress={() => router.push('/capture')}>
          <ThemedText style={styles.fabLabel}>+</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

function Cell({ item }: { item: ClosetItem }) {
  return (
    <View style={styles.cell}>
      {item.thumbUrl ? (
        <GarmentTile uri={item.thumbUrl} category={item.category} priority="low" />
      ) : (
        // Cutout still running, or it failed. Either way the garment exists.
        <View style={styles.placeholder}>
          <ActivityIndicator />
        </View>
      )}
      <ThemedText type="small" numberOfLines={1} style={styles.caption}>
        {item.name ?? item.subcategory.replace(/_/g, ' ')}
      </ThemedText>
    </View>
  );
}

function Empty() {
  return (
    <View style={styles.centre}>
      <ThemedText type="subtitle" style={styles.centred}>
        Your closet is empty
      </ThemedText>
      <ThemedText style={styles.centred}>
        Photograph a garment and it will appear here as a clean tile.
      </ThemedText>
      <Link href="/spikes" style={styles.spikes}>
        <ThemedText type="link">Dev spikes →</ThemedText>
      </Link>
    </View>
  );
}

const GAP = 12;
const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  centred: { textAlign: 'center' },
  spikes: { marginTop: Spacing.three },
  error: { color: '#C62828' },

  grid: { paddingHorizontal: 16 - GAP / 2, paddingBottom: 96 },
  cell: { flex: 1, paddingHorizontal: GAP / 2, paddingBottom: GAP, gap: 6 },
  caption: { opacity: 0.7, textTransform: 'capitalize' },
  placeholder: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127,127,127,0.12)',
  },

  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabLabel: { color: '#fff', fontSize: 30, lineHeight: 34 },
});
