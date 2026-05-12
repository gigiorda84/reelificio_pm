import 'server-only';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from './email';
import { sendTelegramMessage } from './telegram';
import {
  ACTIVE_CHANNELS,
  type NotificationChannel,
  type NotificationEvent,
} from './types';

// Per-event default — used when a user has no row in `notification_prefs` for a
// given (event, channel) pair. In-app is always on; email is on for high-signal
// events; telegram off-by-default until the user opts in.
const CHANNEL_DEFAULTS: Record<NotificationEvent, Record<NotificationChannel, boolean>> = {
  mention: { in_app: true, email: true, telegram: false, whatsapp: false },
  assignment: { in_app: true, email: true, telegram: false, whatsapp: false },
  phase_approval_request: { in_app: true, email: true, telegram: false, whatsapp: false },
  phase_approved: { in_app: true, email: false, telegram: false, whatsapp: false },
  phase_rejected: { in_app: true, email: true, telegram: false, whatsapp: false },
  buffer_alert: { in_app: true, email: true, telegram: true, whatsapp: false },
  phase_stuck_alert: { in_app: true, email: true, telegram: false, whatsapp: false },
  kpi_alert: { in_app: true, email: true, telegram: false, whatsapp: false },
  daily_reminder: { in_app: true, email: true, telegram: false, whatsapp: false },
  weekly_digest: { in_app: false, email: true, telegram: false, whatsapp: false },
};

export type DispatchPayload = {
  subject: string;
  html: string;
  text: string;
  // Optional structured fields persisted alongside the notification row.
  meta?: Record<string, unknown>;
};

export type DispatchInput = {
  recipientId: string;
  event: NotificationEvent;
  payload: DispatchPayload;
};

export type DispatchResult = {
  recipientId: string;
  delivered: NotificationChannel[];
  skipped: NotificationChannel[];
  failed: { channel: NotificationChannel; error: string }[];
};

async function channelEnabled(
  recipientId: string,
  event: NotificationEvent,
  channel: NotificationChannel,
): Promise<boolean> {
  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from('notification_prefs')
    .select('enabled')
    .eq('user_id', recipientId)
    .eq('event', event)
    .eq('channel', channel)
    .maybeSingle();
  if (data) return data.enabled;
  return CHANNEL_DEFAULTS[event][channel];
}

export async function dispatchNotification(input: DispatchInput): Promise<DispatchResult> {
  const supabase = getSupabaseAdminClient();
  const result: DispatchResult = {
    recipientId: input.recipientId,
    delivered: [],
    skipped: [],
    failed: [],
  };

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, telegram_chat_id')
    .eq('id', input.recipientId)
    .maybeSingle();

  if (!profile) {
    result.failed.push({ channel: 'in_app', error: 'profile_not_found' });
    return result;
  }

  for (const channel of ACTIVE_CHANNELS) {
    const enabled = await channelEnabled(input.recipientId, input.event, channel);
    if (!enabled) {
      result.skipped.push(channel);
      continue;
    }

    const persist = async (deliveredAt: string | null) => {
      await supabase.from('notifications').insert({
        recipient_id: input.recipientId,
        event: input.event,
        channel,
        payload: {
          subject: input.payload.subject,
          text: input.payload.text,
          ...(input.payload.meta ?? {}),
        },
        delivered_at: deliveredAt,
      });
    };

    if (channel === 'in_app') {
      await persist(new Date().toISOString());
      result.delivered.push(channel);
      continue;
    }

    if (channel === 'email') {
      if (!profile.email) {
        result.skipped.push(channel);
        continue;
      }
      const send = await sendEmail({
        to: profile.email,
        subject: input.payload.subject,
        html: input.payload.html,
        text: input.payload.text,
      });
      if (send.ok) {
        await persist(new Date().toISOString());
        result.delivered.push(channel);
      } else {
        await persist(null);
        result.failed.push({ channel, error: send.error });
      }
      continue;
    }

    if (channel === 'telegram') {
      if (!profile.telegram_chat_id) {
        result.skipped.push(channel);
        continue;
      }
      const send = await sendTelegramMessage(
        profile.telegram_chat_id,
        `<b>${escapeHtml(input.payload.subject)}</b>\n\n${escapeHtml(input.payload.text)}`,
      );
      if (send.ok) {
        await persist(new Date().toISOString());
        result.delivered.push(channel);
      } else {
        await persist(null);
        result.failed.push({ channel, error: send.error });
      }
      continue;
    }
  }

  return result;
}

export async function dispatchToMany(
  recipientIds: string[],
  event: NotificationEvent,
  payload: DispatchPayload,
): Promise<DispatchResult[]> {
  const unique = Array.from(new Set(recipientIds.filter((x) => !!x)));
  return Promise.all(
    unique.map((id) => dispatchNotification({ recipientId: id, event, payload })),
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
