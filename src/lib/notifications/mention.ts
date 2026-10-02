import 'server-only';
import { dispatchToMany } from './dispatch';
import {
  mentionRecipients,
  taskGrantsVisibility,
  type ProfileLike,
  type TaskLike,
} from './recipients';
import type { CommentTarget } from '@/lib/comments/queries';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';
}

async function targetLink(
  target: CommentTarget,
  targetId: string,
): Promise<{ url: string; label: string }> {
  const base = appUrl();
  const supabase = getSupabaseAdminClient();
  if (target === 'reel') {
    const { data } = await supabase
      .from('reels')
      .select('code, title')
      .eq('id', targetId)
      .maybeSingle();
    return {
      url: `${base}/reels/${targetId}`,
      label: data ? `${data.code} — ${data.title}` : 'reel',
    };
  }
  if (target === 'batch') {
    const { data } = await supabase
      .from('batches')
      .select('label')
      .eq('id', targetId)
      .maybeSingle();
    return {
      url: `${base}/batches/${targetId}`,
      label: data?.label ?? 'batch',
    };
  }
  // voice_brief is always per-page; the targetId is the voice_brief.id, find page.
  const { data } = await supabase
    .from('voice_briefs')
    .select('page_id, pages:pages(name, id)')
    .eq('id', targetId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = (data as any)?.pages;
  return {
    url: page?.id ? `${base}/pages/${page.id}` : `${base}/pages`,
    label: page?.name ? `Voice brief — ${page.name}` : 'voice brief',
  };
}

// Mentioned externals who can see the reel (tasks; see recipients.ts). Only
// reel threads are open to externals.
async function externalsWhoSeeTarget(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  target: CommentTarget,
  targetId: string,
  mentioned: ProfileLike[],
): Promise<Set<string>> {
  const externalIds = mentioned.filter((p) => p.account_type === 'external').map((p) => p.id);
  if (target !== 'reel' || externalIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('tasks')
    .select('assignee_id, status, closed_at')
    .eq('reel_id', targetId)
    .in('assignee_id', externalIds);
  if (error) {
    console.error('[mention] tasks lookup failed, externals skipped', error.message);
    return new Set();
  }
  return new Set(
    ((data ?? []) as TaskLike[])
      .filter((t) => taskGrantsVisibility(t))
      .map((t) => t.assignee_id as string),
  );
}

export async function notifyMentions(args: {
  authorId: string;
  body: string;
  mentionIds: string[];
  target: CommentTarget;
  targetId: string;
  // An internal-only comment never notifies an external, even if mentioned.
  internalOnly?: boolean;
}): Promise<void> {
  const candidates = args.mentionIds.filter((id) => id !== args.authorId);
  if (candidates.length === 0) return;

  const supabase = getSupabaseAdminClient();
  // `*` keeps this working before the Fase 1 columns exist (see recipients.ts).
  const { data } = await supabase.from('profiles').select('*').in('id', candidates);
  const mentioned = (data ?? []) as ProfileLike[];
  const recipients = mentionRecipients({
    authorId: args.authorId,
    mentioned,
    internalOnly: args.internalOnly ?? false,
    externalsWhoSeeTarget: await externalsWhoSeeTarget(supabase, args.target, args.targetId, mentioned),
  });
  if (recipients.length === 0) return;

  const { data: author } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', args.authorId)
    .maybeSingle();
  const authorLabel = author?.full_name?.trim() || author?.email || 'Qualcuno';
  const link = await targetLink(args.target, args.targetId);

  const subject = `${authorLabel} ti ha menzionato in ${link.label}`;
  const text = `${args.body}\n\nApri: ${link.url}`;
  const html = `
    <p>${escapeHtml(authorLabel)} ti ha menzionato in <a href="${link.url}">${escapeHtml(link.label)}</a>:</p>
    <blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#444;">
      ${escapeHtml(args.body).replace(/\n/g, '<br/>')}
    </blockquote>
    <p><a href="${link.url}">Apri il commento</a></p>
  `.trim();

  await dispatchToMany(recipients, 'mention', {
    subject,
    text,
    html,
    meta: { target: args.target, target_id: args.targetId, link: link.url },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
