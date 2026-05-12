'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { DOD_ITEM_KEYS, type DodItemKey } from './constants';

export type DodActionResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'not_authenticated'
        | 'not_authorized'
        | 'reel_not_found'
        | 'wrong_phase'
        | 'unknown';
      message?: string;
    };

const toggleSchema = z.object({
  reel_id: z.string().uuid(),
  key: z.enum(DOD_ITEM_KEYS),
  checked: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => v === true || v === 'true'),
  note: z
    .string()
    .max(1000)
    .or(z.literal(''))
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export async function toggleDodItem(
  formData: FormData,
): Promise<DodActionResult> {
  const parsed = toggleSchema.safeParse({
    reel_id: formData.get('reel_id')?.toString() ?? '',
    key: (formData.get('key')?.toString() ?? '') as DodItemKey,
    checked: formData.get('checked')?.toString() ?? 'false',
    note: formData.get('note')?.toString() ?? '',
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  const { data: reel } = await supabase
    .from('reels')
    .select('id, phase, page_id')
    .eq('id', parsed.data.reel_id)
    .maybeSingle();
  if (!reel) return { ok: false, error: 'reel_not_found' };
  if (reel.phase !== 'editing') return { ok: false, error: 'wrong_phase' };

  if (parsed.data.checked) {
    const { error } = await supabase.from('reel_dod_items').upsert(
      {
        reel_id: parsed.data.reel_id,
        key: parsed.data.key,
        checked_by: user.id,
        checked_at: new Date().toISOString(),
        note: parsed.data.note,
      },
      { onConflict: 'reel_id,key' },
    );
    if (error) {
      return error.code === '42501'
        ? { ok: false, error: 'not_authorized' }
        : { ok: false, error: 'unknown', message: error.message };
    }
  } else {
    const { error } = await supabase
      .from('reel_dod_items')
      .delete()
      .eq('reel_id', parsed.data.reel_id)
      .eq('key', parsed.data.key);
    if (error) {
      return error.code === '42501'
        ? { ok: false, error: 'not_authorized' }
        : { ok: false, error: 'unknown', message: error.message };
    }
  }

  revalidatePath(`/reels/${parsed.data.reel_id}`);
  return { ok: true };
}
