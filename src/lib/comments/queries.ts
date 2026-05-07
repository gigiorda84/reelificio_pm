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

  const { data: comments, error } = await supabase
    .from('comments')
    .select('id, body, created_at, updated_at, parent_id, author_id, mentions')
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!comments || comments.length === 0) return [];

  const authorIds = Array.from(
    new Set(comments.map((c) => c.author_id).filter((x): x is string => !!x)),
  );
  const profileMap = new Map<string, { email: string; full_name: string | null }>();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', authorIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, { email: p.email, full_name: p.full_name });
    }
  }

  return comments.map((c) => ({
    id: c.id,
    body: c.body,
    created_at: c.created_at,
    updated_at: c.updated_at,
    parent_id: c.parent_id,
    author_id: c.author_id,
    author_email: c.author_id ? profileMap.get(c.author_id)?.email ?? null : null,
    author_full_name: c.author_id
      ? profileMap.get(c.author_id)?.full_name ?? null
      : null,
    mentions: (c.mentions as string[] | null) ?? [],
    is_own: !!user && c.author_id === user.id,
  }));
}
