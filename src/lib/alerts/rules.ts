import 'server-only';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { type PipelinePhase } from '@/lib/reels/constants';
import { healthIssues, type JobHealth } from '@/lib/jobs/health';
import { dedupKeyFor, type AlertKind } from './types';

export type AlertProposal = {
  kind: AlertKind;
  dedup_key: string;
  page_id: string | null;
  reel_id: string | null;
  phase: PipelinePhase | null;
  payload: Record<string, unknown>;
};

// Rule 1: buffer < threshold (per page).
export async function proposeBufferLow(): Promise<AlertProposal[]> {
  const supabase = getSupabaseAdminClient();
  const { data: pages } = await supabase
    .from('pages')
    .select('id, name, code_prefix, buffer_threshold')
    .eq('active', true);
  if (!pages?.length) return [];

  // Buffer = reels ready in `publication` and not yet posted.
  const { data: counts } = await supabase.rpc('active_reel_counts');

  const bufferByPage = new Map<string, number>();
  for (const c of (counts ?? []) as { page_id: string; phase: string; reel_count: number }[]) {
    if (c.phase === 'publication') bufferByPage.set(c.page_id, Number(c.reel_count));
  }

  const proposals: AlertProposal[] = [];
  for (const p of pages) {
    const count = bufferByPage.get(p.id) ?? 0;
    if (count >= p.buffer_threshold) continue;
    proposals.push({
      kind: 'buffer_low',
      dedup_key: dedupKeyFor('buffer_low', { pageId: p.id }),
      page_id: p.id,
      reel_id: null,
      phase: null,
      payload: {
        page_name: p.name,
        page_code_prefix: p.code_prefix,
        buffer_count: count,
        buffer_threshold: p.buffer_threshold,
      },
    });
  }
  return proposals;
}

// `phase_stuck` is no longer proposed (Fase 1): task deadlines and the
// sweep's escalation replace it; open ones auto-close on the next run. The
// enum value stays for the history.
// Rule 2: system health (docs/fase1-plan.md §7.4) — sweep heartbeat older
// than 30 min, a due job waiting more than 30 min, dead letters in the last
// day, reels whose state disagrees with their tasks.
export async function proposeJobHealth(): Promise<AlertProposal[]> {
  const { data, error } = await getSupabaseAdminClient().rpc('job_health');
  if (error) throw error;
  const health = data as JobHealth | null;
  const issues = healthIssues(health);
  if (issues.length === 0) return [];
  return [
    {
      kind: 'job_health',
      dedup_key: dedupKeyFor('job_health', {}),
      page_id: null,
      reel_id: null,
      phase: null,
      payload: { issues, ...(health ?? {}) },
    },
  ];
}

export async function runAllRules(): Promise<AlertProposal[]> {
  const [buffer, health] = await Promise.all([proposeBufferLow(), proposeJobHealth()]);
  return [...buffer, ...health];
}
