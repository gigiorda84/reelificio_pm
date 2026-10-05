'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { LINK_TOKEN_TTL_MS, newLinkToken } from '@/lib/notifications/telegram-link';

export type ProfileActionResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'not_authenticated' | 'unknown'; message?: string };

const updateSchema = z.object({
  full_name: z.string().min(1).max(120).nullable(),
  daily_reminder_at: z
    .string()
    .regex(/^\d{2}:\d{2}$/u, 'time')
    .nullable(),
});

export async function updateOwnProfile(
  formData: FormData,
): Promise<ProfileActionResult> {
  const fullName = (formData.get('full_name')?.toString() ?? '').trim();
  const reminder = (formData.get('daily_reminder_at')?.toString() ?? '').trim();

  const parsed = updateSchema.safeParse({
    full_name: fullName.length > 0 ? fullName : null,
    daily_reminder_at: reminder.length > 0 ? reminder : null,
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: parsed.data.full_name,
      daily_reminder_at: parsed.data.daily_reminder_at,
    })
    .eq('id', user.id);
  if (error) return { ok: false, error: 'unknown', message: error.message };

  revalidatePath('/settings');
  return { ok: true };
}

export async function unlinkTelegram(): Promise<ProfileActionResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  // telegram_chat_id is not user-writable (only the webhook links a chat).
  const { error } = await supabase.rpc('unlink_telegram');
  if (error) return { ok: false, error: 'unknown', message: error.message };

  revalidatePath('/settings');
  return { ok: true };
}

export type TelegramLinkResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; error: 'not_authenticated' | 'unknown'; message?: string };

// A one-time token to link Telegram (15 minutes): the bot receives it in the
// /start deep link and public.link_telegram() consumes it. Only its hash is
// stored; the user's older unused tokens are dropped.
export async function createTelegramLinkToken(): Promise<TelegramLinkResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  const { token, hash } = newLinkToken();
  const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS).toISOString();
  const admin = getSupabaseAdminClient();
  await admin.from('telegram_link_tokens').delete().eq('user_id', user.id).is('used_at', null);
  const { error } = await admin
    .from('telegram_link_tokens')
    .insert({ token_hash: hash, user_id: user.id, expires_at: expiresAt });
  if (error) return { ok: false, error: 'unknown', message: error.message };
  return { ok: true, token, expiresAt };
}
