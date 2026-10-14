'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { bibleSchema, voiceSchema, type BibleFields, type VoiceFields } from './schema';

// Saves the whole bible and its Voce section through save_bible(), which
// checks the caller (admin or RACI Responsible of script_writing), the
// version and the limits again (supabase/fase2/010_bible.sql).

export type BibleActionResult =
  | { ok: true; version: number }
  | { ok: false; error: 'invalid_input' | 'not_authorized' | 'stale' | 'unknown' };

const CODES = ['invalid_input', 'not_authorized', 'stale'] as const;

export async function saveBible(
  pageId: string,
  input: { bible: BibleFields; voice: VoiceFields; expectedVersion: number },
): Promise<BibleActionResult> {
  const bible = bibleSchema.safeParse(input.bible);
  const voice = voiceSchema.safeParse(input.voice);
  if (
    !z.string().uuid().safeParse(pageId).success ||
    !Number.isInteger(input.expectedVersion) ||
    !bible.success ||
    !voice.success
  ) {
    return { ok: false, error: 'invalid_input' };
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc('save_bible', {
    p_page_id: pageId,
    p_bible: bible.data,
    p_voice: voice.data,
    p_expected_version: input.expectedVersion,
  });
  if (error) {
    console.error('[bible] save_bible failed', error.code);
    return { ok: false, error: 'unknown' };
  }
  if (data !== 'ok') {
    return { ok: false, error: (CODES as readonly string[]).includes(data) ? (data as (typeof CODES)[number]) : 'unknown' };
  }
  revalidatePath(`/pages/${pageId}`);
  revalidatePath(`/pages/${pageId}/bibbia`);
  return { ok: true, version: input.expectedVersion + 1 };
}
