import { getSupabaseServerClient } from '@/lib/supabase/server';

export type CommentTarget = 'reel' | 'batch' | 'voice_brief';

export type CommentRow = {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
  parent_id: string | null;
  author_id: string | null;
  author_email: string | null;
  author_full_name: string | null;
  mentions: string[];
  internal_only: boolean;
  is_own: boolean;
};

export async function listComments(
  targetType: CommentTarget,
  targetId: string,
): Promise<CommentRow[]> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS hides internal-only comments from externals.
  const { data: comments, error } = await supabase
    .from('comments')
    .select('id, body, created_at, updated_at, parent_id, author_id, mentions, internal_only')
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!comments || comments.length === 0) return [];

  const authorIds = Array.from(
    new Set(comments.map((c) => c.author_id).filter((x): x is string => !!x)),
  );
  // Names through profile_names(), which externals may call (people on their
  // reels, never emails). Emails only where RLS shows the profile: every
  // profile to internals, their own row to externals.
  const names = new Map<string, string | null>();
  const emails = new Map<string, string>();
  if (authorIds.length > 0) {
    const [{ data: named }, { data: profiles }] = await Promise.all([
      supabase.rpc('profile_names', { p_ids: authorIds }),
      supabase.from('profiles').select('id, email').in('id', authorIds),
    ]);
    for (const p of (named ?? []) as { id: string; full_name: string | null }[]) {
      names.set(p.id, p.full_name);
    }
    for (const p of profiles ?? []) emails.set(p.id, p.email);
  }

  return comments.map((c) => ({
    id: c.id,
    body: c.body,
    created_at: c.created_at,
    updated_at: c.updated_at,
    parent_id: c.parent_id,
    author_id: c.author_id,
    author_email: c.author_id ? emails.get(c.author_id) ?? null : null,
    author_full_name: c.author_id ? names.get(c.author_id) ?? null : null,
    mentions: (c.mentions as string[] | null) ?? [],
    internal_only: !!c.internal_only,
    is_own: !!user && c.author_id === user.id,
  }));
}
