import 'server-only';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { dispatchNotification } from '@/lib/notifications/dispatch';
import { todayIsoInRome } from './types';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://reellificio-pm.vercel.app';

export type ReminderReport = {
  candidates: number;
  reminded: number;
  alreadySubmitted: number;
};

// Send the daily-update reminder to every active profile that has not yet
// submitted an update for today (Europe/Rome calendar day). External
// magic-link collaborators don't have profiles, so they're naturally excluded.
export async function sendDailyReminders(): Promise<ReminderReport> {
  const supabase = getSupabaseAdminClient();
  const today = todayIsoInRome();

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, full_name');

  const candidates = profiles ?? [];

  const { data: submittedRows } = await supabase
    .from('daily_updates')
    .select('user_id')
    .eq('date', today);

  const submitted = new Set((submittedRows ?? []).map((r) => r.user_id as string));

  let reminded = 0;
  for (const profile of candidates) {
    if (submitted.has(profile.id)) continue;
    const name = profile.full_name ?? profile.email ?? '';
    const subject = 'Promemoria: aggiornamento giornaliero';
    const text = `Ciao ${name}, non hai ancora inviato il tuo aggiornamento per oggi. Apri Reellificio PM (${APP_URL}/aggiornamenti) e raccontaci cosa hai fatto, cosa ti blocca e cosa farai domani.`;
    const html = `<p>Ciao ${escapeHtml(name)},</p><p>Non hai ancora inviato il tuo aggiornamento per oggi.</p><p><a href="${APP_URL}/aggiornamenti">Apri Reellificio PM</a> e raccontaci cosa hai fatto, cosa ti blocca e cosa farai domani.</p>`;
    try {
      await dispatchNotification({
        recipientId: profile.id,
        event: 'daily_reminder',
        payload: { subject, text, html },
      });
      reminded += 1;
    } catch (err) {
      console.error('[daily-reminder] dispatch failed', { user: profile.id, err });
    }
  }

  return {
    candidates: candidates.length,
    reminded,
    alreadySubmitted: submitted.size,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
