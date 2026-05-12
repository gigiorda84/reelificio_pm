import type { PipelinePhase } from '@/lib/reels/constants';

export const ALERT_KINDS = ['buffer_low', 'phase_stuck'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_STATUSES = ['open', 'closed'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export type AlertRow = {
  id: string;
  kind: AlertKind;
  dedup_key: string;
  page_id: string | null;
  reel_id: string | null;
  phase: PipelinePhase | null;
  payload: Record<string, unknown>;
  status: AlertStatus;
  opened_at: string;
  last_seen_at: string;
  closed_at: string | null;
  closed_by: string | null;
  proposed_solution: string | null;
  created_at: string;
  updated_at: string;
};

// Stuck-phase threshold from BP §3.1. Kept generous in MVP; can move to a
// per-page config later.
export const PHASE_STUCK_MS = 24 * 60 * 60 * 1000;

export function dedupKeyFor(
  kind: AlertKind,
  parts: { pageId?: string | null; reelId?: string | null; phase?: PipelinePhase | null },
): string {
  if (kind === 'buffer_low') return `buffer_low:${parts.pageId ?? ''}`;
  return `phase_stuck:${parts.reelId ?? ''}:${parts.phase ?? ''}`;
}
