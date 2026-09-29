import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Current session, or undefined while we are still finding out.
 *
 * The three states matter: `undefined` means "still checking" and must NOT be
 * treated as signed out, or the app flashes the sign-in screen on every cold
 * start before the stored session loads.
 */
export function useSession() {
  // With no Supabase project there is nothing to wait for: signed out, now.
  const [session, setSession] = useState<Session | null | undefined>(
    isSupabaseConfigured ? undefined : null
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  return session;
}

/**
 * Email one-time code. No magic link, no redirect, no deep link.
 *
 * Deep links are THE Expo Go pain point: Expo Go owns the `exp://` scheme and
 * this app's own scheme does not exist until there is a dev client, so a magic
 * link needs a different redirect for Expo Go, dev client and production.
 * Gmail's link prefetcher also burns single-use tokens. A six-digit code has
 * no redirect at all and behaves identically in all three.
 *
 * Requires Supabase's "Magic Link" email template to emit {{ .Token }}
 * instead of {{ .ConfirmationURL }}.
 */
export async function sendCode(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function verifyCode(email: string, token: string) {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'email',
  });
  if (error) throw error;
}

export const signOut = () => supabase.auth.signOut();
