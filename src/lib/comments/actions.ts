'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';

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
});

const editSchema = z.object({
  body: z.string().min(1).max(5000),
});

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
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  const { data, error } = await supabase
    .from('comments')
    .insert({
      target_type: parsed.data.target_type,
      target_id: parsed.data.target_id,
      parent_id: parsed.data.parent_id ?? null,
      body: parsed.data.body,
      author_id: user.id,
      mentions: [],
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: 'unknown' };

  targetRevalidate(parsed.data.target_type, parsed.data.target_id);
  return { ok: true, id: data.id };
}

export async function updateComment(
  id: string,
  formData: FormData,
): Promise<CommentActionResult> {
  const parsed = editSchema.safeParse({
    body: (formData.get('body')?.toString() ?? '').trim(),
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  // RLS already restricts UPDATE to author_id = auth.uid(); the explicit
  // .eq('author_id', user.id) below makes the intent visible.
  const { data, error } = await supabase
    .from('comments')
    .update({ body: parsed.data.body })
    .eq('id', id)
    .eq('author_id', user.id)
    .select('target_type, target_id')
    .maybeSingle();
  if (error) return { ok: false, error: 'unknown' };
  if (!data) return { ok: false, error: 'forbidden' };

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
