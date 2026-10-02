import { getSupabaseServerClient } from '@/lib/supabase/server';
import { DEFAULT_MATRIX, type PrefMatrix, type PrefRow } from './defaults';
import { ACTIVE_CHANNELS, NOTIFICATION_EVENTS } from './types';

export type { PrefMatrix, PrefRow } from './defaults';

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
