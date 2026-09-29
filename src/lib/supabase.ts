import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

/**
 * The single Supabase client.
 *
 * On the publishable key: shipping it in the bundle is correct and safe. It is
 * designed to be public, and Row Level Security is what actually protects the
 * data — every policy is written against auth.uid(), so a stolen publishable
 * key grants exactly the access of a signed-out visitor. The SECRET key is a
 * different matter and must never appear anywhere in this directory.
 *
 * On session storage: plain AsyncStorage, deliberately. Supabase's Expo guide
 * shows an AES-encrypted LargeSecureStore (SecureStore caps at 2048 bytes),
 * which is three extra dependencies and a custom adapter. That is a milestone-5
 * hardening item, not a milestone-1 blocker. Tokens here are short-lived and
 * refresh-rotated.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * False until .env.local is filled in.
 *
 * This used to throw at import instead, and the root layout imports this file
 * -- so without a Supabase project the app could not boot at all, and the dev
 * spikes, which are meant to be run BEFORE a project exists, could never be
 * opened. Now the app boots, sign-in explains what is missing, and dev routes
 * work.
 *
 * Unconfigured, the client is built around a placeholder URL. supabase-js only
 * checks the URL's shape at construction, so this cannot throw; every real
 * call fails at use and returns an error, which the screens already handle.
 */
export const isSupabaseConfigured = Boolean(url && publishableKey);

export const supabase = createClient(url || 'http://localhost', publishableKey || 'unconfigured', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // There is no URL to read a session out of in a native app, and leaving
    // this on makes supabase-js touch window.location.
    detectSessionInUrl: false,
  },
});
