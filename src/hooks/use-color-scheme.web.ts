import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

// Never resubscribes: "have we hydrated" changes exactly once, at hydration,
// and React re-renders then anyway.
const subscribe = () => () => {};

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 *
 * Uses useSyncExternalStore rather than a setState-in-effect flag: it reports
 * the server snapshot (false) during SSR and the client snapshot (true) after
 * hydration, without the cascading render that react-hooks/set-state-in-effect
 * (correctly) flags.
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    subscribe,
    () => true, // client
    () => false // server
  );

  const colorScheme = useRNColorScheme();

  return hasHydrated ? colorScheme : 'light';
}
