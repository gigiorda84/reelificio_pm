'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import {
  ALL_PIPELINE_PHASES,
  PIPELINE_PHASE_ORDER,
  type PipelinePhase,
} from '@/lib/reels/constants';
import { getRaciUsers, type RaciRow } from '@/lib/raci/queries';

export type PhaseAdvanceResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'not_authorized'
        | 'reel_not_found'
        | 'already_pending'
        | 'request_not_found'
        | 'unknown';
      message?: string;
    };

const requestSchema = z.object({
  reel_id: z.string().uuid(),
  to_phase: z.enum(ALL_PIPELINE_PHASES),
  request_note: z.string().max(2000).optional(),
});

const decisionSchema = z.object({
  request_id: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  decision_note: z.string().max(2000).optional(),
});

async function loadReelAndRaci(reelId: string) {
  const supabase = await getSupabaseServerClient();
  const { data: reel } = await supabase
    .from('reels')
    .select('id, page_id, phase, batch_id')
    .eq('id', reelId)
    .maybeSingle();
  if (!reel) return null;

  const { data: raci } = await supabase
    .from('raci_configs')
    .select('responsible, approver, consulted, informed, page_id, phase')
    .eq('page_id', reel.page_id)
    .eq('phase', reel.phase)
    .maybeSingle();

  return { reel, raci: (raci ?? null) as RaciRow | null };
}

export async function requestPhaseAdvance(
  formData: FormData,
): Promise<PhaseAdvanceResult> {
  const parsed = requestSchema.safeParse({
    reel_id: formData.get('reel_id')?.toString() ?? '',
    to_phase: (formData.get('to_phase')?.toString() ?? '') as PipelinePhase,
    request_note: formData.get('request_note')?.toString() || undefined,
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  const ctx = await loadReelAndRaci(parsed.data.reel_id);
  if (!ctx) return { ok: false, error: 'reel_not_found' };
  const { reel, raci } = ctx;

  // Direction check: target phase must be exactly one step forward, OR backward
  // (rejection-style move). We enforce one-step-forward here for the request flow.
  const fromOrder = PIPELINE_PHASE_ORDER[reel.phase as PipelinePhase];
  const toOrder = PIPELINE_PHASE_ORDER[parsed.data.to_phase];
  if (toOrder !== fromOrder + 1) return { ok: false, error: 'invalid_input' };

  // Authorization: user must be R for current phase, or admin.
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  const isAdmin = !!profile?.is_admin;
  const isResponsible = !!raci && getRaciUsers(raci, 'responsible').includes(user.id);
  if (!isAdmin && !isResponsible) return { ok: false, error: 'not_authorized' };

  // Reject if a pending request already exists.
  const { data: existing } = await supabase
    .from('phase_advance_requests')
    .select('id')
    .eq('reel_id', reel.id)
    .eq('status', 'pending')
    .maybeSingle();
  if (existing) return { ok: false, error: 'already_pending' };

  const { error } = await supabase.from('phase_advance_requests').insert({
    reel_id: reel.id,
    from_phase: reel.phase,
    to_phase: parsed.data.to_phase,
    requested_by: user.id,
    request_note: parsed.data.request_note ?? null,
    status: 'pending',
  });
  if (error) return { ok: false, error: 'unknown', message: error.message };

  revalidatePath(`/reels/${reel.id}`);
  revalidatePath('/pipeline');
  return { ok: true };
}

export async function decidePhaseAdvance(
  formData: FormData,
): Promise<PhaseAdvanceResult> {
  const parsed = decisionSchema.safeParse({
    request_id: formData.get('request_id')?.toString() ?? '',
    decision: (formData.get('decision')?.toString() ?? '') as 'approved' | 'rejected',
    decision_note: formData.get('decision_note')?.toString() || undefined,
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  const { data: req } = await supabase
    .from('phase_advance_requests')
    .select('id, reel_id, from_phase, to_phase, status')
    .eq('id', parsed.data.request_id)
    .maybeSingle();
  if (!req) return { ok: false, error: 'request_not_found' };
  if (req.status !== 'pending') return { ok: false, error: 'invalid_input' };

  const ctx = await loadReelAndRaci(req.reel_id);
  if (!ctx) return { ok: false, error: 'reel_not_found' };
  const { reel, raci } = ctx;

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  const isAdmin = !!profile?.is_admin;
  const isApprover = !!raci && getRaciUsers(raci, 'approver').includes(user.id);
  if (!isAdmin && !isApprover) return { ok: false, error: 'not_authorized' };

  const decidedAt = new Date().toISOString();
  const { error: updErr } = await supabase
    .from('phase_advance_requests')
    .update({
      status: parsed.data.decision,
      decided_by: user.id,
      decided_at: decidedAt,
      decision_note: parsed.data.decision_note ?? null,
    })
    .eq('id', req.id);
  if (updErr) return { ok: false, error: 'unknown', message: updErr.message };

  if (parsed.data.decision === 'approved') {
    const { error: phaseErr } = await supabase
      .from('reels')
      .update({
        phase: req.to_phase,
        phase_entered_at: decidedAt,
        phase_status: 'green',
      })
      .eq('id', reel.id);
    if (phaseErr) return { ok: false, error: 'unknown', message: phaseErr.message };
  }
  // On reject we leave the reel's phase untouched; the requester sees the
  // decision_note and can iterate. (Per PRD §5.4 a "back one phase" option may
  // be added later — kept out of this iteration.)

  revalidatePath(`/reels/${reel.id}`);
  revalidatePath('/pipeline');
  return { ok: true };
}

export async function cancelPhaseAdvance(
  formData: FormData,
): Promise<PhaseAdvanceResult> {
  const id = formData.get('request_id')?.toString() ?? '';
  if (!id) return { ok: false, error: 'invalid_input' };

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  const { data: req } = await supabase
    .from('phase_advance_requests')
    .select('id, reel_id, requested_by, status')
    .eq('id', id)
    .maybeSingle();
  if (!req) return { ok: false, error: 'request_not_found' };
  if (req.status !== 'pending') return { ok: false, error: 'invalid_input' };
  if (req.requested_by !== user.id) return { ok: false, error: 'not_authorized' };

  const { error } = await supabase
    .from('phase_advance_requests')
    .update({ status: 'cancelled', decided_at: new Date().toISOString() })
    .eq('id', req.id);
  if (error) return { ok: false, error: 'unknown', message: error.message };

  revalidatePath(`/reels/${req.reel_id}`);
  return { ok: true };
}
