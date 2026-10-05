'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { notifyApproverOfExternalComment, notifyMentions } from '@/lib/notifications/mention';
import { getViewer } from '@/lib/auth/viewer';

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

// Mentions of people the author may name: profile_names() returns everyone
// to internals and, to externals, the people on their reels (I8).
async function resolveValidMentions(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.rpc('profile_names', { p_ids: ids });
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

// "Nota interna": only internals see it (RLS refuses it from externals).
function readInternalOnly(formData: FormData): boolean {
  const v = formData.get('internal_only');
  return v === 'on' || v === 'true';
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
  const internalOnly = readInternalOnly(formData);

  const { data, error } = await supabase
    .from('comments')
    .insert({
      target_type: parsed.data.target_type,
      target_id: parsed.data.target_id,
      parent_id: parsed.data.parent_id ?? null,
      body: parsed.data.body,
      author_id: user.id,
      mentions,
      internal_only: internalOnly,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: 'unknown' };

  // After the response: a notification failure shouldn't fail the comment,
  // and on Vercel an unawaited promise may be cut off.
  if (mentions.length > 0) {
    after(() =>
      notifyMentions({
        authorId: user.id,
        body: parsed.data.body,
        mentionIds: mentions,
        target: parsed.data.target_type,
        targetId: parsed.data.target_id,
        internalOnly,
      }).catch((err) => {
        console.error('[notifyMentions] post-comment dispatch failed', err);
      }),
    );
  }
  if (parsed.data.target_type === 'reel' && (await getViewer())?.isExternal) {
    after(() =>
      notifyApproverOfExternalComment({
        authorId: user.id,
        body: parsed.data.body,
        reelId: parsed.data.target_id,
        alreadyNotified: mentions,
      }).catch((err) => {
        console.error('[comments] approver notification failed', err);
      }),
    );
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
  // An internal may flip "Nota interna" on their own comment; for an
  // external it is always false (the only value RLS lets them write).
  const { data, error } = await supabase
    .from('comments')
    .update({ body: parsed.data.body, mentions, internal_only: readInternalOnly(formData) })
    .eq('id', id)
    .eq('author_id', user.id)
    .select('target_type, target_id, internal_only')
    .maybeSingle();
  if (error) return { ok: false, error: 'unknown' };
  if (!data) return { ok: false, error: 'forbidden' };

  const newlyMentioned = mentions.filter((m) => !previousMentions.includes(m));
  if (newlyMentioned.length > 0) {
    after(() =>
      notifyMentions({
        authorId: user.id,
        body: parsed.data.body,
        mentionIds: newlyMentioned,
        target: data.target_type as CommentTarget,
        targetId: data.target_id,
        internalOnly: data.internal_only,
      }).catch((err) => {
        console.error('[notifyMentions] update-comment dispatch failed', err);
      }),
    );
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
