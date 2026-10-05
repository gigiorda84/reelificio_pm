import {
  ACTIVE_CHANNELS,
  NOTIFICATION_EVENTS,
  type NotificationChannel,
  type NotificationEvent,
} from './types';

export type PrefMatrix = Record<NotificationEvent, Record<NotificationChannel, boolean>>;

// Per-event default, used when a user has no `notification_prefs` row for an
// (event, channel) pair. In-app is always on; email is on for high-signal
// events. Task events have Telegram on (it is their primary channel, email
// the fallback: channels.ts); the others keep Telegram off until the user
// opts in. The dispatcher and the settings page both read this table.
export const DEFAULT_MATRIX: PrefMatrix = {
  mention: { in_app: true, email: true, telegram: false, whatsapp: false },
  assignment: { in_app: true, email: true, telegram: true, whatsapp: false },
  phase_approval_request: { in_app: true, email: true, telegram: true, whatsapp: false },
  phase_approved: { in_app: true, email: false, telegram: false, whatsapp: false },
  phase_rejected: { in_app: true, email: true, telegram: true, whatsapp: false },
  buffer_alert: { in_app: true, email: true, telegram: true, whatsapp: false },
  phase_stuck_alert: { in_app: true, email: true, telegram: false, whatsapp: false },
  kpi_alert: { in_app: true, email: true, telegram: false, whatsapp: false },
  daily_reminder: { in_app: true, email: true, telegram: false, whatsapp: false },
  weekly_digest: { in_app: false, email: true, telegram: false, whatsapp: false },
  task_overdue: { in_app: true, email: true, telegram: true, whatsapp: false },
  task_escalated: { in_app: true, email: true, telegram: true, whatsapp: false },
  text_proposal: { in_app: true, email: true, telegram: true, whatsapp: false },
};

export type PrefRow = {
  event: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
};

// The rows worth storing: only choices that differ from the default, so a
// later change of a default reaches everyone who never touched that switch.
export function prefRowsToStore(matrix: PrefMatrix): PrefRow[] {
  const rows: PrefRow[] = [];
  for (const event of NOTIFICATION_EVENTS) {
    for (const channel of ACTIVE_CHANNELS) {
      const enabled = !!matrix[event]?.[channel];
      if (enabled !== DEFAULT_MATRIX[event][channel]) rows.push({ event, channel, enabled });
    }
  }
  return rows;
}
