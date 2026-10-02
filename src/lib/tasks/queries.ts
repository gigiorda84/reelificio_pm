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
    task.previous_task_id
      ? supabase.from('tasks').select('decision_note').eq('id', task.previous_task_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    ...task,
    assignee_name: (names.data ?? [])[0]?.full_name ?? null,
    previous_note: (previous.data as { decision_note: string | null } | null)?.decision_note ?? null,
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
