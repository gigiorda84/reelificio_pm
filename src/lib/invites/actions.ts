'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { dispatchNotification } from '@/lib/notifications/dispatch';

// Since Fase 1 (R1) collaborators have accounts: no new invites are created.
// Existing ones keep working until they expire (comments, file links, "work
// ready"), and admins can revoke them.
export type InviteActionResult =
  | { ok: true }
  | {
      ok: false;
      error: 'invalid_input' | 'not_authenticated' | 'not_authorized' | 'invite_invalid' | 'unknown';
      message?: string;
    };

async function requireAdmin() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'not_authenticated' as const };
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false as const, error: 'not_authorized' as const };
  return { ok: true as const, userId: user.id, supabase };
}

export async function revokeInvite(
  inviteId: string,
): Promise<InviteActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data: existing } = await auth.supabase
    .from('magic_link_invites')
    .select('id, reel_id, revoked_at')
    .eq('id', inviteId)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'invite_invalid' };

  if (!existing.revoked_at) {
    const { error } = await auth.supabase
      .from('magic_link_invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', inviteId);
    if (error) return { ok: false, error: 'unknown', message: error.message };
  }

  if (existing.reel_id) revalidatePath(`/reels/${existing.reel_id}`);
  return { ok: true };
}

// ---- Invitee-side actions (token-authenticated; bypass RLS via admin client) -----

const inviteeCommentSchema = z.object({
  token: z.string().min(20).max(80),
  body: z.string().min(1).max(5000),
});

const inviteeFilesSchema = z.object({
  token: z.string().min(20).max(80),
  audio_drive_url: z.string().url().or(z.literal('')).optional(),
  video_drive_url: z.string().url().or(z.literal('')).optional(),
});

const inviteeMarkDoneSchema = z.object({
  token: z.string().min(20).max(80),
  note: z.string().max(2000).or(z.literal('')).optional(),
});

async function loadActiveInvite(token: string) {
  const admin = getSupabaseAdminClient();
  const { data: invite } = await admin
    .from('magic_link_invites')
    .select('id, reel_id, scope, external_label, expires_at, revoked_at')
    .eq('token', token)
    .maybeSingle();
  if (!invite || invite.revoked_at) return null;
  if (new Date(invite.expires_at).getTime() < Date.now()) return null;
  if (!invite.reel_id) return null;
  return invite;
}

export async function postCommentAsInvitee(
  formData: FormData,
): Promise<InviteActionResult> {
  const parsed = inviteeCommentSchema.safeParse({
    token: formData.get('token')?.toString() ?? '',
    body: (formData.get('body')?.toString() ?? '').trim(),
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const invite = await loadActiveInvite(parsed.data.token);
  if (!invite) return { ok: false, error: 'invite_invalid' };

  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('comments').insert({
    target_type: 'reel',
    target_id: invite.reel_id,
    body: parsed.data.body,
    author_id: null,
    invite_id: invite.id,
    author_label: invite.external_label ?? 'Esterno',
  });
  if (error) return { ok: false, error: 'unknown', message: error.message };

  // Touch used_at so the admin list shows engagement.
  await admin
    .from('magic_link_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', invite.id);

  revalidatePath(`/invite/${parsed.data.token}`);
  return { ok: true };
}

export async function updateFilesAsInvitee(
  formData: FormData,
): Promise<InviteActionResult> {
  const parsed = inviteeFilesSchema.safeParse({
    token: formData.get('token')?.toString() ?? '',
    audio_drive_url: formData.get('audio_drive_url')?.toString() ?? '',
    video_drive_url: formData.get('video_drive_url')?.toString() ?? '',
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const invite = await loadActiveInvite(parsed.data.token);
  if (!invite) return { ok: false, error: 'invite_invalid' };

  const admin = getSupabaseAdminClient();
  const update: Record<string, string | null> = {};
  if (parsed.data.audio_drive_url !== undefined) {
    update.audio_drive_url = parsed.data.audio_drive_url || null;
  }
  if (parsed.data.video_drive_url !== undefined) {
    update.video_drive_url = parsed.data.video_drive_url || null;
  }
  if (Object.keys(update).length === 0) return { ok: true };

  const { error } = await admin.from('reels').update(update).eq('id', invite.reel_id);
  if (error) return { ok: false, error: 'unknown', message: error.message };

  await admin
    .from('magic_link_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', invite.id);

  revalidatePath(`/invite/${parsed.data.token}`);
  return { ok: true };
}

// "Work ready" from an invite link: a comment on the reel and a message to
// whoever holds the reel's open task; the task engine decides what comes
// next (before Fase 1 this filed a phase-advance request outside the engine).
export async function markDoneAsInvitee(
  formData: FormData,
): Promise<InviteActionResult> {
  const parsed = inviteeMarkDoneSchema.safeParse({
    token: formData.get('token')?.toString() ?? '',
    note: formData.get('note')?.toString() ?? '',
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const invite = await loadActiveInvite(parsed.data.token);
  if (!invite) return { ok: false, error: 'invite_invalid' };

  const admin = getSupabaseAdminClient();
  const label = invite.external_label ?? 'Esterno';
  const body = ['Lavoro pronto', parsed.data.note?.trim() || null].filter(Boolean).join(' — ');
  const { error } = await admin.from('comments').insert({
    target_type: 'reel',
    target_id: invite.reel_id,
    body,
    author_id: null,
    invite_id: invite.id,
    author_label: label,
  });
  if (error) return { ok: false, error: 'unknown', message: error.message };

  const [{ data: task }, { data: reel }] = await Promise.all([
    admin
      .from('tasks')
      .select('assignee_id')
      .eq('reel_id', invite.reel_id)
      .in('status', ['unassigned', 'assigned', 'in_progress'])
      .maybeSingle(),
    admin.from('reels').select('code, title').eq('id', invite.reel_id).maybeSingle(),
  ]);
  if (task?.assignee_id) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
    const link = `${appUrl}/reels/${invite.reel_id}`;
    const subject = `${label}: lavoro pronto su ${reel?.code ?? 'un reel'}`;
    await dispatchNotification({
      recipientId: task.assignee_id,
      event: 'mention',
      payload: { subject, text: `${body}\n\nApri: ${link}`, html: `<p>${subject}</p><p><a href="${link}">Apri il reel</a></p>` },
    }).catch((err) => console.error('[invite] notify failed', err));
  }

  await admin
    .from('magic_link_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', invite.id);

  revalidatePath(`/invite/${parsed.data.token}`);
  return { ok: true };
}
