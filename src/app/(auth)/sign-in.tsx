import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { sendCode, verifyCode } from '@/lib/auth';

/**
 * Email, then a six-digit code. Two steps, no redirect anywhere.
 * See src/lib/auth.ts for why this and not a magic link.
 */
export default function SignInScreen() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const input = [styles.input, { color: colors.text, borderColor: colors.backgroundSelected }];

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill}>
        <KeyboardAvoidingView
          style={styles.center}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ThemedView style={styles.card}>
            <ThemedText type="title">Fashionista</ThemedText>
            <ThemedText style={styles.blurb}>
              {step === 'email'
                ? 'Your closet is private to you. Sign in with your email.'
                : `Enter the six-digit code sent to ${email}.`}
            </ThemedText>

            {step === 'email' ? (
              <TextInput
                style={input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                editable={!busy}
              />
            ) : (
              <TextInput
                style={[...input, styles.codeInput]}
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor={colors.textSecondary}
                keyboardType="number-pad"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                editable={!busy}
              />
            )}

            {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

            <Pressable
              style={[styles.button, { backgroundColor: colors.text }, busy && styles.dim]}
              disabled={busy || (step === 'email' ? !email.includes('@') : code.length < 6)}
              onPress={() =>
                run(async () => {
                  if (step === 'email') {
                    await sendCode(email);
                    setStep('code');
                  } else {
                    await verifyCode(email, code);
                  }
                })
              }>
              {busy ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <ThemedText style={[styles.buttonLabel, { color: colors.background }]}>
                  {step === 'email' ? 'Send code' : 'Sign in'}
                </ThemedText>
              )}
            </Pressable>

            {step === 'code' ? (
              <Pressable
                onPress={() => {
                  setStep('email');
                  setCode('');
                  setError(null);
                }}>
                <ThemedText type="link">Use a different email</ThemedText>
              </Pressable>
            ) : null}
          </ThemedView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.four },
  card: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  blurb: { opacity: 0.75 },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  codeInput: { fontSize: 24, letterSpacing: 8, textAlign: 'center' },
  button: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonLabel: { fontWeight: '600' },
  dim: { opacity: 0.6 },
  error: { color: '#C62828' },
});
