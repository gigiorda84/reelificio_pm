'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  ALL_PIPELINE_PHASES,
  PIPELINE_PHASE_ORDER,
  type PipelinePhase,
} from '@/lib/reels/constants';
import { generateInviteToken, buildInviteUrl } from './tokens';

export type InviteActionResult =
  | { ok: true; token?: string; url?: string }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'not_authenticated'
        | 'not_authorized'
        | 'invite_invalid'
        | 'reel_not_found'
        | 'already_pending'
        | 'invalid_phase'
        | 'unknown';
      message?: string;
    };

const DEFAULT_TTL_DAYS = 14;
const MAX_TTL_DAYS = 60;

const createSchema = z.object({
  reel_id: z.string().uuid(),
  external_label: z.string().min(1).max(120),
  invitee_email: z
    .string()
    .email()
    .max(200)
    .or(z.literal(''))
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  notes: z
    .string()
    .max(1000)
    .or(z.literal(''))
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  expires_in_days: z.coerce.number().int().min(1).max(MAX_TTL_DAYS).default(DEFAULT_TTL_DAYS),
});

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

export async function createInvite(formData: FormData): Promise<InviteActionResult> {
  const parsed = createSchema.safeParse({
    reel_id: formData.get('reel_id')?.toString() ?? '',
    external_label: (formData.get('external_label')?.toString() ?? '').trim(),
    invitee_email: (formData.get('invitee_email')?.toString() ?? '').trim(),
    notes: (formData.get('notes')?.toString() ?? '').trim(),
    expires_in_days:
      formData.get('expires_in_days')?.toString() ?? String(DEFAULT_TTL_DAYS),
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Confirm the reel exists (no need to check membership — admins can invite anywhere).
  const { data: reel } = await auth.supabase
    .from('reels')
    .select('id')
    .eq('id', parsed.data.reel_id)
    .maybeSingle();
  if (!reel) return { ok: false, error: 'reel_not_found' };

  const token = generateInviteToken();
  const expiresAt = new Date(
    Date.now() + parsed.data.expires_in_days * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error } = await auth.supabase.from('magic_link_invites').insert({
    token,
    reel_id: parsed.data.reel_id,
    scope: 'reel',
    external_label: parsed.data.external_label,
    invitee_email: parsed.data.invitee_email,
    notes: parsed.data.notes,
    expires_at: expiresAt,
    created_by: auth.userId,
  });
  if (error) return { ok: false, error: 'unknown', message: error.message };

  revalidatePath(`/reels/${parsed.data.reel_id}`);
  return { ok: true, token, url: buildInviteUrl(token) };
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
  const { data: reel } = await admin
    .from('reels')
    .select('id, phase')
    .eq('id', invite.reel_id)
    .maybeSingle();
  if (!reel) return { ok: false, error: 'reel_not_found' };

  const fromPhase = reel.phase as PipelinePhase;
  const fromOrder = PIPELINE_PHASE_ORDER[fromPhase];
  const toPhase = ALL_PIPELINE_PHASES[fromOrder + 1];
  if (!toPhase) return { ok: false, error: 'invalid_phase' };

  // One pending request per reel is enforced by the partial unique index.
  const { data: pending } = await admin
    .from('phase_advance_requests')
    .select('id')
    .eq('reel_id', reel.id)
    .eq('status', 'pending')
    .maybeSingle();
  if (pending) return { ok: false, error: 'already_pending' };

  const noteParts = [
    `Esterno: ${invite.external_label ?? 'collaboratore'}`,
    parsed.data.note ? parsed.data.note : null,
  ].filter(Boolean);

  const { error } = await admin.from('phase_advance_requests').insert({
    reel_id: reel.id,
    from_phase: fromPhase,
    to_phase: toPhase,
    requested_by: null,
    request_note: noteParts.join(' — '),
    status: 'pending',
  });
  if (error) return { ok: false, error: 'unknown', message: error.message };

  await admin
    .from('magic_link_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', invite.id);

  revalidatePath(`/invite/${parsed.data.token}`);
  return { ok: true };
}
