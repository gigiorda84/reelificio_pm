import 'server-only';
import { dispatchToMany } from './dispatch';
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

export async function notifyMentions(args: {
  authorId: string;
  body: string;
  mentionIds: string[];
  target: CommentTarget;
  targetId: string;
}): Promise<void> {
  const recipients = args.mentionIds.filter((id) => id !== args.authorId);
  if (recipients.length === 0) return;

  const supabase = getSupabaseAdminClient();
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
