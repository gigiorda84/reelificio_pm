'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export type ReelActionResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'not_authorized' | 'unknown'; message?: string };

import {
  ALL_REEL_FORMATS as REEL_FORMATS,
  ALL_REEL_CATEGORIES as REEL_CATEGORIES,
} from './constants';

const scriptSchema = z.object({
  title: z.string().min(1).max(200),
  format: z.enum(REEL_FORMATS),
  category: z.enum(REEL_CATEGORIES),
  hook: z.string().max(2000).nullable().optional(),
  corpo: z.string().max(8000).nullable().optional(),
  chiusura: z.string().max(2000).nullable().optional(),
  cta: z.string().max(2000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

const filesSchema = z.object({
  audio_drive_url: z.string().url().nullable().or(z.literal('')).optional(),
  video_drive_url: z.string().url().nullable().or(z.literal('')).optional(),
});

// posted_url is not here: since Fase 1 a reel is published through
// publish_reel() (task panel), and after the contract the column is not
// writable by users at all.
const publishSchema = z.object({
  caption: z.string().max(2200).nullable().or(z.literal('')).optional(),
  scheduled_at: z.string().nullable().or(z.literal('')).optional(),
});

function emptyToNull<T extends string | null | undefined>(v: T): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function pickForm(formData: FormData, fields: string[]) {
  const out: Record<string, FormDataEntryValue | null> = {};
  for (const f of fields) {
    const v = formData.get(f);
    out[f] = v === null ? null : v;
  }
  return out;
}

export async function updateReelScript(
  id: string,
  formData: FormData,
): Promise<ReelActionResult> {
  const raw = pickForm(formData, [
    'title',
    'format',
    'category',
    'hook',
    'corpo',
    'chiusura',
    'cta',
    'notes',
  ]);
  const parsed = scriptSchema.safeParse({
    title: raw.title?.toString() ?? '',
    format: (raw.format?.toString() ?? 'other') as never,
    category: (raw.category?.toString() ?? 'adapted') as never,
    hook: emptyToNull(raw.hook?.toString()),
    corpo: emptyToNull(raw.corpo?.toString()),
    chiusura: emptyToNull(raw.chiusura?.toString()),
    cta: emptyToNull(raw.cta?.toString()),
    notes: emptyToNull(raw.notes?.toString()),
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('reels')
    .update(parsed.data)
    .eq('id', id)
    .select('id');
  // 42501: the script lock (from revisione on) or a column users may not write.
  if (error?.code === '42501') return { ok: false, error: 'not_authorized' };
  if (error) return { ok: false, error: 'unknown', message: error.message };
  // RLS filters rows silently: no row back means the user may not edit this reel.
  if (!data?.length) return { ok: false, error: 'not_authorized' };

  revalidatePath(`/reels/${id}`);
  return { ok: true };
}

export async function updateReelFiles(
  id: string,
  formData: FormData,
): Promise<ReelActionResult> {
  const parsed = filesSchema.safeParse({
    audio_drive_url: emptyToNull(formData.get('audio_drive_url')?.toString()),
    video_drive_url: emptyToNull(formData.get('video_drive_url')?.toString()),
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('reels')
    .update({
      audio_drive_url: parsed.data.audio_drive_url ?? null,
      video_drive_url: parsed.data.video_drive_url ?? null,
    })
    .eq('id', id)
    .select('id');
  // 42501: the script lock (from revisione on) or a column users may not write.
  if (error?.code === '42501') return { ok: false, error: 'not_authorized' };
  if (error) return { ok: false, error: 'unknown', message: error.message };
  if (!data?.length) return { ok: false, error: 'not_authorized' };

  revalidatePath(`/reels/${id}`);
  return { ok: true };
}

export async function updateReelPublish(
  id: string,
  formData: FormData,
): Promise<ReelActionResult> {
  const scheduledAtRaw = emptyToNull(formData.get('scheduled_at')?.toString());
  const parsed = publishSchema.safeParse({
    caption: emptyToNull(formData.get('caption')?.toString()),
    scheduled_at: scheduledAtRaw,
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  // scheduled_at comes from <input type="datetime-local">; convert to ISO if present.
  let scheduledAt: string | null = null;
  if (parsed.data.scheduled_at && parsed.data.scheduled_at !== '') {
    const d = new Date(parsed.data.scheduled_at);
    if (!Number.isNaN(d.getTime())) scheduledAt = d.toISOString();
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('reels')
    .update({
      caption: parsed.data.caption ?? null,
      scheduled_at: scheduledAt,
    })
    .eq('id', id)
    .select('id');
  // 42501: the script lock (from revisione on) or a column users may not write.
  if (error?.code === '42501') return { ok: false, error: 'not_authorized' };
  if (error) return { ok: false, error: 'unknown', message: error.message };
  if (!data?.length) return { ok: false, error: 'not_authorized' };

  revalidatePath(`/reels/${id}`);
  return { ok: true };
}
