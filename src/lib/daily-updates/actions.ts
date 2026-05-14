'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { todayIsoInRome } from './types';

export type DailyUpdateActionResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'not_authenticated' | 'unknown' };

const submitSchema = z.object({
  did_today: z.string().trim().min(1).max(4000),
  blockers: z.string().trim().max(4000).optional().nullable(),
  tomorrow: z.string().trim().max(4000).optional().nullable(),
});

function nullIfEmpty(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function submitDailyUpdate(
  formData: FormData,
): Promise<DailyUpdateActionResult> {
  const parsed = submitSchema.safeParse({
    did_today: formData.get('did_today')?.toString() ?? '',
    blockers: formData.get('blockers')?.toString() ?? '',
    tomorrow: formData.get('tomorrow')?.toString() ?? '',
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  const { error } = await supabase
    .from('daily_updates')
    .upsert(
      {
        user_id: user.id,
        date: todayIsoInRome(),
        did_today: parsed.data.did_today,
        blockers: nullIfEmpty(parsed.data.blockers),
        tomorrow: nullIfEmpty(parsed.data.tomorrow),
      },
      { onConflict: 'user_id,date' },
    );
  if (error) return { ok: false, error: 'unknown' };

  revalidatePath('/dashboard');
  revalidatePath('/aggiornamenti');
  return { ok: true };
}
