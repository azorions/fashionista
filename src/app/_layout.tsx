import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useSession } from '@/lib/auth';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

/**
 * Redirect between the signed-in and signed-out halves of the app.
 *
 * `session === undefined` means we are still reading the stored session and
 * must do nothing — acting on it would flash the sign-in screen on every cold
 * start.
 */
function useAuthGate(session: ReturnType<typeof useSession>) {
  const segments = useSegments();
  const router = useRouter();
  const lastNav = useRef<string | null>(null);

  useEffect(() => {
    if (session === undefined) return;

    const inAuthGroup = segments[0] === '(auth)';
    const target = !session && !inAuthGroup ? '/sign-in' : session && inAuthGroup ? '/' : null;

    // Guard against re-firing the same navigation while segments settle.
    if (target && lastNav.current !== target) {
      lastNav.current = target;
      router.replace(target);
    } else if (!target) {
      lastNav.current = null;
    }
  }, [session, segments, router]);
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const session = useSession();
  useAuthGate(session);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        {session === undefined ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator />
          </View>
        ) : (
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            {/* Capture is pushed OVER the tabs — the camera wants the whole screen. */}
            <Stack.Screen name="capture" options={{ headerShown: false }} />
            <Stack.Screen name="spikes" options={{ title: 'Dev spikes' }} />
          </Stack>
        )}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
