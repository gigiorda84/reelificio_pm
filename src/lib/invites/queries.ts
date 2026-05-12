import 'server-only';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export type InviteRow = {
  id: string;
  token: string;
  reel_id: string | null;
  external_label: string | null;
  invitee_email: string | null;
  notes: string | null;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
  created_at: string;
};

export type RedeemedInvite = {
  invite: InviteRow;
  reel: {
    id: string;
    batch_id: string;
    page_id: string;
    code: string;
    title: string;
    phase: string;
    hook: string | null;
    corpo: string | null;
    chiusura: string | null;
    cta: string | null;
    audio_drive_url: string | null;
    video_drive_url: string | null;
    page_name: string;
    batch_label: string;
  };
};

export async function listInvitesForReel(reelId: string): Promise<InviteRow[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('magic_link_invites')
    .select(
      'id, token, reel_id, external_label, invitee_email, notes, expires_at, revoked_at, used_at, created_at',
    )
    .eq('reel_id', reelId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as InviteRow[];
}

// Server-side redeem: used by the public /invite/[token] route. Bypasses RLS
// because the request is unauthenticated by design — the token IS the auth.
export async function redeemInviteToken(
  token: string,
): Promise<
  | { ok: true; data: RedeemedInvite }
  | { ok: false; error: 'not_found' | 'revoked' | 'expired' | 'no_reel' }
> {
  const admin = getSupabaseAdminClient();
  const { data: invite } = await admin
    .from('magic_link_invites')
    .select(
      'id, token, reel_id, external_label, invitee_email, notes, expires_at, revoked_at, used_at, created_at',
    )
    .eq('token', token)
    .maybeSingle();
  if (!invite) return { ok: false, error: 'not_found' };
  if (invite.revoked_at) return { ok: false, error: 'revoked' };
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'expired' };
  }
  if (!invite.reel_id) return { ok: false, error: 'no_reel' };

  const { data: reel } = await admin
    .from('reels')
    .select(
      'id, batch_id, page_id, code, title, phase, hook, corpo, chiusura, cta, audio_drive_url, video_drive_url',
    )
    .eq('id', invite.reel_id)
    .maybeSingle();
  if (!reel) return { ok: false, error: 'no_reel' };

  const [{ data: page }, { data: batch }] = await Promise.all([
    admin.from('pages').select('name').eq('id', reel.page_id).maybeSingle(),
    admin.from('batches').select('label').eq('id', reel.batch_id).maybeSingle(),
  ]);

  return {
    ok: true,
    data: {
      invite: invite as InviteRow,
      reel: {
        ...reel,
        page_name: page?.name ?? '—',
        batch_label: batch?.label ?? '—',
      },
    },
  };
}

export type InviteComment = {
  id: string;
  body: string;
  created_at: string;
  author_label: string;
  is_external: boolean;
};

export async function listInviteComments(reelId: string): Promise<InviteComment[]> {
  const admin = getSupabaseAdminClient();
  const { data: comments } = await admin
    .from('comments')
    .select('id, body, created_at, author_id, author_label, invite_id')
    .eq('target_type', 'reel')
    .eq('target_id', reelId)
    .order('created_at', { ascending: true });
  if (!comments) return [];

  const authorIds = Array.from(
    new Set(
      comments
        .map((c) => c.author_id as string | null)
        .filter((x): x is string => !!x),
    ),
  );
  const profileMap = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, email, full_name')
      .in('id', authorIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, (p.full_name as string | null) ?? (p.email as string));
    }
  }

  return comments.map((c) => ({
    id: c.id as string,
    body: c.body as string,
    created_at: c.created_at as string,
    is_external: !c.author_id,
    author_label: c.author_id
      ? profileMap.get(c.author_id as string) ?? '—'
      : (c.author_label as string | null) ?? 'Esterno',
  }));
}
