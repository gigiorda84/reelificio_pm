import 'server-only';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { runAllRules, type AlertProposal } from './rules';
import { dispatchAlertOpened } from './dispatch';
import type { AlertRow } from './types';

export type EvaluatorReport = {
  proposals: number;
  opened: number;
  refreshed: number;
  auto_closed: number;
};

export async function evaluateAlerts(now = new Date()): Promise<EvaluatorReport> {
  const supabase = getSupabaseAdminClient();
  const proposals = await runAllRules(now);

  // Snapshot currently-open alerts, keyed by dedup_key.
  const { data: openAlerts } = await supabase
    .from('alerts')
    .select('id, kind, dedup_key, page_id, reel_id, phase, payload, status, opened_at, last_seen_at, closed_at, closed_by, proposed_solution, created_at, updated_at')
    .eq('status', 'open');
  const openByKey = new Map<string, AlertRow>();
  for (const a of (openAlerts ?? []) as AlertRow[]) openByKey.set(a.dedup_key, a);

  const seenKeys = new Set<string>();
  let opened = 0;
  let refreshed = 0;
  const nowIso = now.toISOString();

  const newlyOpened: { proposal: AlertProposal; id: string }[] = [];

  for (const p of proposals) {
    seenKeys.add(p.dedup_key);
    const existing = openByKey.get(p.dedup_key);
    if (existing) {
      await supabase
        .from('alerts')
        .update({ last_seen_at: nowIso, payload: p.payload })
        .eq('id', existing.id);
      refreshed += 1;
      continue;
    }
    const { data: inserted } = await supabase
      .from('alerts')
      .insert({
        kind: p.kind,
        dedup_key: p.dedup_key,
        page_id: p.page_id,
        reel_id: p.reel_id,
        phase: p.phase,
        payload: p.payload,
        status: 'open',
        opened_at: nowIso,
        last_seen_at: nowIso,
      })
      .select('id')
      .single();
    if (inserted?.id) {
      opened += 1;
      newlyOpened.push({ proposal: p, id: inserted.id });
    }
  }

  // Auto-close alerts whose condition no longer fires. They auto-resolved, so
  // proposed_solution stays null (BP §6.2 only requires it for manual close).
  let auto_closed = 0;
  for (const [key, alert] of openByKey) {
    if (seenKeys.has(key)) continue;
    await supabase
      .from('alerts')
      .update({
        status: 'closed',
        closed_at: nowIso,
        proposed_solution: '[auto-risolto]',
      })
      .eq('id', alert.id);
    auto_closed += 1;
  }

  // Dispatch notifications only for the newly-opened alerts (avoid spam).
  for (const item of newlyOpened) {
    await dispatchAlertOpened(item.proposal, item.id);
  }

  return {
    proposals: proposals.length,
    opened,
    refreshed,
    auto_closed,
  };
}
