'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export type VoiceBriefActionResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'not_admin' | 'unknown'; message?: string };

const saveSchema = z.object({
  page_id: z.string().uuid(),
  adjectives: z.array(z.string().min(1).max(60)).max(40),
  reference_audio_urls: z.array(z.string().url().max(1000)).max(40),
  banned_words: z.array(z.string().min(1).max(60)).max(80),
  allowed_liberties: z.string().max(5000).nullable(),
  anomaly_procedure: z.string().max(5000).nullable(),
});

function splitCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function ensureAdmin(): Promise<boolean> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  return !!data?.is_admin;
}

export async function saveVoiceBrief(
  pageId: string,
  formData: FormData,
): Promise<VoiceBriefActionResult> {
  if (!(await ensureAdmin())) return { ok: false, error: 'not_admin' };

  const adjRaw = formData.get('adjectives')?.toString() ?? '';
  const banRaw = formData.get('banned_words')?.toString() ?? '';
  const urlsRaw = formData.get('reference_audio_urls')?.toString() ?? '';
  const liberties = (formData.get('allowed_liberties')?.toString() ?? '').trim();
  const anomaly = (formData.get('anomaly_procedure')?.toString() ?? '').trim();

  const parsed = saveSchema.safeParse({
    page_id: pageId,
    adjectives: splitCsv(adjRaw),
    banned_words: splitCsv(banRaw),
    reference_audio_urls: splitLines(urlsRaw),
    allowed_liberties: liberties.length > 0 ? liberties : null,
    anomaly_procedure: anomaly.length > 0 ? anomaly : null,
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase
    .from('voice_briefs')
    .upsert(
      {
        page_id: parsed.data.page_id,
        adjectives: parsed.data.adjectives,
        reference_audio_urls: parsed.data.reference_audio_urls,
        banned_words: parsed.data.banned_words,
        allowed_liberties: parsed.data.allowed_liberties,
        anomaly_procedure: parsed.data.anomaly_procedure,
        updated_by: user?.id ?? null,
      },
      { onConflict: 'page_id' },
    );
  if (error) return { ok: false, error: 'unknown', message: error.message };

  revalidatePath(`/pages/${pageId}`);
  return { ok: true };
}
