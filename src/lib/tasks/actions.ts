'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { toTaskError, type TaskErrorCode, type TaskOp } from './constants';

// Every task operation is one SQL function (docs/fase1-plan.md §S2): it
// checks the caller, moves the reel and returns a code. These actions only
// validate the input shape and map the code.

export type TaskActionResult =
  | { ok: true }
  | { ok: false; error: TaskErrorCode | 'unknown'; message?: string };

const uuid = z.string().uuid();

async function rpc(fn: string, args: Record<string, unknown>, paths: string[]): Promise<TaskActionResult> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    // The script lock and other guards raise 42501.
    if (error.code === '42501') return { ok: false, error: 'not_authorized' };
    return { ok: false, error: 'unknown', message: error.message };
  }
  if (data !== 'ok') return { ok: false, error: toTaskError(data) };
  for (const p of paths) revalidatePath(p);
  return { ok: true };
}

async function act(
  reelId: string,
  taskId: string,
  op: TaskOp,
  note: string | null,
  payload: Record<string, unknown> | null,
): Promise<TaskActionResult> {
  if (!uuid.safeParse(taskId).success || !uuid.safeParse(reelId).success) {
    return { ok: false, error: 'invalid_input' };
  }
  return rpc(
    'task_action',
    { p_task_id: taskId, p_op: op, p_note: note?.trim() || null, p_payload: payload },
    [`/reels/${reelId}`, '/pipeline'],
  );
}

export async function acceptTask(reelId: string, taskId: string): Promise<TaskActionResult> {
  return act(reelId, taskId, 'accept', null, null);
}

export async function declineTask(reelId: string, taskId: string, note: string | null): Promise<TaskActionResult> {
  return act(reelId, taskId, 'decline', note, null);
}

const deliverSchema = z.object({
  fileUrl: z.string().trim().regex(/^https:\/\/\S+$/).optional(),
  editingDone: z.boolean().optional(),
  subtitles: z.boolean().optional(),
  note: z.string().max(2000).nullable().optional(),
});

// Writing: no payload. Dubbing: the https link to the audio. Animation: the
// link plus the two DoD ticks of the delivery form.
export async function deliverTask(
  reelId: string,
  taskId: string,
  input: z.infer<typeof deliverSchema>,
): Promise<TaskActionResult> {
  const parsed = deliverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  const { fileUrl, editingDone, subtitles, note } = parsed.data;
  const payload: Record<string, unknown> = {};
  if (fileUrl) payload.file_url = fileUrl;
  if (editingDone !== undefined) payload.editing_done = editingDone;
  if (subtitles !== undefined) payload.subtitles = subtitles;
  return act(reelId, taskId, 'deliver', note ?? null, Object.keys(payload).length ? payload : null);
}

const decideSchema = z.object({
  decision: z.enum(['approve', 'send_back']),
  note: z.string().max(2000).nullable().optional(),
  // Script approvals: the revision shown to the approver (stale otherwise).
  expectedRev: z.number().int().nonnegative().optional(),
  // Final approval sent back: to the animator (default) or the dubber.
  to: z.enum(['animation', 'dubbing']).optional(),
});

export async function decideTask(
  reelId: string,
  taskId: string,
  input: z.infer<typeof decideSchema>,
): Promise<TaskActionResult> {
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  const { decision, note, expectedRev, to } = parsed.data;
  const payload: Record<string, unknown> = {};
  if (expectedRev !== undefined) payload.rev = expectedRev;
  if (to) payload.to = to;
  return act(reelId, taskId, decision, note ?? null, Object.keys(payload).length ? payload : null);
}

export async function startWriting(batchId: string, n: number): Promise<TaskActionResult> {
  if (!uuid.safeParse(batchId).success || !Number.isInteger(n) || n < 1 || n > 100) {
    return { ok: false, error: 'invalid_input' };
  }
  return rpc('start_writing', { p_batch_id: batchId, p_n: n }, [`/batches/${batchId}`, '/pipeline']);
}

export async function assignTask(reelId: string, taskId: string, userId: string): Promise<TaskActionResult> {
  if (![reelId, taskId, userId].every((v) => uuid.safeParse(v).success)) {
    return { ok: false, error: 'invalid_input' };
  }
  return rpc('assign_task', { p_task_id: taskId, p_user_id: userId }, [`/reels/${reelId}`, '/pipeline']);
}

export async function confirmMigratedTask(reelId: string, taskId: string): Promise<TaskActionResult> {
  if (!uuid.safeParse(taskId).success) return { ok: false, error: 'invalid_input' };
  return rpc('confirm_migrated_tasks', { p_task_ids: [taskId] }, [`/reels/${reelId}`]);
}

export async function setReelTrack(reelId: string, track: 'batch' | 'express'): Promise<TaskActionResult> {
  if (!uuid.safeParse(reelId).success || !['batch', 'express'].includes(track)) {
    return { ok: false, error: 'invalid_input' };
  }
  return rpc('set_reel_track', { p_reel_id: reelId, p_track: track }, [`/reels/${reelId}`, '/pipeline']);
}

export async function scheduleReel(
  reelId: string,
  caption: string | null,
  scheduledAtIso: string,
): Promise<TaskActionResult> {
  if (!uuid.safeParse(reelId).success || Number.isNaN(Date.parse(scheduledAtIso))) {
    return { ok: false, error: 'invalid_input' };
  }
  return rpc(
    'schedule_reel',
    { p_reel_id: reelId, p_caption: caption?.trim() || null, p_scheduled_at: scheduledAtIso },
    [`/reels/${reelId}`],
  );
}

export async function publishReel(reelId: string, postedUrl: string): Promise<TaskActionResult> {
  const url = postedUrl.trim();
  if (!uuid.safeParse(reelId).success || !/^https:\/\/\S+$/.test(url)) {
    return { ok: false, error: 'invalid_input' };
  }
  return rpc('publish_reel', { p_reel_id: reelId, p_posted_url: url }, [`/reels/${reelId}`, '/pipeline', '/dashboard']);
}

export async function setAbsence(userId: string, untilIso: string | null): Promise<TaskActionResult> {
  if (!uuid.safeParse(userId).success || (untilIso !== null && Number.isNaN(Date.parse(untilIso)))) {
    return { ok: false, error: 'invalid_input' };
  }
  return rpc('set_absence', { p_user_id: userId, p_until: untilIso }, ['/settings']);
}

export async function proposeTextChange(
  reelId: string,
  field: 'hook' | 'corpo' | 'chiusura' | 'cta',
  text: string,
): Promise<TaskActionResult> {
  if (!uuid.safeParse(reelId).success || text.length > 8000) return { ok: false, error: 'invalid_input' };
  return rpc('propose_text_change', { p_reel_id: reelId, p_field: field, p_text: text }, [`/reels/${reelId}`]);
}

export async function decideTextProposal(
  reelId: string,
  proposalId: string,
  decision: 'accepted' | 'rejected',
  note: string | null,
): Promise<TaskActionResult> {
  if (!uuid.safeParse(proposalId).success) return { ok: false, error: 'invalid_input' };
  return rpc(
    'decide_text_proposal',
    { p_proposal_id: proposalId, p_decision: decision, p_note: note?.trim() || null },
    [`/reels/${reelId}`],
  );
}

// Offboarding (admin): the SQL deactivates and hands the tasks on; then the
// auth user is banned with the service role, only after the session's admin
// check passed in SQL.
export async function offboardCollaborator(userId: string): Promise<TaskActionResult> {
  if (!uuid.safeParse(userId).success) return { ok: false, error: 'invalid_input' };
  const result = await rpc('offboard_collaborator', { p_user: userId }, ['/pages', '/pipeline']);
  if (!result.ok) return result;
  const { error } = await getSupabaseAdminClient().auth.admin.updateUserById(userId, {
    ban_duration: '876000h',
  });
  if (error) return { ok: false, error: 'unknown', message: `ban: ${error.message}` };
  return { ok: true };
}
