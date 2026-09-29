import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useSession } from '@/lib/auth';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

/**
 * Dev tools that need no account. The spikes in particular are meant to be run
 * before a Supabase project exists, so gating them behind sign-in made them
 * unreachable. Development builds only.
 */
const DEV_ROUTES = new Set(['spikes', 'preview']);

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
    const devOpen = __DEV__ && DEV_ROUTES.has(segments[0] ?? '');
    const target =
      !session && !inAuthGroup && !devOpen ? '/sign-in' : session && inAuthGroup ? '/' : null;

    // Guard against re-firing the same navigation while segments settle.
    if (target && lastNav.current !== target) {
      lastNav.current = target;
      router.replace(target);
    } else if (!target) {
      lastNav.current = null;
    }
  }, [session, segments, router]);
}

/**
 * Drop every cached query when the signed-in USER changes.
 *
 * The client is module-scope and the closet is keyed ['closet'] with no user
 * in it, so without this, signing out as A and in as B served B account A's
 * garments -- with signed URLs still valid for an hour, so the tiles actually
 * rendered. It would also make the two-account RLS test report a failure that
 * is the cache's fault, not RLS's.
 *
 * Keyed on the user id rather than the session object, so a routine token
 * refresh (new session, same person) does not wipe the cache.
 */
function useClearCacheOnUserChange(session: ReturnType<typeof useSession>) {
  const lastUser = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (session === undefined) return;
    const uid = session?.user.id ?? null;
    if (lastUser.current !== uid) {
      queryClient.clear();
      lastUser.current = uid;
    }
  }, [session]);
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const session = useSession();
  useClearCacheOnUserChange(session);
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
            {/* The spikes group has its own stack and headers; a root header on
                top of it showed two. */}
            <Stack.Screen name="spikes" options={{ headerShown: false }} />
            <Stack.Screen name="preview/style" options={{ title: 'Style preview' }} />
          </Stack>
        )}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
