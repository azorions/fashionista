import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

export function Chip({ label, selected, onPress }: ChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hitSlop={4}
      style={[
        styles.chip,
        { borderColor: theme.backgroundSelected },
        selected && { backgroundColor: theme.text, borderColor: theme.text },
      ]}>
      <ThemedText type="small" style={selected ? { color: theme.background } : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

interface ChipRowProps<T extends string> {
  options: readonly { value: T; label: string }[];
  /** One value for single select, an array for multi select. */
  selected: T | null | readonly T[];
  onToggle: (value: T) => void;
}

/** Wrapping row of chips. Selection logic stays with the caller. */
export function ChipRow<T extends string>({ options, selected, onToggle }: ChipRowProps<T>) {
  const isOn = (v: T) => (Array.isArray(selected) ? selected.includes(v) : selected === v);
  return (
    <View style={styles.row}>
      {options.map((o) => (
        <Chip key={o.value} label={o.label} selected={isOn(o.value)} onPress={() => onToggle(o.value)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
});
