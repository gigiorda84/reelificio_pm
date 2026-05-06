import { getSupabaseServerClient } from '@/lib/supabase/server';
import {
  ALL_PIPELINE_PHASES,
  type PipelinePhase,
} from '@/lib/reels/constants';

export type PipelineCard = {
  id: string;
  code: string;
  title: string;
  format: string;
  category: string;
  phase: PipelinePhase;
  phase_status: 'green' | 'yellow' | 'red';
  phase_entered_at: string;
  page_id: string;
  page_name: string;
  page_code_prefix: string;
  batch_id: string;
  batch_label: string;
  has_pending_request: boolean;
};

export type PipelineFilters = {
  pageId?: string;
  batchId?: string;
};

export async function getPipelineBoard(
  filters: PipelineFilters = {},
): Promise<Record<PipelinePhase, PipelineCard[]>> {
  const supabase = await getSupabaseServerClient();

  let q = supabase
    .from('reels')
    .select(
      'id, code, title, format, category, phase, phase_status, phase_entered_at, page_id, batch_id',
    )
    .in('phase', [...ALL_PIPELINE_PHASES])
    .order('phase_entered_at', { ascending: true });

  if (filters.pageId) q = q.eq('page_id', filters.pageId);
  if (filters.batchId) q = q.eq('batch_id', filters.batchId);

  const { data: reels, error } = await q;
  if (error) throw error;

  const list = reels ?? [];
  const pageIds = Array.from(new Set(list.map((r) => r.page_id)));
  const batchIds = Array.from(new Set(list.map((r) => r.batch_id)));
  const reelIds = list.map((r) => r.id);

  const [{ data: pages }, { data: batches }, { data: pendings }] =
    await Promise.all([
      pageIds.length
        ? supabase.from('pages').select('id, name, code_prefix').in('id', pageIds)
        : Promise.resolve({ data: [] as { id: string; name: string; code_prefix: string }[] }),
      batchIds.length
        ? supabase.from('batches').select('id, label').in('id', batchIds)
        : Promise.resolve({ data: [] as { id: string; label: string }[] }),
      reelIds.length
        ? supabase
            .from('phase_advance_requests')
            .select('reel_id')
            .in('reel_id', reelIds)
            .eq('status', 'pending')
        : Promise.resolve({ data: [] as { reel_id: string }[] }),
    ]);

  const pageById = new Map((pages ?? []).map((p) => [p.id, p]));
  const batchById = new Map((batches ?? []).map((b) => [b.id, b]));
  const pendingSet = new Set((pendings ?? []).map((p) => p.reel_id));

  const board = {} as Record<PipelinePhase, PipelineCard[]>;
  for (const phase of ALL_PIPELINE_PHASES) board[phase] = [];

  for (const r of list) {
    const phase = r.phase as PipelinePhase;
    if (!board[phase]) continue; // skip deprecated values (qc/published)
    const page = pageById.get(r.page_id);
    const batch = batchById.get(r.batch_id);
    board[phase].push({
      id: r.id,
      code: r.code,
      title: r.title,
      format: r.format,
      category: r.category,
      phase,
      phase_status: r.phase_status as 'green' | 'yellow' | 'red',
      phase_entered_at: r.phase_entered_at,
      page_id: r.page_id,
      page_name: page?.name ?? '—',
      page_code_prefix: page?.code_prefix ?? '??',
      batch_id: r.batch_id,
      batch_label: batch?.label ?? '—',
      has_pending_request: pendingSet.has(r.id),
    });
  }

  return board;
}

export async function listPagesForFilter() {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from('pages')
    .select('id, name')
    .eq('active', true)
    .order('name', { ascending: true });
  return (data ?? []) as { id: string; name: string }[];
}

export async function listBatchesForFilter(pageId?: string) {
  const supabase = await getSupabaseServerClient();
  let q = supabase
    .from('batches')
    .select('id, label, page_id')
    .order('created_at', { ascending: false });
  if (pageId) q = q.eq('page_id', pageId);
  const { data } = await q;
  return (data ?? []) as { id: string; label: string; page_id: string }[];
}
