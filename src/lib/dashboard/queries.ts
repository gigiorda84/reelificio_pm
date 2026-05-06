import { getSupabaseServerClient } from '@/lib/supabase/server';
import {
  ALL_PIPELINE_PHASES,
  type PipelinePhase,
} from '@/lib/reels/constants';

export type DashboardPageStats = {
  id: string;
  name: string;
  code_prefix: string;
  buffer_threshold: number;
  total_in_flight: number;
  buffer_count: number;
  buffer_below_threshold: boolean;
  phase_counts: Record<PipelinePhase, number>;
};

export type DashboardRecentBatch = {
  id: string;
  label: string;
  page_name: string;
  page_code_prefix: string;
  reel_count: number;
  source_doc_synced_at: string | null;
  created_at: string;
};

export type DashboardData = {
  totals: {
    pages: number;
    batches: number;
    reels_in_flight: number;
    pending_requests: number;
  };
  pages: DashboardPageStats[];
  recent_batches: DashboardRecentBatch[];
};

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await getSupabaseServerClient();

  const [
    { data: pages },
    { data: reels },
    { data: batches },
    { count: batchTotalCount },
    { count: pendingCount },
  ] = await Promise.all([
    supabase
      .from('pages')
      .select('id, name, code_prefix, buffer_threshold, active')
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('reels')
      .select('id, page_id, phase')
      .in('phase', [...ALL_PIPELINE_PHASES]),
    supabase
      .from('batches')
      .select('id, page_id, label, source_doc_synced_at, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('batches')
      .select('id', { count: 'exact', head: true }),
    supabase
      .from('phase_advance_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
  ]);

  const pageList = pages ?? [];
  const reelList = reels ?? [];
  const batchList = batches ?? [];

  const pageStats: DashboardPageStats[] = pageList.map((p) => {
    const phase_counts = Object.fromEntries(
      ALL_PIPELINE_PHASES.map((ph) => [ph, 0]),
    ) as Record<PipelinePhase, number>;
    let total = 0;
    for (const r of reelList) {
      if (r.page_id !== p.id) continue;
      const ph = r.phase as PipelinePhase;
      if (phase_counts[ph] === undefined) continue;
      phase_counts[ph] += 1;
      total += 1;
    }
    const buffer_count = phase_counts.publication;
    return {
      id: p.id,
      name: p.name,
      code_prefix: p.code_prefix,
      buffer_threshold: p.buffer_threshold,
      total_in_flight: total,
      buffer_count,
      buffer_below_threshold: buffer_count < p.buffer_threshold,
      phase_counts,
    };
  });

  const pageById = new Map(pageList.map((p) => [p.id, p]));

  const reelCounts = new Map<string, number>();
  if (batchList.length) {
    const { data: counts } = await supabase
      .from('reels')
      .select('batch_id')
      .in(
        'batch_id',
        batchList.map((b) => b.id),
      );
    for (const c of counts ?? []) {
      reelCounts.set(c.batch_id, (reelCounts.get(c.batch_id) ?? 0) + 1);
    }
  }

  const recent_batches: DashboardRecentBatch[] = batchList.map((b) => {
    const p = pageById.get(b.page_id);
    return {
      id: b.id,
      label: b.label,
      page_name: p?.name ?? '—',
      page_code_prefix: p?.code_prefix ?? '??',
      reel_count: reelCounts.get(b.id) ?? 0,
      source_doc_synced_at: b.source_doc_synced_at,
      created_at: b.created_at,
    };
  });

  return {
    totals: {
      pages: pageList.length,
      batches: batchTotalCount ?? 0,
      reels_in_flight: reelList.length,
      pending_requests: pendingCount ?? 0,
    },
    pages: pageStats,
    recent_batches,
  };
}
