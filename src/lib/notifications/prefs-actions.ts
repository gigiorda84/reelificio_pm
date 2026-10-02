'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { prefRowsToStore, type PrefMatrix } from './defaults';

export type PrefsActionResult =
  | { ok: true }
  | { ok: false; error: 'not_authenticated' | 'unknown'; message?: string };

// Stores only the switches that differ from the defaults and drops the rest,
// so a default changed later reaches everyone who never touched it.
export async function saveOwnPrefMatrix(matrix: PrefMatrix): Promise<PrefsActionResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  const rows = prefRowsToStore(matrix).map((r) => ({ ...r, user_id: user.id }));

  const { error: delError } = await supabase
    .from('notification_prefs')
    .delete()
    .eq('user_id', user.id);
  if (delError) return { ok: false, error: 'unknown', message: delError.message };

  if (rows.length > 0) {
    const { error } = await supabase.from('notification_prefs').insert(rows);
    if (error) return { ok: false, error: 'unknown', message: error.message };
  }

  revalidatePath('/settings');
  return { ok: true };
}
