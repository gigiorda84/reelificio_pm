'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';

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

  const { error } = await supabase
    .from('profiles')
    .update({ telegram_chat_id: null })
    .eq('id', user.id);
  if (error) return { ok: false, error: 'unknown', message: error.message };

  revalidatePath('/settings');
  return { ok: true };
}
