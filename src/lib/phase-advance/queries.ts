import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { PipelinePhase } from '@/lib/reels/constants';

export type PhaseAdvanceRequest = {
  id: string;
  reel_id: string;
  from_phase: PipelinePhase;
  to_phase: PipelinePhase;
  requested_by: string | null;
  request_note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  requester_name: string | null;
  decider_name: string | null;
};

export async function getPendingRequestForReel(
  reelId: string,
): Promise<PhaseAdvanceRequest | null> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('phase_advance_requests')
    .select(
      'id, reel_id, from_phase, to_phase, requested_by, request_note, status, decided_by, decided_at, decision_note, created_at',
    )
    .eq('reel_id', reelId)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const ids = [data.requested_by, data.decided_by].filter(
    (v): v is string => !!v,
  );
  let nameById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ids);
    nameById = new Map(
      (profiles ?? []).map((p) => [p.id, p.full_name || p.email]),
    );
  }

  return {
    ...data,
    requester_name: data.requested_by ? nameById.get(data.requested_by) ?? null : null,
    decider_name: data.decided_by ? nameById.get(data.decided_by) ?? null : null,
  } as PhaseAdvanceRequest;
}

export async function getRecentDecisionsForReel(
  reelId: string,
  limit = 5,
): Promise<PhaseAdvanceRequest[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('phase_advance_requests')
    .select(
      'id, reel_id, from_phase, to_phase, requested_by, request_note, status, decided_by, decided_at, decision_note, created_at',
    )
    .eq('reel_id', reelId)
    .neq('status', 'pending')
    .order('decided_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const ids = Array.from(
    new Set(
      data.flatMap((r) => [r.requested_by, r.decided_by].filter(
        (v): v is string => !!v,
      )),
    ),
  );
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', ids);
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.id, p.full_name || p.email]),
  );

  return data.map((r) => ({
    ...r,
    requester_name: r.requested_by ? nameById.get(r.requested_by) ?? null : null,
    decider_name: r.decided_by ? nameById.get(r.decided_by) ?? null : null,
  })) as PhaseAdvanceRequest[];
}
