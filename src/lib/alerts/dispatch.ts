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
    .eq('is_admin', true);
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
