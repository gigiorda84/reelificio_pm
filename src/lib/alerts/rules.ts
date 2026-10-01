import 'server-only';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { type PipelinePhase } from '@/lib/reels/constants';
import { PHASE_STUCK_MS, dedupKeyFor, type AlertKind } from './types';

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

// Rule 2: a reel has sat in the same phase > 24h with no comment activity.
export async function proposePhaseStuck(now = new Date()): Promise<AlertProposal[]> {
  const supabase = getSupabaseAdminClient();
  const cutoff = new Date(now.getTime() - PHASE_STUCK_MS).toISOString();

  // Working-phase reels entered before the cutoff with no reel comment since
  // then; the comment check runs in SQL (no long id lists over the wire).
  const { data: reels, error } = await supabase.rpc('stuck_reels', { p_cutoff: cutoff });
  if (error) throw error;
  if (!reels?.length) return [];

  const proposals: AlertProposal[] = [];
  for (const r of reels as {
    id: string;
    code: string;
    title: string;
    page_id: string;
    phase: string;
    phase_entered_at: string;
  }[]) {
    const phase = r.phase as PipelinePhase;
    proposals.push({
      kind: 'phase_stuck',
      dedup_key: dedupKeyFor('phase_stuck', { reelId: r.id, phase }),
      page_id: r.page_id,
      reel_id: r.id,
      phase,
      payload: {
        reel_code: r.code,
        reel_title: r.title,
        phase,
        phase_entered_at: r.phase_entered_at,
        hours_in_phase: Math.floor(
          (now.getTime() - new Date(r.phase_entered_at).getTime()) / 3_600_000,
        ),
      },
    });
  }
  return proposals;
}

export async function runAllRules(now = new Date()): Promise<AlertProposal[]> {
  const [a, b] = await Promise.all([proposeBufferLow(), proposePhaseStuck(now)]);
  return [...a, ...b];
}
