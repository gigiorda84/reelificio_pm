import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { VersionText } from './mix';

// Reads of script_versions (docs/fase2-plan.md D-E): the history and the AI
// alternatives of a reel. Internals only (RLS); externals get no rows.

export type VersionSource = 'ai' | 'mix' | 'manuale' | 'resync' | 'ripristino' | 'proposta' | 'import';

export type ScriptVersion = VersionText & {
  source: VersionSource;
  author_id: string | null;
  author_name: string | null;
  generation_id: string | null;
  base_version_id: string | null;
  block_sources: Record<string, string> | null;
  restored_from_id: string | null;
  script_rev: number | null;
  created_at: string;
};

const COLUMNS =
  'id, source, model, author_id, generation_id, base_version_id, block_sources, restored_from_id, ' +
  'hook, corpo, chiusura, cta, notes, script_rev, created_at';

async function withAuthors(rows: Omit<ScriptVersion, 'author_name'>[]): Promise<ScriptVersion[]> {
  const ids = [...new Set(rows.map((r) => r.author_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return rows.map((r) => ({ ...r, author_name: null }));
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
  const names = new Map((data ?? []).map((p) => [p.id as string, (p.full_name as string | null)?.trim() || (p.email as string)]));
  return rows.map((r) => ({ ...r, author_name: r.author_id ? names.get(r.author_id) ?? null : null }));
}

// The history: every version that the reel's text went through (not the
// alternatives that were never applied), newest first.
export async function listScriptHistory(reelId: string, limit = 50): Promise<ScriptVersion[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('script_versions')
    .select(COLUMNS)
    .eq('reel_id', reelId)
    .neq('source', 'ai')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return withAuthors((data ?? []) as unknown as Omit<ScriptVersion, 'author_name'>[]);
}

// The AI alternatives on offer: those of the latest generation (S6), or,
// before generations exist, the latest three.
export async function listAlternatives(reelId: string): Promise<ScriptVersion[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('script_versions')
    .select(COLUMNS)
    .eq('reel_id', reelId)
    .eq('source', 'ai')
    .order('created_at', { ascending: false })
    .limit(12);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Omit<ScriptVersion, 'author_name'>[];
  if (rows.length === 0) return [];
  const latest = rows[0].generation_id;
  const current = latest ? rows.filter((r) => r.generation_id === latest) : rows.filter((r) => !r.generation_id).slice(0, 3);
  // Oldest first, so the columns keep the order the models were asked in.
  return withAuthors(current.reverse());
}
