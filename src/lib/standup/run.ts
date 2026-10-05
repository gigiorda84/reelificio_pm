import 'server-only';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { romeParts } from '@/lib/dates';
import { sendEmail } from '@/lib/notifications/email';
import { sendTelegramMessage } from '@/lib/notifications/telegram';
import { formatStandup, isStandupTime, worthSendingOnWeekend, type StandupSnapshot } from './format';

// The 08:30 stand-up in the team chat (docs/fase1-plan.md §3, §S4). Skipped
// outside 08:30 ± 10 min Rome, when switched off (app_config), on a quiet
// weekend, or when today's has gone out already (atomic standup_claim).
// `force` (manual run on staging) skips the time, the switch and the claim.
// No team chat configured: the admins get it by email.

export type StandupResult =
  | { sent: true; channel: 'telegram' | 'email'; late: number; dueToday: number; unassigned: number }
  | { sent: false; reason: 'not_time' | 'disabled' | 'weekend_quiet' | 'already_sent' };

const DAY_LABEL = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
});

export async function runStandup({ now = new Date(), force = false } = {}): Promise<StandupResult> {
  if (!force && !isStandupTime(now)) return { sent: false, reason: 'not_time' };
  const admin = getSupabaseAdminClient();

  if (!force) {
    const { data: config } = await admin.from('app_config').select('value').eq('key', 'standup_enabled').maybeSingle();
    if (config?.value !== true) return { sent: false, reason: 'disabled' };
  }

  const rome = romeParts(now);
  const { data, error } = await admin.rpc('standup_snapshot', { p_now: now.toISOString() });
  if (error) throw new Error(`standup_snapshot: ${error.message}`);
  const snapshot = data as StandupSnapshot;
  if (!force && rome.weekday >= 6 && !worthSendingOnWeekend(snapshot)) return { sent: false, reason: 'weekend_quiet' };

  if (!force) {
    const { data: claimed, error: claimError } = await admin.rpc('standup_claim', { p_date: rome.date });
    if (claimError) throw new Error(`standup_claim: ${claimError.message}`);
    if (!claimed) return { sent: false, reason: 'already_sent' };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
  const dayLabel = DAY_LABEL.format(now);
  const text = formatStandup({ snapshot, dayLabel, appUrl });
  const counts = { late: snapshot.late.length, dueToday: snapshot.due_today.length, unassigned: snapshot.unassigned.length };

  const chat = process.env.TELEGRAM_TEAM_CHAT_ID;
  if (chat) {
    const sent = await sendTelegramMessage(chat, text);
    if (!sent.ok) throw new Error(`stand-up not sent: ${sent.error}`);
    return { sent: true, channel: 'telegram', ...counts };
  }

  const { data: admins } = await admin.from('profiles').select('email').eq('is_admin', true).is('deactivated_at', null);
  const plain = text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  for (const a of admins ?? []) {
    if (!a.email) continue;
    await sendEmail({
      to: a.email,
      subject: `Stand-up Reelificio — ${dayLabel}`,
      text: plain,
      html: `<div style="font-family:sans-serif;white-space:pre-wrap">${text}</div>`,
    });
  }
  return { sent: true, channel: 'email', ...counts };
}
