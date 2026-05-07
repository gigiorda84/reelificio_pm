'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import {
  ACTIVE_CHANNELS,
  NOTIFICATION_EVENTS,
  type NotificationChannel,
  type NotificationEvent,
} from './types';
import type { PrefMatrix } from './prefs';

export type PrefsActionResult =
  | { ok: true }
  | { ok: false; error: 'not_authenticated' | 'unknown'; message?: string };

export async function saveOwnPrefMatrix(matrix: PrefMatrix): Promise<PrefsActionResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  const rows: {
    user_id: string;
    event: NotificationEvent;
    channel: NotificationChannel;
    enabled: boolean;
  }[] = [];
  for (const event of NOTIFICATION_EVENTS) {
    for (const channel of ACTIVE_CHANNELS) {
      rows.push({
        user_id: user.id,
        event,
        channel,
        enabled: !!matrix[event]?.[channel],
      });
    }
  }

  const { error } = await supabase
    .from('notification_prefs')
    .upsert(rows, { onConflict: 'user_id,event,channel' });
  if (error) return { ok: false, error: 'unknown', message: error.message };

  revalidatePath('/settings');
  return { ok: true };
}
