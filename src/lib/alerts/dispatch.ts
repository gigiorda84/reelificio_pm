import 'server-only';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { dispatchToMany } from '@/lib/notifications/dispatch';
import type { NotificationEvent } from '@/lib/notifications/types';
import type { AlertProposal } from './rules';

const PHASE_LABELS: Record<string, string> = {
  research_prescript: 'Ricerca pre-script',
  scientific_validation: 'Validazione scientifica',
  script_writing: 'Stesura script',
  dubbing: 'Doppiaggio',
  editing: 'Montaggio',
  publication: 'Pubblicazione',
};

async function getAdminRecipients(): Promise<string[]> {
  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('is_admin', true)
    .is('deactivated_at', null);
  return (data ?? []).map((r) => r.id);
}

async function getPageResponsibleAndApprover(
  pageId: string,
  phase: string,
): Promise<string[]> {
  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from('raci_configs')
    .select('responsible, approver')
    .eq('page_id', pageId)
    .eq('phase', phase)
    .maybeSingle();
  if (!data) return [];
  return [...(data.responsible ?? []), ...(data.approver ?? [])];
}

function buildBufferMessage(p: AlertProposal) {
  const name = String(p.payload.page_name ?? '');
  const count = Number(p.payload.buffer_count ?? 0);
  const threshold = Number(p.payload.buffer_threshold ?? 0);
  const subject = `Buffer basso — ${name}`;
  const text = `La pagina ${name} ha ${count} reel pronti alla pubblicazione (soglia ${threshold}). Serve azione per ricostituire il buffer.`;
  const html = `<p>La pagina <strong>${escapeHtml(name)}</strong> ha <strong>${count}</strong> reel pronti alla pubblicazione (soglia ${threshold}).</p><p>Apri Avvisi per registrare la soluzione proposta.</p>`;
  return { subject, text, html };
}

const HEALTH_LABELS: Record<string, string> = {
  sweep_stale: 'lo sweep dei compiti non gira',
  sweep_errors: 'lo sweep non riesce a gestire alcuni reel',
  job_backlog: 'messaggi fermi in coda',
  dead_letters: 'messaggi non consegnati',
  violations: 'reel in uno stato incoerente con i compiti',
};

function buildJobHealthMessage(p: AlertProposal) {
  const issues = ((p.payload.issues as string[] | undefined) ?? []).map((i) => HEALTH_LABELS[i] ?? i);
  const subject = `Salute del sistema — ${issues.join(', ')}`;
  const detail = `Sweep: ${p.payload.sweep_age_minutes ?? '—'} min fa, reel in errore ${p.payload.sweep_errors ?? 0} · coda: ${p.payload.oldest_job_minutes ?? 0} min · non consegnati (24 h): ${p.payload.dead_letters_24h ?? 0} · incoerenze: ${p.payload.violations ?? 0}`;
  const text = `${subject}.\n${detail}\nApri Avvisi per registrare la soluzione.`;
  const html = `<p><strong>${escapeHtml(subject)}</strong></p><p>${escapeHtml(detail)}</p><p>Apri Avvisi per registrare la soluzione.</p>`;
  return { subject, text, html };
}

function buildPhaseStuckMessage(p: AlertProposal) {
  const code = String(p.payload.reel_code ?? '');
  const title = String(p.payload.reel_title ?? '');
  const hours = Number(p.payload.hours_in_phase ?? 24);
  const phaseLabel = PHASE_LABELS[String(p.phase ?? '')] ?? String(p.phase ?? '');
  const subject = `Fase ferma — ${code}`;
  const text = `Il reel ${code} "${title}" è fermo in fase ${phaseLabel} da ${hours}h senza commenti.`;
  const html = `<p>Il reel <strong>${escapeHtml(code)}</strong> &mdash; ${escapeHtml(title)} è fermo in fase <strong>${escapeHtml(phaseLabel)}</strong> da ${hours}h senza commenti.</p>`;
  return { subject, text, html };
}

export async function dispatchAlertOpened(p: AlertProposal, alertId: string) {
  let recipients: string[] = [];
  let event: NotificationEvent;
  let message: { subject: string; text: string; html: string };

  if (p.kind === 'buffer_low') {
    event = 'buffer_alert';
    recipients = await getAdminRecipients();
    message = buildBufferMessage(p);
  } else if (p.kind === 'job_health') {
    // Same switch as the buffer: operational alerts for the admins.
    event = 'buffer_alert';
    recipients = await getAdminRecipients();
    message = buildJobHealthMessage(p);
  } else {
    event = 'phase_stuck_alert';
    const fromRaci = p.page_id && p.phase
      ? await getPageResponsibleAndApprover(p.page_id, p.phase)
      : [];
    const admins = await getAdminRecipients();
    recipients = Array.from(new Set([...fromRaci, ...admins]));
    message = buildPhaseStuckMessage(p);
  }

  await dispatchToMany(recipients, event, {
    subject: message.subject,
    text: message.text,
    html: message.html,
    meta: { alert_id: alertId, dedup_key: p.dedup_key, kind: p.kind },
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
