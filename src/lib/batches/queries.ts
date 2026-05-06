import { getSupabaseServerClient } from '@/lib/supabase/server';

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

export async function listBatches(): Promise<BatchListRow[]> {
  const supabase = await getSupabaseServerClient();
  // Note: we run two queries instead of joining via Supabase's relational
  // syntax to keep this readable; cardinalities are tiny.
  const { data: batches, error } = await supabase
    .from('batches')
    .select(
      'id, page_id, label, source_doc_url, source_doc_synced_at, status, created_at',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (!batches || batches.length === 0) return [];

  const pageIds = Array.from(new Set(batches.map((b) => b.page_id)));
  const { data: pages } = await supabase
    .from('pages')
    .select('id, name, code_prefix')
    .in('id', pageIds);
  const pageMap = new Map((pages ?? []).map((p) => [p.id, p]));

  const { data: reelCounts } = await supabase
    .from('reels')
    .select('batch_id')
    .in(
      'batch_id',
      batches.map((b) => b.id),
    );
  const countMap = new Map<string, number>();
  for (const r of reelCounts ?? []) {
    countMap.set(r.batch_id, (countMap.get(r.batch_id) ?? 0) + 1);
  }

  return batches.map((b) => {
    const page = pageMap.get(b.page_id);
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
}

export type BatchReel = {
  id: string;
  code: string;
  ordinal: number;
  title: string;
  format: string;
  category: string;
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
      'id, code, ordinal, title, format, category, phase, phase_status, hook, parser_warning',
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
