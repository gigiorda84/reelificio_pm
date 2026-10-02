// Mirror of the task enums and return codes in
// supabase/migrations/20261002141707_fase1_core.sql and
// 20261002145906_fase1_task_engine.sql. Labels live in it.json under `tasks.*`.

export const TASK_KINDS = [
  'writing',
  'review',
  'validation',
  'dubbing',
  'audio_approval',
  'animation',
  'final_approval',
  'scheduling',
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = [
  'unassigned',
  'assigned',
  'in_progress',
  'delivered',
  'approved',
  'sent_back',
  'declined',
  'expired',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const OPEN_STATUSES: readonly TaskStatus[] = ['unassigned', 'assigned', 'in_progress'];

// Work tasks the assignee accepts or declines before starting.
export const ACCEPT_KINDS: readonly TaskKind[] = ['dubbing', 'animation'];
// Work tasks closed by a delivery.
export const DELIVER_KINDS: readonly TaskKind[] = ['writing', 'dubbing', 'animation'];
// Tasks closed by a decision (approve / send back).
export const DECISION_KINDS: readonly TaskKind[] = ['review', 'validation', 'audio_approval', 'final_approval'];
// Decisions that carry the script revision the approver saw.
export const SCRIPT_DECISION_KINDS: readonly TaskKind[] = ['review', 'validation'];

export const TASK_OPS = ['accept', 'decline', 'deliver', 'approve', 'send_back'] as const;
export type TaskOp = (typeof TASK_OPS)[number];

export const TASK_CODES = [
  'not_authorized',
  'invalid_input',
  'task_not_found',
  'invalid_state',
  'invalid_assignee',
  'stale',
  'file_missing',
  'dod_incomplete',
  'script_missing',
  'proposal_stale',
] as const;
export type TaskErrorCode = (typeof TASK_CODES)[number];

export function toTaskError(code: unknown): TaskErrorCode | 'unknown' {
  return (TASK_CODES as readonly unknown[]).includes(code) ? (code as TaskErrorCode) : 'unknown';
}
