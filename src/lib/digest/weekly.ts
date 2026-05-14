import 'server-only';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { dispatchNotification } from '@/lib/notifications/dispatch';
import { isoDaysAgoInRome, todayIsoInRome } from '@/lib/daily-updates/types';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://reellificio-pm.vercel.app';

export type DigestReport = {
  recipients: number;
  submitted: number;
  expectedSlots: number;
  completionPct: number;
  transitions: number;
  publishedReels: number;
  stuckReels: number;
  bufferLines: { name: string; count: number; threshold: number; low: boolean }[];
  weekStart: string;
  weekEnd: string;
};

// Builds and dispatches the weekly digest. Window = last 7 calendar days
// (Europe/Rome) ending yesterday — runs on Monday morning to summarize the
// previous week.
export async function sendWeeklyDigest(): Promise<DigestReport> {
  const supabase = getSupabaseAdminClient();

  const weekEnd = isoDaysAgoInRome(1); // yesterday
  const weekStart = isoDaysAgoInRome(7);
  const sinceIso = new Date(`${weekStart}T00:00:00+02:00`).toISOString();
  const untilIso = new Date(`${todayIsoInRome()}T00:00:00+02:00`).toISOString();

  const [profilesRes, dailyRes, transitionsRes, publishedRes, pagesRes, stuckRes] =
    await Promise.all([
      supabase.from('profiles').select('id, email, full_name'),
      supabase
        .from('daily_updates')
        .select('user_id, date')
        .gte('date', weekStart)
        .lte('date', weekEnd),
      supabase
        .from('phase_advance_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'approved')
        .gte('decided_at', sinceIso)
        .lt('decided_at', untilIso),
      supabase
        .from('reels')
        .select('id', { count: 'exact', head: true })
        .eq('phase', 'publication')
        .gte('updated_at', sinceIso)
        .lt('updated_at', untilIso),
      supabase
        .from('pages')
        .select('id, name, code_prefix, buffer_threshold, active')
        .eq('active', true),
      supabase
        .from('reels')
        .select('id, phase, phase_entered_at')
        .neq('phase', 'publication')
        .lt('phase_entered_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
    ]);

  const profiles = profilesRes.data ?? [];
  const dailyRows = dailyRes.data ?? [];
  const transitions = transitionsRes.count ?? 0;
  const publishedReels = publishedRes.count ?? 0;
  const pages = pagesRes.data ?? [];
  const stuckReels = (stuckRes.data ?? []).length;

  const recipients = profiles.length;
  const expectedSlots = recipients * 7; // a slot per user-day
  const submitted = dailyRows.length;
  const completionPct =
    expectedSlots === 0 ? 0 : Math.round((submitted / expectedSlots) * 100);

  // Buffer line per page: count of publication-phase reels right now.
  const bufferLines: DigestReport['bufferLines'] = [];
  for (const page of pages) {
    const { count } = await supabase
      .from('reels')
      .select('id', { count: 'exact', head: true })
      .eq('page_id', page.id)
      .eq('phase', 'publication');
    const c = count ?? 0;
    bufferLines.push({
      name: `${page.code_prefix} · ${page.name}`,
      count: c,
      threshold: page.buffer_threshold,
      low: c < page.buffer_threshold,
    });
  }

  const weekLabel = `${formatDateIt(weekStart)} – ${formatDateIt(weekEnd)}`;
  const subject = `Digest settimanale Reellificio — settimana ${weekLabel}`;

  const text = renderText({
    weekLabel,
    completionPct,
    submitted,
    expectedSlots,
    transitions,
    publishedReels,
    stuckReels,
    bufferLines,
  });
  const html = renderHtml({
    weekLabel,
    completionPct,
    submitted,
    expectedSlots,
    transitions,
    publishedReels,
    stuckReels,
    bufferLines,
  });

  for (const profile of profiles) {
    try {
      await dispatchNotification({
        recipientId: profile.id,
        event: 'weekly_digest',
        payload: { subject, text, html },
      });
    } catch (err) {
      console.error('[weekly-digest] dispatch failed', { user: profile.id, err });
    }
  }

  return {
    recipients,
    submitted,
    expectedSlots,
    completionPct,
    transitions,
    publishedReels,
    stuckReels,
    bufferLines,
    weekStart,
    weekEnd,
  };
}

type RenderInput = {
  weekLabel: string;
  completionPct: number;
  submitted: number;
  expectedSlots: number;
  transitions: number;
  publishedReels: number;
  stuckReels: number;
  bufferLines: DigestReport['bufferLines'];
};

function renderText(d: RenderInput): string {
  const lines: string[] = [];
  lines.push(`Digest settimanale Reellificio — ${d.weekLabel}`);
  lines.push('');
  lines.push('AGGIORNAMENTI GIORNALIERI');
  lines.push(`Tasso di completamento: ${d.completionPct}% (${d.submitted}/${d.expectedSlots})`);
  lines.push('');
  lines.push('PRODUZIONE');
  lines.push(`Avanzamenti di fase approvati: ${d.transitions}`);
  lines.push(`Reel in pubblicazione: ${d.publishedReels}`);
  lines.push('');
  lines.push('BUFFER PUBBLICAZIONE');
  if (d.bufferLines.length === 0) lines.push('Nessuna pagina attiva.');
  else
    for (const b of d.bufferLines) {
      lines.push(
        `${b.low ? '⚠ ' : '  '}${b.name}: ${b.count} pronte / soglia ${b.threshold}`,
      );
    }
  lines.push('');
  lines.push('REEL FERME');
  lines.push(
    d.stuckReels === 0
      ? 'Nessuna reel ferma da oltre 24h.'
      : `Reel ferme da oltre 24h: ${d.stuckReels}`,
  );
  lines.push('');
  lines.push(`Apri Reellificio PM: ${APP_URL}/dashboard`);
  return lines.join('\n');
}

function renderHtml(d: RenderInput): string {
  const bufferList =
    d.bufferLines.length === 0
      ? '<li>Nessuna pagina attiva.</li>'
      : d.bufferLines
          .map(
            (b) =>
              `<li${b.low ? ' style="color:#b91c1c"' : ''}>${escapeHtml(b.name)}: <strong>${b.count}</strong> pronte / soglia ${b.threshold}${b.low ? ' ⚠' : ''}</li>`,
          )
          .join('');
  return `
    <h2>Digest settimanale Reellificio</h2>
    <p>Settimana ${escapeHtml(d.weekLabel)}</p>

    <h3>Aggiornamenti giornalieri</h3>
    <p>Tasso di completamento: <strong>${d.completionPct}%</strong> (${d.submitted}/${d.expectedSlots})</p>

    <h3>Produzione</h3>
    <ul>
      <li>Avanzamenti di fase approvati: <strong>${d.transitions}</strong></li>
      <li>Reel in pubblicazione: <strong>${d.publishedReels}</strong></li>
      <li>Reel ferme da oltre 24h: <strong>${d.stuckReels}</strong></li>
    </ul>

    <h3>Buffer pubblicazione</h3>
    <ul>${bufferList}</ul>

    <p><a href="${APP_URL}/dashboard">Apri Reellificio PM</a></p>
  `;
}

function formatDateIt(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'short',
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
