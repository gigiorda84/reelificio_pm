import { getSupabaseServerClient } from '@/lib/supabase/server';
import { OPEN_STATUSES, type TaskKind, type TaskStatus } from './constants';

export type OpenTask = {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  attempt: number;
  origin: 'app' | 'migration';
  escalation_paused: boolean;
  started_at: string | null;
  yellow_at: string | null;
  due_at: string | null;
  escalate_at: string | null;
  // Note left on the task this one replaces (a send-back reason).
  previous_note: string | null;
};

export type TaskPeople = {
  approverId: string | null;
  delegateId: string | null;
};

// The reel's open task, if any (there is at most one). Names come from
// profile_names(), which externals may call too.
export async function getOpenTask(reelId: string): Promise<OpenTask | null> {
  const supabase = await getSupabaseServerClient();
  const { data: task, error } = await supabase
    .from('tasks')
    .select(
      'id, kind, status, assignee_id, attempt, origin, escalation_paused, started_at, yellow_at, due_at, escalate_at, previous_task_id',
    )
    .eq('reel_id', reelId)
    .in('status', OPEN_STATUSES as TaskStatus[])
    .maybeSingle();
  if (error) throw error;
  if (!task) return null;

  const [names, previous] = await Promise.all([
    task.assignee_id
      ? supabase.rpc('profile_names', { p_ids: [task.assignee_id] })
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    // Through a function: an external cannot read the previous task, which
    // is usually the approver's.
    task.previous_task_id
      ? supabase.rpc('task_previous_note', { p_task_id: task.id })
      : Promise.resolve({ data: null }),
  ]);

  return {
    ...task,
    assignee_name: (names.data ?? [])[0]?.full_name ?? null,
    previous_note: (previous.data as string | null) ?? null,
  } as OpenTask;
}

// Approver and delegate of the page's group (or the default group).
// Internal-only data: an external gets nulls, which is fine (they never
// decide approvals).
export async function getTaskPeople(pageId: string): Promise<TaskPeople> {
  const supabase = await getSupabaseServerClient();
  const { data: page } = await supabase
    .from('pages')
    .select('approval_group_id')
    .eq('id', pageId)
    .maybeSingle();
  const query = supabase.from('approval_groups').select('approver_id, delegate_id');
  const { data: group } = page?.approval_group_id
    ? await query.eq('id', page.approval_group_id).maybeSingle()
    : await query.eq('is_default', true).maybeSingle();
  return { approverId: group?.approver_id ?? null, delegateId: group?.delegate_id ?? null };
}

export type AssignableProfile = {
  id: string;
  full_name: string | null;
  email: string;
  account_type: 'internal' | 'external';
  external_kind: 'dubber' | 'animator' | 'validator' | null;
};

// Everyone an admin may assign a task to (active profiles); the SQL checks
// the kind fit again on assignment.
export async function listAssignableProfiles(): Promise<AssignableProfile[]> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email, account_type, external_kind')
    .is('deactivated_at', null)
    .order('full_name');
  return (data ?? []) as AssignableProfile[];
}

export type TaskListItem = {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  started_at: string | null;
  yellow_at: string | null;
  due_at: string | null;
  escalate_at: string | null;
  reel: {
    id: string;
    code: string;
    title: string;
    track: 'batch' | 'express';
    page_name: string | null;
  };
};

type TaskRow = Omit<TaskListItem, 'reel'> & {
  reels: { id: string; code: string; title: string; track: 'batch' | 'express'; pages: { name: string } | null } | null;
};

const TASK_LIST_SELECT =
  'id, kind, status, started_at, yellow_at, due_at, escalate_at, reels(id, code, title, track, pages(name))';

// Express first, then the nearest deadline (no deadline last).
export function sortTasks<T extends { due_at: string | null; reel: { track: string } }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const ex = Number(b.reel.track === 'express') - Number(a.reel.track === 'express');
    if (ex !== 0) return ex;
    const da = a.due_at ? Date.parse(a.due_at) : Infinity;
    const db = b.due_at ? Date.parse(b.due_at) : Infinity;
    return da - db;
  });
}

function toListItem(row: TaskRow): TaskListItem | null {
  if (!row.reels) return null;
  const { reels, ...task } = row;
  return {
    ...task,
    reel: { id: reels.id, code: reels.code, title: reels.title, track: reels.track, page_name: reels.pages?.name ?? null },
  };
}

// The signed-in user's open tasks (externals included: RLS shows them theirs).
export async function listMyOpenTasks(userId: string): Promise<TaskListItem[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_LIST_SELECT)
    .eq('assignee_id', userId)
    .in('status', OPEN_STATUSES as TaskStatus[])
    .limit(500);
  if (error) throw error;
  return sortTasks(((data ?? []) as unknown as TaskRow[]).map(toListItem).filter((t): t is TaskListItem => !!t));
}

// Tasks nobody could take (admins assign them).
export async function listUnassignedTasks(): Promise<TaskListItem[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_LIST_SELECT)
    .eq('status', 'unassigned')
    .limit(500);
  if (error) throw error;
  return sortTasks(((data ?? []) as unknown as TaskRow[]).map(toListItem).filter((t): t is TaskListItem => !!t));
}

export type ApprovalItem = TaskListItem & {
  reel: TaskListItem['reel'] & {
    script_rev: number;
    hook: string | null;
    corpo: string | null;
    chiusura: string | null;
    cta: string | null;
    raw_content: string | null;
    audio_drive_url: string | null;
    video_drive_url: string | null;
  };
  previous_note: string | null;
  pending_proposals: number;
};

export async function countMyApprovals(): Promise<number> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.rpc('approval_queue');
  return (data ?? []).length;
}

// The approval queue with what is needed to decide from a phone: the script
// and its revision, the delivered audio/video link, the last send-back note,
// how many text proposals wait.
export async function listMyApprovals(): Promise<ApprovalItem[]> {
  const supabase = await getSupabaseServerClient();
  const { data: queue, error } = await supabase.rpc('approval_queue');
  if (error) throw error;
  // The first 100 (Express, then the nearest deadline) keep the id lists
  // below the URL length limit; the nav badge shows the full count.
  const ids = ((queue ?? []) as { task_id: string }[]).slice(0, 100).map((q) => q.task_id);
  if (ids.length === 0) return [];

  const { data: rows, error: rowsError } = await supabase
    .from('tasks')
    .select(
      'id, kind, status, started_at, yellow_at, due_at, escalate_at, previous_task_id, reels(id, code, title, track, script_rev, hook, corpo, chiusura, cta, raw_content, audio_drive_url, video_drive_url, pages(name))',
    )
    .in('id', ids);
  if (rowsError) throw rowsError;

  type Row = TaskRow & { previous_task_id: string | null; reels: ApprovalItem['reel'] & { pages: { name: string } | null } };
  const typed = (rows ?? []) as unknown as Row[];
  const previousIds = typed.map((r) => r.previous_task_id).filter((x): x is string => !!x);
  const reelIds = typed.map((r) => r.reels.id);
  const [{ data: previous }, { data: proposals }] = await Promise.all([
    previousIds.length
      ? supabase.from('tasks').select('id, decision_note').in('id', previousIds)
      : Promise.resolve({ data: [] as { id: string; decision_note: string | null }[] }),
    supabase.from('text_change_proposals').select('reel_id').in('reel_id', reelIds).eq('status', 'pending'),
  ]);
  const notes = new Map((previous ?? []).map((p) => [p.id, p.decision_note]));
  const pending = new Map<string, number>();
  for (const p of proposals ?? []) pending.set(p.reel_id, (pending.get(p.reel_id) ?? 0) + 1);

  return sortTasks(
    typed.map((r) => {
      const { reels, previous_task_id, ...task } = r;
      const { pages, ...reel } = reels;
      return {
        ...task,
        reel: { ...reel, page_name: pages?.name ?? null },
        previous_note: previous_task_id ? (notes.get(previous_task_id) ?? null) : null,
        pending_proposals: pending.get(reels.id) ?? 0,
      } as ApprovalItem;
    }),
  );
}

export type ProposalField = 'hook' | 'corpo' | 'chiusura' | 'cta';

export type TextProposal = {
  id: string;
  field: ProposalField;
  original_text: string | null;
  proposed_text: string;
  base_rev: number;
  status: 'pending' | 'accepted' | 'rejected';
  proposer_name: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
};

// Text proposals on a reel, newest first. RLS shows everything to internals
// and their own proposals to an external; names come from profile_names().
export async function listProposals(reelId: string): Promise<TextProposal[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('text_change_proposals')
    .select('id, field, original_text, proposed_text, base_rev, status, proposed_by, decision_note, created_at, decided_at')
    .eq('reel_id', reelId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.proposed_by).filter((x): x is string => !!x))];
  const { data: names } = ids.length
    ? await supabase.rpc('profile_names', { p_ids: ids })
    : { data: [] as { id: string; full_name: string | null }[] };
  const byId = new Map(((names ?? []) as { id: string; full_name: string | null }[]).map((n) => [n.id, n.full_name]));
  return rows.map(({ proposed_by, ...r }) => ({
    ...r,
    proposer_name: proposed_by ? byId.get(proposed_by) ?? null : null,
  })) as TextProposal[];
}
