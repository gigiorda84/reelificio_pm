import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { DEFAULT_MATRIX } from '@/lib/notifications/defaults';
import { sendEmail } from '@/lib/notifications/email';
import { afterTelegramFailure, resolveTaskChannels } from '@/lib/notifications/channels';
import { isQuietHour } from '@/lib/notifications/quiet-hours';
import { sendTelegramMessage } from '@/lib/notifications/telegram';
import {
  proposalMessage,
  taskMessage,
  writingStartedMessage,
  type BuiltMessage,
  type MessageReel,
  type RecipientRole,
  type TaskMessageEvent,
} from '@/lib/notifications/task-messages';
import type { TaskEvent } from '@/lib/notifications/types';
import { DECISION_KINDS, OPEN_STATUSES, type TaskKind, type TaskStatus } from '@/lib/tasks/constants';

// Handler of the `notify` outbox jobs written by the task engine and the
// sweep (docs/fase1-plan.md §S4). It re-reads the task before sending: a
// task closed or reassigned since then gets no message. Each recipient is
// delivered once per job generation (the notifications rows remember it), so
// a retry after a partial failure does not repeat what already went out.

export type ClaimedJob = {
  id: number;
  kind: 'notify' | 'drive_reconcile';
  payload: Record<string, unknown>;
  gen: number;
  lease_token: string;
  attempts: number;
};

// Retry later (outbox backoff).
export class TransientJobError extends Error {}
// Retrying cannot help: straight to the dead letter.
export class PermanentJobError extends Error {}

const LAST_ATTEMPT = 6;

type Outcome = 'sent' | 'stale';

type Recipient = {
  id: string;
  email: string | null;
  telegram_chat_id: string | null;
  deactivated_at: string | null;
};

type Delivery = {
  job: ClaimedJob;
  event: TaskEvent;
  track: 'batch' | 'express';
  meta: Record<string, unknown>;
};

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';
}

async function recipients(admin: SupabaseClient, ids: string[]): Promise<Recipient[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const { data, error } = await admin
    .from('profiles')
    .select('id, email, telegram_chat_id, deactivated_at')
    .in('id', unique);
  if (error) throw new TransientJobError(`profiles: ${error.message}`);
  return ((data ?? []) as Recipient[]).filter((p) => !p.deactivated_at);
}

async function adminIds(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin.from('profiles').select('id').eq('is_admin', true).is('deactivated_at', null);
  if (error) throw new TransientJobError(`admins: ${error.message}`);
  return (data ?? []).map((p) => p.id as string);
}

async function prefs(admin: SupabaseClient, userId: string, event: TaskEvent) {
  const { data } = await admin
    .from('notification_prefs')
    .select('channel, enabled')
    .eq('user_id', userId)
    .eq('event', event);
  const row = (channel: 'telegram' | 'email' | 'in_app') =>
    (data ?? []).find((r) => r.channel === channel)?.enabled ?? DEFAULT_MATRIX[event][channel];
  return { telegramOn: row('telegram'), emailOn: row('email'), inAppOn: row('in_app') };
}

// Delivers one message to one person: in-app row, then Telegram, with email
// only when Telegram cannot carry it (channels.ts). 'undeliverable': nothing
// reached them (Telegram refused for good and email is off or missing).
async function deliver(admin: SupabaseClient, d: Delivery, to: Recipient, msg: BuiltMessage): Promise<'ok' | 'undeliverable'> {
  const jobKey = `${d.job.id}:${d.job.gen}`;
  const { data: done } = await admin
    .from('notifications')
    .select('channel, delivered_at')
    .eq('recipient_id', to.id)
    .eq('payload->>job_key', jobKey);
  const already = (channel: string, delivered = true) =>
    (done ?? []).some((n) => n.channel === channel && (!delivered || n.delivered_at));
  if (already('telegram') || already('email')) return 'ok';

  const p = await prefs(admin, to.id, d.event);
  const persist = (channel: 'in_app' | 'telegram' | 'email', delivered: boolean, error?: string) =>
    admin.from('notifications').insert({
      recipient_id: to.id,
      event: d.event,
      channel,
      payload: { subject: msg.subject, text: msg.text, link: msg.link, job_key: jobKey, ...d.meta, ...(error ? { error } : {}) },
      delivered_at: delivered ? new Date().toISOString() : null,
    });

  if (p.inAppOn && !already('in_app', false)) await persist('in_app', true);

  const plan = resolveTaskChannels({ telegramLinked: !!to.telegram_chat_id, telegramOn: p.telegramOn, emailOn: p.emailOn });
  let email = plan.email;
  if (plan.telegram) {
    const sent = await sendTelegramMessage(to.telegram_chat_id!, msg.telegram, {
      buttons: msg.buttons.length ? msg.buttons : undefined,
      silent: isQuietHour(new Date(), d.track),
    });
    if (sent.ok) {
      await persist('telegram', true);
      return 'ok';
    }
    await persist('telegram', false, sent.error);
    const next = afterTelegramFailure({ failure: sent.kind, lastAttempt: d.job.attempts >= LAST_ATTEMPT, emailOn: p.emailOn });
    if (next === 'retry') throw new TransientJobError(sent.error);
    email = next === 'email';
  }
  if (!email || !to.email) return plan.telegram ? 'undeliverable' : 'ok';
  const sent = await sendEmail({ to: to.email, subject: msg.subject, text: msg.text, html: msg.html });
  if (!sent.ok) {
    await persist('email', false, sent.error);
    throw new TransientJobError(`email: ${sent.error}`);
  }
  await persist('email', true);
  return 'ok';
}

// Every recipient is tried, so one failure does not hold back the others.
// Then: a transient error retries the job (who already got it is skipped);
// someone unreachable ends the job in the dead letter, visible in job_health.
async function deliverAll(admin: SupabaseClient, d: Delivery, items: { to: Recipient; msg: BuiltMessage }[]) {
  const transient: string[] = [];
  const unreachable: string[] = [];
  for (const { to, msg } of items) {
    try {
      if ((await deliver(admin, d, to, msg)) === 'undeliverable') unreachable.push(to.id);
    } catch (err) {
      if (!(err instanceof TransientJobError)) throw err;
      transient.push(`${to.id}: ${err.message}`);
    }
  }
  if (transient.length) throw new TransientJobError(transient.join(' · '));
  if (unreachable.length) throw new PermanentJobError(`not delivered to ${unreachable.join(', ')}`);
}

type TaskRow = {
  id: string;
  reel_id: string;
  kind: TaskKind;
  status: TaskStatus;
  assignee_id: string | null;
  due_at: string | null;
  previous_task_id: string | null;
};

type ReelRow = {
  id: string;
  code: string;
  title: string;
  track: 'batch' | 'express';
  script_rev: number;
  hook: string | null;
  corpo: string | null;
  chiusura: string | null;
  cta: string | null;
  raw_content: string | null;
  audio_drive_url: string | null;
  video_drive_url: string | null;
};

const REEL_COLUMNS =
  'id, code, title, track, script_rev, hook, corpo, chiusura, cta, raw_content, audio_drive_url, video_drive_url';

async function loadReel(admin: SupabaseClient, reelId: string): Promise<ReelRow> {
  const { data, error } = await admin.from('reels').select(REEL_COLUMNS).eq('id', reelId).maybeSingle();
  if (error) throw new TransientJobError(`reel: ${error.message}`);
  if (!data) throw new PermanentJobError(`reel ${reelId} not found`);
  return data as ReelRow;
}

function messageReel(r: ReelRow): MessageReel {
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    express: r.track === 'express',
    scriptRev: r.script_rev,
    hook: r.hook,
    corpo: r.corpo,
    chiusura: r.chiusura,
    cta: r.cta,
    rawContent: r.raw_content,
    audioUrl: r.audio_drive_url,
    videoUrl: r.video_drive_url,
  };
}

const TASK_MESSAGE_EVENTS: readonly string[] = [
  'assignment',
  'phase_approval_request',
  'phase_rejected',
  'task_overdue',
  'task_escalated',
];

// Events about a task (assignment, approval request, send-back, overdue,
// escalation). Skipped when the task has closed or changed hands since.
async function notifyTask(admin: SupabaseClient, job: ClaimedJob, p: Record<string, unknown>): Promise<Outcome> {
  const event = p.event as TaskMessageEvent;
  const { data: task, error } = await admin
    .from('tasks')
    .select('id, reel_id, kind, status, assignee_id, due_at, previous_task_id')
    .eq('id', p.task_id as string)
    .maybeSingle();
  if (error) throw new TransientJobError(`task: ${error.message}`);
  const t = task as TaskRow | null;
  if (!t || !OPEN_STATUSES.includes(t.status)) return 'stale';
  if ((p.assignee_id ?? null) !== t.assignee_id) return 'stale';
  if (p.to === 'admins' && event === 'assignment' && t.status !== 'unassigned') return 'stale';

  const reel = await loadReel(admin, t.reel_id);
  const [{ data: previous }, { data: holder }] = await Promise.all([
    t.previous_task_id
      ? admin.from('tasks').select('decision_note').eq('id', t.previous_task_id).maybeSingle()
      : Promise.resolve({ data: null }),
    t.assignee_id
      ? admin.from('profiles').select('full_name, email').eq('id', t.assignee_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const assigneeName = holder ? (holder.full_name?.trim() || holder.email) : null;

  let ids: string[] = [];
  if (p.to === 'assignee') ids = t.assignee_id ? [t.assignee_id] : [];
  else if (p.to === 'admins') ids = await adminIds(admin);
  else if (p.to === 'users') {
    ids = (p.recipients as string[] | undefined) ?? [];
    if (p.admins) ids = [...ids, ...(await adminIds(admin))];
  } else throw new PermanentJobError(`unknown recipient group ${String(p.to)}`);

  const d: Delivery = {
    job,
    event,
    track: reel.track,
    meta: { event, task_id: t.id, reel_id: reel.id },
  };
  const items = (await recipients(admin, ids)).map((to) => {
    const role: RecipientRole =
      to.id !== t.assignee_id ? 'observer' : DECISION_KINDS.includes(t.kind) ? 'approver' : 'assignee';
    const msg = taskMessage({
      event,
      appUrl: appUrl(),
      task: { id: t.id, kind: t.kind, status: t.status, dueAt: t.due_at },
      reel: messageReel(reel),
      role,
      note: event === 'phase_rejected' ? (previous as { decision_note: string | null } | null)?.decision_note : null,
      assigneeName: role === 'observer' ? assigneeName : undefined,
    });
    return { to, msg };
  });
  await deliverAll(admin, d, items);
  return 'sent';
}

// "Avvia stesura": one message per author for the batch.
async function notifyWritingStarted(admin: SupabaseClient, job: ClaimedJob, p: Record<string, unknown>): Promise<Outcome> {
  const { data: batch } = await admin.from('batches').select('label').eq('id', p.batch_id as string).maybeSingle();
  const toAdmins = p.to === 'admins';
  const ids = toAdmins ? await adminIds(admin) : [p.assignee_id as string];
  const msg = writingStartedMessage({ appUrl: appUrl(), batchLabel: batch?.label ?? '—', toAdmins });
  const d: Delivery = { job, event: 'assignment', track: 'batch', meta: { event: 'assignment', batch_id: p.batch_id } };
  await deliverAll(admin, d, (await recipients(admin, ids)).map((to) => ({ to, msg })));
  return 'sent';
}

// A text proposal: to the approver while pending; its outcome to whoever
// proposed it (not when they decided it themselves).
async function notifyProposal(admin: SupabaseClient, job: ClaimedJob, p: Record<string, unknown>): Promise<Outcome> {
  const { data: proposal, error } = await admin
    .from('text_change_proposals')
    .select('id, reel_id, field, original_text, proposed_text, status, proposed_by, decided_by, decision_note')
    .eq('id', p.proposal_id as string)
    .maybeSingle();
  if (error) throw new TransientJobError(`proposal: ${error.message}`);
  if (!proposal) return 'stale';
  const reel = await loadReel(admin, proposal.reel_id);

  let ids: string[];
  if (p.to === 'approver') {
    if (proposal.status !== 'pending') return 'stale';
    const { data: approver } = await admin.rpc('reel_approver', { p_reel_id: reel.id });
    ids = approver ? [approver as string] : await adminIds(admin);
  } else {
    if (!proposal.proposed_by || proposal.proposed_by === proposal.decided_by) return 'stale';
    ids = [proposal.proposed_by];
  }
  const { data: proposer } = proposal.proposed_by
    ? await admin.from('profiles').select('full_name').eq('id', proposal.proposed_by).maybeSingle()
    : { data: null };
  const msg = proposalMessage({
    appUrl: appUrl(),
    reel,
    field: proposal.field,
    originalText: proposal.original_text,
    proposedText: proposal.proposed_text,
    proposerName: proposer?.full_name ?? null,
    to: p.to === 'approver' ? 'approver' : 'proposer',
    decision: p.decision as 'accepted' | 'rejected' | undefined,
    note: proposal.decision_note,
  });
  const d: Delivery = {
    job,
    event: 'text_proposal',
    track: reel.track,
    meta: { event: 'text_proposal', proposal_id: proposal.id, reel_id: reel.id },
  };
  await deliverAll(admin, d, (await recipients(admin, ids)).map((to) => ({ to, msg })));
  return 'sent';
}

export async function handleNotifyJob(job: ClaimedJob): Promise<Outcome> {
  const admin = getSupabaseAdminClient();
  const p = job.payload;
  if (p.event === 'text_proposal') return notifyProposal(admin, job, p);
  if (p.event === 'assignment' && p.batch_id) return notifyWritingStarted(admin, job, p);
  if (typeof p.event === 'string' && TASK_MESSAGE_EVENTS.includes(p.event) && p.task_id) {
    return notifyTask(admin, job, p);
  }
  throw new PermanentJobError(`unknown notify payload ${JSON.stringify(p).slice(0, 200)}`);
}
