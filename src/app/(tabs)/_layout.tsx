import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useColorScheme, type ColorValue } from 'react-native';

import { Colors } from '@/constants/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

function icon(on: IconName, off: IconName) {
  return function TabIcon(p: { color: ColorValue; size: number; focused: boolean }) {
    return <Ionicons name={p.focused ? on : off} size={p.size} color={p.color as string} />;
  };
}

/**
 * JavaScript <Tabs>, deliberately not expo-router's NativeTabs.
 *
 * NativeTabs feels more platform-native but gives much less styling control,
 * and this app's tab bar is going to want a centre capture button. JS Tabs is
 * also the older, more stable API.
 */
export default function TabsLayout() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.background },
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Closet', tabBarIcon: icon('shirt', 'shirt-outline') }}
      />
      <Tabs.Screen
        name="style"
        options={{ title: 'Style', tabBarIcon: icon('sparkles', 'sparkles-outline') }}
      />
      <Tabs.Screen
        name="outfits"
        options={{ title: 'Outfits', tabBarIcon: icon('albums', 'albums-outline') }}
      />
    </Tabs>
  );
}
