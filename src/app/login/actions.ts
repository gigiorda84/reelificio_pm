'use server';

import { headers } from 'next/headers';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export type LoginResult =
  | { ok: true }
  | { ok: false; error: string };

export async function sendMagicLink(formData: FormData): Promise<LoginResult> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, error: 'invalid_email' };
  }

  const supabase = await getSupabaseServerClient();
  const h = await headers();
  const origin = h.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? '';

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    console.error('[login] signInWithOtp failed:', {
      message: error.message,
      status: error.status,
      name: error.name,
    });
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
