// Mirror of the `notification_event` and `notification_channel` Postgres enums.
// Keep in sync with supabase/migrations/20260505203358_initial_schema.sql.

export const NOTIFICATION_EVENTS = [
  'mention',
  'assignment',
  'phase_approval_request',
  'phase_approved',
  'phase_rejected',
  'buffer_alert',
  'phase_stuck_alert',
  'kpi_alert',
  'daily_reminder',
  'weekly_digest',
  // Fase 1 (20261002141706_fase1_enum_values.sql)
  'task_overdue',
  'task_escalated',
  'text_proposal',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

// Task events: Telegram first, email only when Telegram cannot carry the
// message (docs/fase1-plan.md §3; resolveTaskChannels in channels.ts).
export const TASK_EVENTS = [
  'assignment',
  'phase_approval_request',
  'phase_rejected',
  'task_overdue',
  'task_escalated',
  'text_proposal',
] as const satisfies readonly NotificationEvent[];
export type TaskEvent = (typeof TASK_EVENTS)[number];

export function isTaskEvent(event: NotificationEvent): event is TaskEvent {
  return (TASK_EVENTS as readonly string[]).includes(event);
}

// What /settings lets people switch: the events still sent (phase_approved
// and phase_stuck_alert ended with Fase 1).
export const MATRIX_EVENTS = NOTIFICATION_EVENTS.filter(
  (e) => e !== 'phase_approved' && e !== 'phase_stuck_alert',
);

export const NOTIFICATION_CHANNELS = [
  'email',
  'telegram',
  'whatsapp',
  'in_app',
] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

// WhatsApp is deferred to v1.1 — exclude from any UI matrix in MVP.
export const ACTIVE_CHANNELS: NotificationChannel[] = ['email', 'telegram', 'in_app'];
