// API-level checks: the app's query shapes (embedded resources, filters on
// embedded rows, exact counts, RPCs) run through a real PostgREST and
// supabase-js against the throwaway database prepared by run.sh.
// Env: DB_CHECK_REST (PostgREST base URL), DB_CHECK_JWT_SECRET.
import http from 'node:http';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const REST = process.env.DB_CHECK_REST;
const SECRET = process.env.DB_CHECK_JWT_SECRET;

const ADMIN = '00000000-0000-0000-0000-00000000000a';
const MEMBER = '00000000-0000-0000-0000-00000000000b';
const OUTSIDER = '00000000-0000-0000-0000-00000000000c';
const APPROVER = '00000000-0000-0000-0000-00000000000d';
const REEL1 = '30000000-0000-0000-0000-000000000001';
const BATCH = '20000000-0000-0000-0000-000000000001';

function jwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

// supabase-js calls `${url}/rest/v1/...`; strip the prefix and forward.
const proxy = http.createServer((req, res) => {
  const target = new URL(req.url.replace(/^\/rest\/v1/, ''), REST);
  const upstream = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  req.pipe(upstream);
});
await new Promise((r) => proxy.listen(0, r));
const base = `http://127.0.0.1:${proxy.address().port}`;

const as = (claims) =>
  createClient(base, jwt(claims), { auth: { persistSession: false, autoRefreshToken: false } });
const user = (sub) => as({ role: 'authenticated', sub });
const service = as({ role: 'service_role' });

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, detail ?? '');
  }
}

const OPEN = ['unassigned', 'assigned', 'in_progress'];

// Kanban column query (src/lib/pipeline/queries.ts): macro-phase columns,
// the open task embedded for the semaforo (closed ones filtered out of the
// embed, not out of the column), Express first.
{
  const now = Date.now();
  const iso = (ms) => new Date(now + ms).toISOString();
  const closed = await service.from('tasks').insert({
    reel_id: REEL1, kind: 'writing', status: 'delivered', assignee_id: MEMBER,
    started_at: iso(-7200_000), closed_at: iso(-3600_000),
  }).select('id').single();
  const open = await service.from('tasks').insert({
    reel_id: REEL1, kind: 'writing', status: 'in_progress', assignee_id: MEMBER,
    started_at: iso(-3600_000), yellow_at: iso(3600_000), due_at: iso(7200_000), escalate_at: iso(10800_000),
  }).select('id').single();
  check('fixture tasks for the kanban', !closed.error && !open.error, closed.error ?? open.error);
  const column = (phase) =>
    user(MEMBER)
      .from('reels')
      .select(
        'id, code, phase, state, track, pages(name, code_prefix), batches(label), tasks(kind, status, started_at, yellow_at, due_at, escalate_at)',
        { count: 'exact' },
      )
      .eq('phase', phase)
      .is('published_at', null)
      .in('tasks.status', OPEN)
      .order('track', { ascending: false })
      .order('phase_entered_at', { ascending: true })
      .limit(100);
  const { data, count, error } = await column('script_writing');
  check('kanban column loads', !error && data?.length === 1 && count === 1, error ?? data);
  check('kanban embeds page and batch', data?.[0]?.pages?.code_prefix === 'PP' && data?.[0]?.batches?.label === 'Batch Ottobre', data?.[0]);
  check('kanban embeds only the open task', data?.[0]?.tasks?.length === 1 && data[0].tasks[0].status === 'in_progress', data?.[0]);
  const editing = await column('editing');
  check('reel without open task has an empty embed', editing.data?.length === 1 && editing.data[0].tasks?.length === 0, editing.error ?? editing.data);

  // /compiti: my open tasks with the reel and its page.
  const mine = await user(MEMBER)
    .from('tasks')
    .select('id, kind, status, due_at, reels(id, code, title, track, pages(name))')
    .eq('assignee_id', MEMBER)
    .in('status', OPEN);
  check('my open tasks with reel and page', mine.data?.length === 1 && mine.data[0].reels?.pages?.name === 'Porcino & Papaya', mine.error ?? mine.data);

  await service.from('tasks').update({ status: 'cancelled', closed_at: new Date().toISOString() }).eq('id', open.data.id);
}

// Aggregates (dashboard, batch list, alert rules).
{
  const { data, error } = await user(MEMBER).rpc('active_reel_counts');
  check('active_reel_counts', !error && data?.length === 2, error ?? data);
  const counts = await user(MEMBER).rpc('batch_reel_counts', { p_batch_ids: [BATCH] });
  check('batch_reel_counts', Number(counts.data?.[0]?.reel_count) === 2, counts.error ?? counts.data);
  const stuckUser = await user(MEMBER).rpc('stuck_reels', { p_cutoff: new Date().toISOString() });
  check('stuck_reels denied to users', !!stuckUser.error, stuckUser.data);
  const stuck = await service.rpc('stuck_reels', { p_cutoff: new Date(Date.now() + 60_000).toISOString() });
  check('stuck_reels for the cron', !stuck.error && stuck.data?.length === 2, stuck.error ?? stuck.data);
  const batches = await user(MEMBER)
    .from('batches')
    .select('id, label, pages(name, code_prefix)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(200);
  check('batch list with page embed', batches.count === 1 && batches.data?.[0]?.pages?.name === 'Porcino & Papaya', batches.error ?? batches.data);
}

// Writes go through the new rules.
{
  const outsider = await user(OUTSIDER).from('reels').update({ title: 'x' }).eq('id', REEL1).select('id');
  check('outsider update returns no row', !outsider.error && outsider.data?.length === 0, outsider.error ?? outsider.data);
  const member = await user(MEMBER).from('reels').update({ title: 'Nuovo' }).eq('id', REEL1).select('id');
  check('member update returns the row', member.data?.length === 1, member.error ?? member.data);
  const escalate = await user(MEMBER).from('profiles').update({ is_admin: true }).eq('id', MEMBER);
  check('is_admin not writable', escalate.error?.code === '42501', escalate.error);
  const claim = await user(MEMBER).rpc('claim_admin_if_first');
  check('claim_admin_if_first refused', claim.data === false, claim.error ?? claim.data);
}

// Task engine (Fase 1): decisions through task_action; the old path is off.
{
  const old = await user(APPROVER).rpc('decide_phase_advance', {
    p_request_id: '00000000-0000-0000-0000-000000000000', p_decision: 'approved', p_note: null,
  });
  check('decide_phase_advance off after the contract', old.error?.code === '42501', old.error ?? old.data);

  await service.from('reels').update({ state: 'revisione', hook: 'Lo sapevi che…' }).eq('id', REEL1);
  const { data: task } = await service.from('tasks').insert({
    reel_id: REEL1, kind: 'review', status: 'in_progress', assignee_id: APPROVER,
    started_at: new Date().toISOString(),
  }).select('id').single();
  const { data: before } = await service.from('reels').select('script_rev').eq('id', REEL1).single();
  const rev = before.script_rev;

  const notMine = await user(MEMBER).rpc('task_action', { p_task_id: task.id, p_op: 'approve', p_payload: { rev } });
  check('Responsible cannot decide a review', notMine.data === 'not_authorized', notMine.error ?? notMine.data);
  const stale = await user(APPROVER).rpc('task_action', { p_task_id: task.id, p_op: 'approve', p_payload: { rev: rev - 1 } });
  check('approval of an old revision is stale', stale.data === 'stale', stale.error ?? stale.data);
  const ok = await user(APPROVER).rpc('task_action', { p_task_id: task.id, p_op: 'approve', p_note: 'ok', p_payload: { rev } });
  check('Approver decides via task_action', ok.data === 'ok', ok.error ?? ok.data);
  const twice = await user(APPROVER).rpc('task_action', { p_task_id: task.id, p_op: 'approve', p_payload: { rev } });
  check('second decision is invalid_state', twice.data === 'invalid_state', twice.error ?? twice.data);
  const { data: reel } = await user(ADMIN).from('reels').select('state, phase').eq('id', REEL1).single();
  check('reel confirmed', reel?.state === 'confermato' && reel?.phase === 'dubbing', reel);

  const asActor = await user(APPROVER).rpc('task_action_as', { p_actor: APPROVER, p_task_id: task.id, p_op: 'approve' });
  check('task_action_as denied to users', asActor.error?.code === '42501', asActor.error ?? asActor.data);
  const core = await user(APPROVER).rpc('task_action_core', {
    p_actor: APPROVER, p_task_id: task.id, p_op: 'approve', p_note: null, p_payload: null, p_channel: 'app',
  });
  check('task_action_core not exposed', core.error?.code === 'PGRST202', core.error ?? core.data);
  const reconcile = await user(ADMIN).rpc('fase1_reconcile_tasks');
  check('reconcile denied to users', reconcile.error?.code === '42501', reconcile.error ?? reconcile.data);
}

// Configuration (S3): the approval queue for the nav badge, SLA and
// approvers through functions, the reel's approver for the service role.
{
  const queue = await user(APPROVER).rpc('approval_queue');
  check('approval_queue callable', !queue.error && Array.isArray(queue.data), queue.error ?? queue.data);
  const sla = await user(MEMBER).rpc('set_sla_policy', { p_page_id: null, p_track: 'batch', p_step: 'dubbing', p_minutes: 60 });
  check('member cannot change an SLA', sla.data === 'not_authorized', sla.error ?? sla.data);
  const slaRows = await user(MEMBER).from('sla_policies').select('id').is('page_id', null);
  check('internals read the SLA table', slaRows.data?.length === 20, slaRows.error ?? slaRows.data?.length);
  const direct = await user(ADMIN).from('sla_policies').update({ minutes: 1 }).eq('track', 'batch').select('id');
  check('SLA table not writable directly', direct.error?.code === '42501', direct.error ?? direct.data);
  const approverUser = await user(ADMIN).rpc('reel_approver', { p_reel_id: REEL1 });
  check('reel_approver denied to users', approverUser.error?.code === '42501', approverUser.error ?? approverUser.data);
  const approverService = await service.rpc('reel_approver', { p_reel_id: REEL1 });
  check('reel_approver for the service role', !approverService.error, approverService.error);
}

// External collaborator (Fase 1): sees only the reel with their task (reel 2,
// in animation; reel 1 already has its open task).
{
  const REEL2 = '30000000-0000-0000-0000-000000000002';
  const EXTERNAL = '00000000-0000-0000-0000-00000000000e';
  const ext = user(EXTERNAL);
  const none = await ext.from('reels').select('id');
  check('external without tasks sees no reel', !none.error && none.data?.length === 0, none.error ?? none.data);

  const task = await service.from('tasks').insert({
    reel_id: REEL2, kind: 'animation', status: 'in_progress', assignee_id: EXTERNAL,
    started_at: new Date().toISOString(), accepted_at: new Date().toISOString(),
  });
  check('service role inserts a task', !task.error, task.error);

  const reels = await ext.from('reels').select('id, code, pages(name)');
  check('external sees the reel with their task', reels.data?.length === 1 && reels.data[0].id === REEL2, reels.error ?? reels.data);
  check('external sees its page', reels.data?.[0]?.pages?.name === 'Porcino & Papaya', reels.data?.[0]);
  const batches = await ext.from('batches').select('id');
  check('external sees no batch', !batches.error && batches.data?.length === 0, batches.error ?? batches.data);
  const profiles = await ext.from('profiles').select('id, email');
  check('external sees only their own profile', profiles.data?.length === 1 && profiles.data[0].id === EXTERNAL, profiles.error ?? profiles.data);
  const names = await ext.rpc('profile_names', { p_ids: [ADMIN, MEMBER, EXTERNAL] });
  check('profile_names: own name, no email', !names.error && names.data?.length === 1 && !('email' in names.data[0]), names.error ?? names.data);
  const update = await ext.from('reels').update({ title: 'x' }).eq('id', REEL2).select('id');
  check('external update returns no row', !update.error && update.data?.length === 0, update.error ?? update.data);
  const asActor = await ext.rpc('set_collaborator_as', {
    p_actor: ADMIN, p_user: EXTERNAL, p_account_type: 'internal', p_external_kind: null,
  });
  check('set_collaborator_as denied to users', asActor.error?.code === '42501', asActor.error ?? asActor.data);
  const priv = await ext.rpc('is_admin_uid', { p_uid: ADMIN });
  check('schema private not exposed', priv.error?.code === 'PGRST202', priv.error ?? priv.data);
  const backfill = await ext.rpc('fase1_backfill_open_tasks');
  check('backfill denied to users', backfill.error?.code === '42501', backfill.error ?? backfill.data);
  const comment = await ext.from('comments').insert({
    target_type: 'reel', target_id: REEL2, author_id: EXTERNAL, body: 'Consegnato',
  }).select('id');
  check('external comments on their reel', !comment.error && comment.data?.length === 1, comment.error);
  const secret = await ext.from('comments').insert({
    target_type: 'reel', target_id: REEL2, author_id: EXTERNAL, body: 'x', internal_only: true,
  });
  check('external cannot write internal-only', secret.error?.code === '42501', secret.error);

  // The views of S3: /compiti with the reel embedded, the thread without
  // internal notes, names only of people on the reel, proposals.
  const tasks = await ext.from('tasks').select('id, kind, reels(id, code, track, pages(name))').in('status', OPEN);
  check('external /compiti with the reel', tasks.data?.length === 1 && tasks.data[0].reels?.id === REEL2, tasks.error ?? tasks.data);
  await user(MEMBER).from('comments').insert({
    target_type: 'reel', target_id: REEL2, author_id: MEMBER, body: 'Solo per noi', internal_only: true,
  });
  const thread = await ext.from('comments').select('id, body, internal_only').eq('target_id', REEL2);
  check('external thread hides internal notes', thread.data?.length === 1 && thread.data[0].body === 'Consegnato', thread.error ?? thread.data);
  const hidden = await ext.rpc('profile_names', { p_ids: [MEMBER] });
  check('an internal note does not reveal its author', hidden.data?.length === 0, hidden.error ?? hidden.data);
  await user(MEMBER).from('comments').insert({ target_type: 'reel', target_id: REEL2, author_id: MEMBER, body: 'Ok' });
  const named = await ext.rpc('profile_names', { p_ids: [MEMBER] });
  check('a visible comment makes its author mentionable', named.data?.length === 1 && !('email' in named.data[0]), named.error ?? named.data);
  const moved = await ext.from('comments').update({ body: 'x', internal_only: true }).eq('id', comment.data[0].id).select('id');
  check('external cannot turn a comment internal', !!moved.error || moved.data?.length === 0, moved.error ?? moved.data);

  await service.from('reels').update({ state: 'animazione', hook: 'Hook' }).eq('id', REEL2);
  const proposal = await ext.rpc('propose_text_change', { p_reel_id: REEL2, p_field: 'hook', p_text: 'Hook nuovo' });
  check('external proposes a change', proposal.data === 'ok', proposal.error ?? proposal.data);
  const own = await ext.from('text_change_proposals').select('id, status, original_text, proposed_text').eq('reel_id', REEL2);
  check('external reads their proposal', own.data?.length === 1 && own.data[0].original_text === 'Hook', own.error ?? own.data);
  const decide = await ext.rpc('decide_text_proposal', { p_proposal_id: own.data?.[0]?.id, p_decision: 'accepted' });
  check('external cannot decide a proposal', decide.data === 'not_authorized', decide.error ?? decide.data);
  const queue = await ext.rpc('approval_queue');
  check('external approval queue is empty', !queue.error && queue.data?.length === 0, queue.error ?? queue.data);

  // The send-back note of the approver's task reaches the external through
  // task_previous_note (they cannot read that task); nobody else's note does.
  const { data: back } = await service.from('tasks').insert({
    reel_id: REEL2, kind: 'final_approval', status: 'sent_back', assignee_id: APPROVER,
    decision_note: 'Sottotitoli fuori sincrono', closed_at: new Date().toISOString(),
  }).select('id').single();
  const { data: mineTask } = await service.from('tasks').select('id')
    .eq('reel_id', REEL2).eq('assignee_id', EXTERNAL).in('status', OPEN).single();
  await service.from('tasks').update({ previous_task_id: back.id }).eq('id', mineTask.id);
  const direct = await ext.from('tasks').select('decision_note').eq('id', back.id);
  check('external cannot read the approver task', !direct.error && direct.data?.length === 0, direct.error ?? direct.data);
  const note = await ext.rpc('task_previous_note', { p_task_id: mineTask.id });
  check('external reads the send-back note of their task', note.data === 'Sottotitoli fuori sincrono', note.error ?? note.data);
  const other = await user(OUTSIDER).rpc('task_previous_note', { p_task_id: mineTask.id });
  check('task_previous_note: internals read it too', other.data === 'Sottotitoli fuori sincrono', other.error ?? other.data);
  const notMine = await ext.rpc('task_previous_note', { p_task_id: back.id });
  check('task_previous_note gives nothing on others\' tasks', notMine.data === null, notMine.error ?? notMine.data);
}

proxy.close();
if (failures) {
  console.log(`${failures} API check(s) failed`);
  process.exit(1);
}
