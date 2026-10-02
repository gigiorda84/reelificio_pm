import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { ReelState } from '@/lib/reels/constants';

export type BatchListRow = {
  id: string;
  page_id: string;
  page_name: string;
  page_code_prefix: string;
  label: string;
  source_doc_url: string | null;
  source_doc_synced_at: string | null;
  status: 'draft' | 'active' | 'closed';
  reel_count: number;
  created_at: string;
};

// Newest batches first. ~50 pages produce ~600 batches a year, so the list
// is capped; `total` lets the page say when older batches are hidden.
export const BATCH_LIST_LIMIT = 200;

export async function listBatches(): Promise<{ rows: BatchListRow[]; total: number }> {
  const supabase = await getSupabaseServerClient();
  const { data: batches, count, error } = await supabase
    .from('batches')
    .select(
      'id, page_id, label, source_doc_url, source_doc_synced_at, status, created_at, pages(name, code_prefix)',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .limit(BATCH_LIST_LIMIT);
  if (error) throw error;
  if (!batches || batches.length === 0) return { rows: [], total: 0 };

  const { data: reelCounts } = await supabase.rpc('batch_reel_counts', {
    p_batch_ids: batches.map((b) => b.id),
  });
  const countMap = new Map<string, number>();
  for (const r of (reelCounts ?? []) as { batch_id: string; reel_count: number }[]) {
    countMap.set(r.batch_id, Number(r.reel_count));
  }

  const rows = batches.map((b) => {
    const page = b.pages as unknown as { name: string; code_prefix: string } | null;
    return {
      id: b.id,
      page_id: b.page_id,
      page_name: page?.name ?? '—',
      page_code_prefix: page?.code_prefix ?? '??',
      label: b.label,
      source_doc_url: b.source_doc_url,
      source_doc_synced_at: b.source_doc_synced_at,
      status: b.status,
      reel_count: countMap.get(b.id) ?? 0,
      created_at: b.created_at,
    };
  });
  return { rows, total: count ?? rows.length };
}

export type BatchReel = {
  id: string;
  code: string;
  ordinal: number;
  title: string;
  format: string;
  category: string;
  state: ReelState;
  phase: string;
  phase_status: string;
  hook: string | null;
  parser_warning: string | null;
};

export type BatchDetail = {
  id: string;
  page_id: string;
  page_name: string;
  page_code_prefix: string;
  label: string;
  source_doc_url: string | null;
  source_doc_id: string | null;
  source_doc_synced_at: string | null;
  source_doc_revision_id: string | null;
  status: 'draft' | 'active' | 'closed';
  created_at: string;
  reels: BatchReel[];
};

export async function getBatchDetail(id: string): Promise<BatchDetail | null> {
  const supabase = await getSupabaseServerClient();
  const { data: batch, error } = await supabase
    .from('batches')
    .select(
      'id, page_id, label, source_doc_url, source_doc_id, source_doc_synced_at, source_doc_revision_id, status, created_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!batch) return null;

  const { data: page } = await supabase
    .from('pages')
    .select('id, name, code_prefix')
    .eq('id', batch.page_id)
    .single();

  const { data: reels } = await supabase
    .from('reels')
    .select(
      'id, code, ordinal, title, format, category, state, phase, phase_status, hook, parser_warning',
    )
    .eq('batch_id', id)
    .order('ordinal', { ascending: true });

  return {
    id: batch.id,
    page_id: batch.page_id,
    page_name: page?.name ?? '—',
    page_code_prefix: page?.code_prefix ?? '??',
    label: batch.label,
    source_doc_url: batch.source_doc_url,
    source_doc_id: batch.source_doc_id,
    source_doc_synced_at: batch.source_doc_synced_at,
    source_doc_revision_id: batch.source_doc_revision_id,
    status: batch.status,
    created_at: batch.created_at,
    reels: (reels ?? []) as BatchReel[],
  };
}
