import { Stack } from 'expo-router';

export default function CaptureLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="review" options={{ title: 'Review', headerBackTitle: 'Retake' }} />
      <Stack.Screen name="tag" options={{ title: 'Add details' }} />
    </Stack>
  );
}
