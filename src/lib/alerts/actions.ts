'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export type CloseAlertResult =
  | { ok: true }
  | {
      ok: false;
      error: 'invalid_input' | 'not_authorized' | 'not_found' | 'already_closed' | 'unknown';
    };

const schema = z.object({
  alert_id: z.string().uuid(),
  proposed_solution: z.string().trim().min(3).max(2000),
});

export async function closeAlert(formData: FormData): Promise<CloseAlertResult> {
  const parsed = schema.safeParse({
    alert_id: formData.get('alert_id'),
    proposed_solution: formData.get('proposed_solution'),
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false, error: 'not_authorized' };

  const { data: existing } = await supabase
    .from('alerts')
    .select('id, status')
    .eq('id', parsed.data.alert_id)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'not_found' };
  if (existing.status === 'closed') return { ok: false, error: 'already_closed' };

  const { error } = await supabase
    .from('alerts')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: user.id,
      proposed_solution: parsed.data.proposed_solution,
    })
    .eq('id', parsed.data.alert_id);
  if (error) return { ok: false, error: 'unknown' };

  revalidatePath('/alerts');
  revalidatePath('/dashboard');
  return { ok: true };
}
