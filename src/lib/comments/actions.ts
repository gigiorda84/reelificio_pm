'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { notifyMentions } from '@/lib/notifications/mention';

export type CommentActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: 'invalid_input' | 'not_authenticated' | 'forbidden' | 'unknown' };

const TARGETS = ['reel', 'batch', 'voice_brief'] as const;
type CommentTarget = (typeof TARGETS)[number];

const postSchema = z.object({
  target_type: z.enum(TARGETS),
  target_id: z.string().uuid(),
  body: z.string().min(1).max(5000),
  parent_id: z.string().uuid().nullable().optional(),
  mentions: z.array(z.string().uuid()).max(20).default([]),
});

const editSchema = z.object({
  body: z.string().min(1).max(5000),
  mentions: z.array(z.string().uuid()).max(20).default([]),
});

function readMentions(formData: FormData): string[] {
  const all = formData
    .getAll('mentions')
    .map((v) => v.toString().trim())
    .filter((v) => v.length > 0);
  return Array.from(new Set(all));
}

async function resolveValidMentions(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from('profiles').select('id').in('id', ids);
  return (data ?? []).map((r) => r.id as string);
}

function targetRevalidate(target: CommentTarget, id: string) {
  if (target === 'reel') revalidatePath(`/reels/${id}`);
  if (target === 'batch') revalidatePath(`/batches/${id}`);
  if (target === 'voice_brief') revalidatePath(`/pages`);
}

export async function postComment(
  formData: FormData,
): Promise<CommentActionResult> {
  const parsed = postSchema.safeParse({
    target_type: formData.get('target_type')?.toString() ?? '',
    target_id: formData.get('target_id')?.toString() ?? '',
    body: (formData.get('body')?.toString() ?? '').trim(),
    parent_id: formData.get('parent_id')?.toString() || null,
    mentions: readMentions(formData),
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  const mentions = await resolveValidMentions(supabase, parsed.data.mentions);

  const { data, error } = await supabase
    .from('comments')
    .insert({
      target_type: parsed.data.target_type,
      target_id: parsed.data.target_id,
      parent_id: parsed.data.parent_id ?? null,
      body: parsed.data.body,
      author_id: user.id,
      mentions,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: 'unknown' };

  if (mentions.length > 0) {
    // Fire-and-forget: a notification failure shouldn't fail the comment.
    notifyMentions({
      authorId: user.id,
      body: parsed.data.body,
      mentionIds: mentions,
      target: parsed.data.target_type,
      targetId: parsed.data.target_id,
    }).catch((err) => {
      console.error('[notifyMentions] post-comment dispatch failed', err);
    });
  }

  targetRevalidate(parsed.data.target_type, parsed.data.target_id);
  return { ok: true, id: data.id };
}

export async function updateComment(
  id: string,
  formData: FormData,
): Promise<CommentActionResult> {
  const parsed = editSchema.safeParse({
    body: (formData.get('body')?.toString() ?? '').trim(),
    mentions: readMentions(formData),
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  const mentions = await resolveValidMentions(supabase, parsed.data.mentions);

  // Fetch prior mentions to identify newly-added users.
  const { data: prior } = await supabase
    .from('comments')
    .select('mentions')
    .eq('id', id)
    .maybeSingle();
  const previousMentions = (prior?.mentions as string[] | null) ?? [];

  // RLS already restricts UPDATE to author_id = auth.uid(); the explicit
  // .eq('author_id', user.id) below makes the intent visible.
  const { data, error } = await supabase
    .from('comments')
    .update({ body: parsed.data.body, mentions })
    .eq('id', id)
    .eq('author_id', user.id)
    .select('target_type, target_id')
    .maybeSingle();
  if (error) return { ok: false, error: 'unknown' };
  if (!data) return { ok: false, error: 'forbidden' };

  const newlyMentioned = mentions.filter((m) => !previousMentions.includes(m));
  if (newlyMentioned.length > 0) {
    notifyMentions({
      authorId: user.id,
      body: parsed.data.body,
      mentionIds: newlyMentioned,
      target: data.target_type as CommentTarget,
      targetId: data.target_id,
    }).catch((err) => {
      console.error('[notifyMentions] update-comment dispatch failed', err);
    });
  }

  targetRevalidate(data.target_type as CommentTarget, data.target_id);
  return { ok: true };
}

export async function deleteComment(
  id: string,
): Promise<CommentActionResult> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  // Read target details so we can revalidate before deleting.
  const { data: existing } = await supabase
    .from('comments')
    .select('target_type, target_id, author_id')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'forbidden' };
  if (existing.author_id !== user.id) return { ok: false, error: 'forbidden' };

  const { error } = await supabase
    .from('comments')
    .delete()
    .eq('id', id)
    .eq('author_id', user.id);
  if (error) return { ok: false, error: 'unknown' };

  targetRevalidate(existing.target_type as CommentTarget, existing.target_id);
  return { ok: true };
}
