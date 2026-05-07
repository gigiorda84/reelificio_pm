import { getSupabaseServerClient } from '@/lib/supabase/server';
import {
  ACTIVE_CHANNELS,
  NOTIFICATION_EVENTS,
  type NotificationChannel,
  type NotificationEvent,
} from './types';

export type PrefRow = {
  event: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
};

export type PrefMatrix = Record<NotificationEvent, Record<NotificationChannel, boolean>>;

// In-app is always on; UI doesn't expose a toggle. Other defaults match
// dispatch.ts CHANNEL_DEFAULTS — keep the two in sync.
const DEFAULT_MATRIX: PrefMatrix = {
  mention: { in_app: true, email: true, telegram: false, whatsapp: false },
  assignment: { in_app: true, email: true, telegram: false, whatsapp: false },
  phase_approval_request: { in_app: true, email: true, telegram: false, whatsapp: false },
  phase_approved: { in_app: true, email: false, telegram: false, whatsapp: false },
  phase_rejected: { in_app: true, email: true, telegram: false, whatsapp: false },
  buffer_alert: { in_app: true, email: true, telegram: false, whatsapp: false },
  kpi_alert: { in_app: true, email: true, telegram: false, whatsapp: false },
  daily_reminder: { in_app: true, email: true, telegram: false, whatsapp: false },
  weekly_digest: { in_app: false, email: true, telegram: false, whatsapp: false },
};

export async function getOwnPrefMatrix(): Promise<PrefMatrix> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return cloneMatrix(DEFAULT_MATRIX);

  const { data } = await supabase
    .from('notification_prefs')
    .select('event, channel, enabled')
    .eq('user_id', user.id);

  const out = cloneMatrix(DEFAULT_MATRIX);
  for (const row of (data as PrefRow[] | null) ?? []) {
    if (!NOTIFICATION_EVENTS.includes(row.event)) continue;
    out[row.event][row.channel] = row.enabled;
  }
  return out;
}

function cloneMatrix(src: PrefMatrix): PrefMatrix {
  const out = {} as PrefMatrix;
  for (const e of NOTIFICATION_EVENTS) {
    out[e] = { in_app: true, email: true, telegram: false, whatsapp: false };
    for (const c of ACTIVE_CHANNELS) out[e][c] = src[e][c];
  }
  return out;
}
