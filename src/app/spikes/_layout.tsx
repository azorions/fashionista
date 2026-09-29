import { Stack } from 'expo-router';

export default function SpikesLayout() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="index" options={{ title: 'Dev spikes' }} />
      <Stack.Screen name="camera-texture" options={{ title: 'Live camera pixels' }} />
      <Stack.Screen name="fast-png" options={{ title: 'fast-png under Hermes' }} />
    </Stack>
  );
}
