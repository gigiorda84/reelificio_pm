// Mirror of the `notification_event` and `notification_channel` Postgres enums.
// Keep in sync with supabase/migrations/20260505203358_initial_schema.sql.

export const NOTIFICATION_EVENTS = [
  'mention',
  'assignment',
  'phase_approval_request',
  'phase_approved',
  'phase_rejected',
  'buffer_alert',
  'kpi_alert',
  'daily_reminder',
  'weekly_digest',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_CHANNELS = [
  'email',
  'telegram',
  'whatsapp',
  'in_app',
] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

// WhatsApp is deferred to v1.1 — exclude from any UI matrix in MVP.
export const ACTIVE_CHANNELS: NotificationChannel[] = ['email', 'telegram', 'in_app'];
