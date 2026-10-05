import { getSupabaseServerClient } from '@/lib/supabase/server';
import {
  ALL_PIPELINE_PHASES,
  type PipelinePhase,
  type ReelState,
} from '@/lib/reels/constants';
import type { TaskKind, TaskStatus } from '@/lib/tasks/constants';

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
  state: ReelState;
  track: 'batch' | 'express';
  // The open task (at most one), for the semaforo.
  task: PipelineTask | null;
};

export type PipelineTask = {
  kind: TaskKind;
  status: TaskStatus;
  started_at: string | null;
  yellow_at: string | null;
  due_at: string | null;
  escalate_at: string | null;
};

export type PipelineFilters = {
  pageId?: string;
  batchId?: string;
};

// Cards loaded per column. The oldest (most at risk) come first; the column
// header shows the real total so truncation is visible.
export const PIPELINE_COLUMN_LIMIT = 100;

export type PipelineBoard = {
  cards: Record<PipelinePhase, PipelineCard[]>;
  totals: Record<PipelinePhase, number>;
};

type BoardRow = {
  id: string;
  code: string;
  title: string;
  format: string;
  category: string;
  phase: PipelinePhase;
  phase_status: 'green' | 'yellow' | 'red';
  phase_entered_at: string;
  page_id: string;
  batch_id: string;
  state: ReelState;
  track: 'batch' | 'express';
  pages: { name: string; code_prefix: string } | null;
  batches: { label: string } | null;
  tasks: PipelineTask[];
};

// Active (not yet published) reels, one capped query per macro-phase (the
// columns stay the six RACI phases; `phase` follows the state). Page, batch
// and the open task come embedded, so no id lists are sent. Express first,
// then the longest in the phase.
export async function getPipelineBoard(
  filters: PipelineFilters = {},
): Promise<PipelineBoard> {
  const supabase = await getSupabaseServerClient();

  const results = await Promise.all(
    ALL_PIPELINE_PHASES.map(async (phase) => {
      let q = supabase
        .from('reels')
        .select(
          'id, code, title, format, category, phase, phase_status, phase_entered_at, page_id, batch_id, state, track, pages(name, code_prefix), batches(label), tasks(kind, status, started_at, yellow_at, due_at, escalate_at)',
          { count: 'exact' },
        )
        .eq('phase', phase)
        .is('published_at', null)
        .in('tasks.status', ['unassigned', 'assigned', 'in_progress'])
        .order('track', { ascending: false })
        .order('phase_entered_at', { ascending: true })
        .limit(PIPELINE_COLUMN_LIMIT);
      if (filters.pageId) q = q.eq('page_id', filters.pageId);
      if (filters.batchId) q = q.eq('batch_id', filters.batchId);

      const { data, count, error } = await q;
      if (error) throw error;
      return { phase, rows: (data ?? []) as unknown as BoardRow[], total: count ?? 0 };
    }),
  );

  const cards = {} as Record<PipelinePhase, PipelineCard[]>;
  const totals = {} as Record<PipelinePhase, number>;
  for (const { phase, rows, total } of results) {
    totals[phase] = total;
    cards[phase] = rows.map((r) => ({
      id: r.id,
      code: r.code,
      title: r.title,
      format: r.format,
      category: r.category,
      phase,
      phase_status: r.phase_status,
      phase_entered_at: r.phase_entered_at,
      page_id: r.page_id,
      page_name: r.pages?.name ?? '—',
      page_code_prefix: r.pages?.code_prefix ?? '??',
      batch_id: r.batch_id,
      batch_label: r.batches?.label ?? '—',
      state: r.state,
      track: r.track,
      task: r.tasks[0] ?? null,
    }));
  }

  return { cards, totals };
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
    .order('created_at', { ascending: false })
    .limit(100);
  if (pageId) q = q.eq('page_id', pageId);
  const { data } = await q;
  return (data ?? []) as { id: string; label: string; page_id: string }[];
}
