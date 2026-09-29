import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface Props {
  label: string;
  onPress: () => void;
  /** primary: filled; secondary: outlined; text: a bare link-style action. */
  variant?: 'primary' | 'secondary' | 'text';
  busy?: boolean;
  disabled?: boolean;
  /** Paints the label in the danger colour, for delete and discard. */
  destructive?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The one button.
 *
 * Primary fills with the text colour and labels with the background colour,
 * so it inverts with the theme. The hardcoded #111 it replaces was all but
 * invisible on the dark theme's #000.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  busy,
  disabled,
  destructive,
  accessibilityHint,
  style,
}: Props) {
  const theme = useTheme();
  const off = disabled || busy;
  const fg = variant === 'primary' ? theme.background : destructive ? theme.danger : theme.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      hitSlop={variant === 'text' ? 8 : undefined}
      style={({ pressed }) => [
        variant === 'text' ? styles.textBox : styles.box,
        variant === 'primary' && {
          backgroundColor: destructive ? theme.danger : theme.text,
        },
        variant === 'secondary' && { borderWidth: 1, borderColor: theme.backgroundSelected },
        (pressed || off) && styles.dim,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <ThemedText
          type={variant === 'text' ? 'small' : 'default'}
          style={[styles.label, { color: fg }]}
        >
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: Radius.control,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A bare label is ~20px tall; recovery actions like "Try again" need a
  // full-size target too.
  textBox: { minHeight: 44, justifyContent: 'center' },
  label: { fontWeight: '600' },
  dim: { opacity: 0.5 },
});
