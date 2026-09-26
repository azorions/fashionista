import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

/**
 * The closet. Empty until the capture pipeline lands (milestone 1, tasks 11-18).
 *
 * The dev-spikes link stays until both spikes have been run on a real device —
 * they answer questions nothing downstream can be built on top of.
 */
export default function ClosetScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.hero}>
          <ThemedText type="title" style={styles.center}>
            Your closet is empty
          </ThemedText>
          <ThemedText style={styles.center}>
            Photograph a garment and it will appear here as a clean tile.
          </ThemedText>
        </View>

        <ThemedView type="backgroundElement" style={styles.panel}>
          <ThemedText type="smallBold">Before building the pipeline</ThemedText>
          <ThemedText type="small">
            Two assumptions need a real device to verify. Run both, then delete this panel.
          </ThemedText>
          <Link href="/spikes" style={styles.link}>
            <ThemedText type="link">Open dev spikes →</ThemedText>
          </Link>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  center: { textAlign: 'center' },
  panel: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    borderRadius: Spacing.four,
    marginBottom: Spacing.five,
  },
  link: { marginTop: Spacing.two },
});
