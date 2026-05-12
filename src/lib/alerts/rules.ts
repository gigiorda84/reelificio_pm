import 'server-only';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { ALL_PIPELINE_PHASES, type PipelinePhase } from '@/lib/reels/constants';
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

  const { data: reels } = await supabase
    .from('reels')
    .select('page_id')
    .eq('phase', 'publication');

  const bufferByPage = new Map<string, number>();
  for (const r of reels ?? []) {
    bufferByPage.set(r.page_id, (bufferByPage.get(r.page_id) ?? 0) + 1);
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

  const { data: reels } = await supabase
    .from('reels')
    .select('id, code, title, page_id, phase, phase_entered_at')
    .in('phase', [...ALL_PIPELINE_PHASES])
    .neq('phase', 'publication')
    .lt('phase_entered_at', cutoff);
  if (!reels?.length) return [];

  // Pull recent comments on these reels in one shot.
  const reelIds = reels.map((r) => r.id);
  const { data: recentComments } = await supabase
    .from('comments')
    .select('target_id, created_at')
    .eq('target_type', 'reel')
    .in('target_id', reelIds)
    .gte('created_at', cutoff);

  const recentByReel = new Set<string>();
  for (const c of recentComments ?? []) recentByReel.add(c.target_id);

  const proposals: AlertProposal[] = [];
  for (const r of reels) {
    if (recentByReel.has(r.id)) continue;
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
