import { getSupabaseServerClient } from '@/lib/supabase/server';

// Reads of the ideas backlog (docs/fase2-plan.md S3). Internals only (RLS).

export type IdeaStatus = 'backlog' | 'scelta' | 'scartata';
export type IdeaSource = 'manuale' | 'doc';

export type Idea = {
  id: string;
  title: string;
  spunto: string | null;
  source: IdeaSource;
  status: IdeaStatus;
  reel_id: string | null;
  reel_code: string | null;
  created_at: string;
  decided_at: string | null;
};

type IdeaRow = Omit<Idea, 'reel_code'> & { reels: { code: string } | null };

const COLUMNS = 'id, title, spunto, source, status, reel_id, created_at, decided_at, reels(code)';
const toIdea = ({ reels, ...rest }: IdeaRow): Idea => ({ ...rest, reel_code: reels?.code ?? null });

// The whole backlog of a page, newest first. Chosen ideas are capped: they
// pile up month after month (every imported reel has one).
export async function listIdeas(pageId: string): Promise<Idea[]> {
  const supabase = await getSupabaseServerClient();
  const [open, chosen] = await Promise.all([
    supabase.from('ideas').select(COLUMNS).eq('page_id', pageId).in('status', ['backlog', 'scartata'])
      .order('created_at', { ascending: false }).limit(500),
    supabase.from('ideas').select(COLUMNS).eq('page_id', pageId).eq('status', 'scelta')
      .order('decided_at', { ascending: false }).limit(200),
  ]);
  if (open.error) throw open.error;
  if (chosen.error) throw chosen.error;
  return [...(open.data ?? []), ...(chosen.data ?? [])].map((r) => toIdea(r as unknown as IdeaRow));
}

export async function countIdeas(pageId: string): Promise<Record<IdeaStatus, number>> {
  const supabase = await getSupabaseServerClient();
  const count = async (status: IdeaStatus) => {
    const { count: n, error } = await supabase
      .from('ideas')
      .select('id', { count: 'exact', head: true })
      .eq('page_id', pageId)
      .eq('status', status);
    if (error) throw error;
    return n ?? 0;
  };
  const [backlog, scelta, scartata] = await Promise.all([count('backlog'), count('scelta'), count('scartata')]);
  return { backlog, scelta, scartata };
}

export async function getIdeaForReel(reelId: string): Promise<Idea | null> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.from('ideas').select(COLUMNS).eq('reel_id', reelId).maybeSingle();
  if (error) throw error;
  return data ? toIdea(data as unknown as IdeaRow) : null;
}

// Batches of the page born from ideas, newest month first: ideas can be
// added to them (never to an import batch).
export type IdeasBatch = { id: string; label: string; period: string };

export async function listIdeasBatches(pageId: string): Promise<IdeasBatch[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('batches')
    .select('id, label, period')
    .eq('page_id', pageId)
    .eq('origin', 'ideas')
    .order('period', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(24);
  if (error) throw error;
  return (data ?? []) as IdeasBatch[];
}
