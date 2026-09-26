import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {/*
        A Stack at the root, with the tab bar living inside the (tabs) group.
        Capture and the dev spikes are pushed OVER the tabs rather than being
        tabs themselves — the camera wants the whole screen.
      */}
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="spikes" options={{ title: 'Dev spikes' }} />
      </Stack>
    </ThemeProvider>
  );
}
