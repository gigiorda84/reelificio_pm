import { createTranslator } from 'next-intl';
import messages from '@/messages/it.json';
import { formatRome } from '@/lib/dates';
import { formatCallback } from '@/lib/telegram/callback';
import type { TaskKind, TaskStatus } from '@/lib/tasks/constants';
import type { InlineButton, InlineKeyboard } from './telegram';

// What a task notification says, per event and per recipient role: the
// subject and text of the email, the Telegram HTML with its inline buttons,
// the link to the task in the app. Pure: the drain loads the data.

const t = createTranslator({ locale: 'it', messages, namespace: 'notifications.task' });
const tKind = createTranslator({ locale: 'it', messages, namespace: 'tasks.kind' });
const tField = createTranslator({ locale: 'it', messages, namespace: 'reels.script' });

export type TaskMessageEvent =
  | 'assignment'
  | 'phase_approval_request'
  | 'phase_rejected'
  | 'task_overdue'
  | 'task_escalated';

// Who receives it decides the buttons: the assignee accepts or declines,
// whoever approves decides, the others (admins, escalations) open the app.
export type RecipientRole = 'assignee' | 'approver' | 'observer';

export type MessageTask = { id: string; kind: TaskKind; status: TaskStatus; dueAt: string | null };

export type MessageReel = {
  id: string;
  code: string;
  title: string;
  express: boolean;
  scriptRev: number;
  hook: string | null;
  corpo: string | null;
  chiusura: string | null;
  cta: string | null;
  rawContent: string | null;
  audioUrl: string | null;
  videoUrl: string | null;
};

export type BuiltMessage = {
  subject: string;
  text: string;
  html: string;
  telegram: string;
  buttons: InlineKeyboard;
  link: string;
};

// Telegram allows 4096 characters; the script is cut well before, and a cut
// script cannot be approved from Telegram (approve what you have seen).
const SCRIPT_BUDGET = 3200;
const SCRIPT_KINDS: readonly TaskKind[] = ['review', 'validation'];
const DECISION_KINDS: readonly TaskKind[] = ['review', 'validation', 'audio_approval', 'final_approval'];
const ACCEPT_KINDS: readonly TaskKind[] = ['dubbing', 'animation'];

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function taskLink(appUrl: string, reelId: string, taskId: string): string {
  return `${appUrl}/reels/${reelId}?task=${taskId}`;
}

// Telegram refuses URL buttons that are not public https (localhost in
// development): the link is in the text anyway.
function openButton(url: string): InlineButton[] {
  return url.startsWith('https://') ? [{ text: t('open'), url }] : [];
}

function scriptBlocks(reel: MessageReel): [string, string][] {
  const blocks = (['hook', 'corpo', 'chiusura', 'cta'] as const)
    .filter((f) => reel[f]?.trim())
    .map((f) => [f.toUpperCase(), reel[f]!.trim()] as [string, string]);
  if (blocks.length === 0 && reel.rawContent?.trim()) return [['TESTO', reel.rawContent.trim()]];
  return blocks;
}

// The inline buttons for a task, also used by the webhook to put them back
// after "Annulla".
export function taskButtons(args: {
  task: MessageTask;
  reel: MessageReel;
  role: RecipientRole;
  link: string;
  scriptShownInFull: boolean;
}): InlineKeyboard {
  const { task, reel, role, link } = args;
  const rows: InlineKeyboard = [];
  if (role === 'assignee' && ACCEPT_KINDS.includes(task.kind) && task.status === 'assigned') {
    rows.push([
      { text: t('buttons.acc'), callback_data: formatCallback({ op: 'acc', taskId: task.id, rev: null }) },
      { text: t('buttons.dec'), callback_data: formatCallback({ op: 'dec', taskId: task.id, rev: null }) },
    ]);
  }
  if (role === 'approver' && DECISION_KINDS.includes(task.kind)) {
    const isScript = SCRIPT_KINDS.includes(task.kind);
    if (!isScript || args.scriptShownInFull) {
      rows.push([
        {
          text: t('buttons.apr'),
          callback_data: formatCallback({ op: 'apr', taskId: task.id, rev: isScript ? reel.scriptRev : null }),
        },
        // The revision rides along so "Annulla" can put back the same Approva.
        { text: t('buttons.rim'), callback_data: formatCallback({ op: 'rim', taskId: task.id, rev: isScript ? reel.scriptRev : null }) },
      ]);
    }
    const media = task.kind === 'audio_approval' ? reel.audioUrl : task.kind === 'final_approval' ? reel.videoUrl : null;
    if (media?.startsWith('https://')) {
      rows.push([{ text: task.kind === 'audio_approval' ? t('listen') : t('watch'), url: media }]);
    }
  }
  const open = openButton(link);
  if (open.length) rows.push(open);
  return rows;
}

// The confirmation step of "Rimanda" (two taps; the final approval goes back
// to the animator, the dubbing alternative is in the app only).
export function sendBackConfirmButtons(task: MessageTask, rev: number | null): InlineKeyboard {
  return [
    [
      {
        text: task.kind === 'final_approval' ? t('buttons.rimcAnimation') : t('buttons.rimc'),
        callback_data: formatCallback({ op: 'rimc', taskId: task.id, rev: null }),
      },
      { text: t('buttons.ann'), callback_data: formatCallback({ op: 'ann', taskId: task.id, rev }) },
    ],
  ];
}

export function taskMessage(args: {
  event: TaskMessageEvent;
  appUrl: string;
  task: MessageTask;
  reel: MessageReel;
  role: RecipientRole;
  // Why the work came back (phase_rejected), from the task it replaces.
  note?: string | null;
  // Escalations and messages to the admins say who holds the task.
  assigneeName?: string | null;
}): BuiltMessage {
  const { event, appUrl, task, reel, role, note } = args;
  const kind = tKind(task.kind);
  const link = taskLink(appUrl, reel.id, task.id);
  const headline =
    task.status === 'unassigned' && (event === 'assignment' || event === 'task_overdue' || event === 'task_escalated')
      ? t('headline.unassigned', { kind })
      : t(`headline.${event}`, { kind });

  const lines: { text: string; html: string }[] = [];
  const add = (text: string, html = escapeHtml(text)) => lines.push({ text, html });
  if (reel.express) add(t('express'));
  add(`${reel.code} — ${reel.title}`, `<code>${escapeHtml(reel.code)}</code> — ${escapeHtml(reel.title)}`);
  if (task.dueAt) {
    const due = formatRome(task.dueAt);
    add(task.status === 'assigned' && ACCEPT_KINDS.includes(task.kind) ? t('answerBy', { due }) : t('due', { due }));
  }
  if (args.assigneeName !== undefined && (event === 'task_escalated' || role === 'observer')) {
    add(t('assignedTo', { name: args.assigneeName ?? t('nobody') }));
  }
  if (note?.trim()) add(t('note', { note: note.trim() }), `${escapeHtml(t('noteLabel'))} <i>${escapeHtml(note.trim())}</i>`);

  // The script, for whoever approves it (a reminder too carries Approva:
  // approve what you have seen).
  let scriptShownInFull = true;
  const script: { text: string; html: string }[] = [];
  if (role === 'approver' && SCRIPT_KINDS.includes(task.kind)) {
    let budget = SCRIPT_BUDGET;
    for (const [label, body] of scriptBlocks(reel)) {
      const cut = body.length > budget ? body.slice(0, Math.max(budget, 0)) : body;
      if (cut.length < body.length) scriptShownInFull = false;
      budget -= cut.length;
      if (cut.length === 0) break;
      script.push({
        text: `${label}\n${cut}${cut.length < body.length ? '…' : ''}`,
        html: `<b>${label}</b>\n${escapeHtml(cut)}${cut.length < body.length ? '…' : ''}`,
      });
    }
    script.push({ text: t('rev', { rev: reel.scriptRev }), html: `<i>${escapeHtml(t('rev', { rev: reel.scriptRev }))}</i>` });
    if (!scriptShownInFull) script.push({ text: t('longScript'), html: escapeHtml(t('longScript')) });
  }

  const text = [headline, ...lines.map((l) => l.text), ...script.map((s) => s.text), t('openApp', { link })].join('\n\n');
  const telegram = [
    `<b>${escapeHtml(headline)}</b>`,
    lines.map((l) => l.html).join('\n'),
    ...script.map((s) => s.html),
    ...(link.startsWith('https://') ? [] : [escapeHtml(link)]),
  ].join('\n\n');
  const html = [
    `<p><strong>${escapeHtml(headline)}</strong></p>`,
    ...lines.map((l) => `<p>${l.html}</p>`),
    ...script.map((s) => `<p style="white-space:pre-wrap">${s.html.replace(/\n/g, '<br/>')}</p>`),
    `<p><a href="${escapeHtml(link)}">${escapeHtml(t('open'))}</a></p>`,
  ].join('\n');

  return {
    subject: `${headline} — ${reel.code}`,
    text,
    html,
    telegram,
    buttons: taskButtons({ task, reel, role, link, scriptShownInFull }),
    link,
  };
}

// "Avvia stesura": one message per author for the whole batch.
export function writingStartedMessage(args: { appUrl: string; batchLabel: string; toAdmins: boolean }): BuiltMessage {
  const link = `${args.appUrl}/compiti`;
  const headline = args.toAdmins
    ? t('writingStartedNoAuthor', { batch: args.batchLabel })
    : t('writingStarted', { batch: args.batchLabel });
  const body = t('writingStartedBody');
  return {
    subject: headline,
    text: [headline, body, t('openApp', { link })].join('\n\n'),
    html: `<p><strong>${escapeHtml(headline)}</strong></p><p>${escapeHtml(body)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(t('open'))}</a></p>`,
    telegram: [`<b>${escapeHtml(headline)}</b>`, escapeHtml(body), ...(link.startsWith('https://') ? [] : [escapeHtml(link)])].join('\n\n'),
    buttons: openButton(link).length ? [openButton(link)] : [],
    link,
  };
}

// A text proposal: to the approver (side by side), or its outcome to the
// person who proposed it.
export function proposalMessage(args: {
  appUrl: string;
  reel: { id: string; code: string; title: string };
  field: 'hook' | 'corpo' | 'chiusura' | 'cta';
  originalText: string | null;
  proposedText: string;
  proposerName: string | null;
  to: 'approver' | 'proposer';
  decision?: 'accepted' | 'rejected';
  note?: string | null;
}): BuiltMessage {
  const link = `${args.appUrl}/reels/${args.reel.id}`;
  const field = tField(args.field);
  const headline =
    args.to === 'approver'
      ? t('proposal.toApprover', { field, code: args.reel.code })
      : t(args.decision === 'accepted' ? 'proposal.accepted' : 'proposal.rejected', { field, code: args.reel.code });
  const cut = (s: string | null) => ((s ?? '').length > 1400 ? `${(s ?? '').slice(0, 1400)}…` : s ?? '—');
  const parts: { text: string; html: string }[] = [
    { text: `${args.reel.code} — ${args.reel.title}`, html: `<code>${escapeHtml(args.reel.code)}</code> — ${escapeHtml(args.reel.title)}` },
  ];
  if (args.to === 'approver') {
    parts.push({ text: t('proposal.from', { name: args.proposerName ?? '—' }), html: escapeHtml(t('proposal.from', { name: args.proposerName ?? '—' })) });
    parts.push({ text: `${t('proposal.original')}\n${cut(args.originalText)}`, html: `<b>${escapeHtml(t('proposal.original'))}</b>\n${escapeHtml(cut(args.originalText))}` });
    parts.push({ text: `${t('proposal.proposed')}\n${cut(args.proposedText)}`, html: `<b>${escapeHtml(t('proposal.proposed'))}</b>\n${escapeHtml(cut(args.proposedText))}` });
  } else if (args.note?.trim()) {
    parts.push({ text: t('note', { note: args.note.trim() }), html: `${escapeHtml(t('noteLabel'))} <i>${escapeHtml(args.note.trim())}</i>` });
  }
  return {
    subject: headline,
    text: [headline, ...parts.map((p) => p.text), t('openApp', { link })].join('\n\n'),
    html: [`<p><strong>${escapeHtml(headline)}</strong></p>`, ...parts.map((p) => `<p style="white-space:pre-wrap">${p.html.replace(/\n/g, '<br/>')}</p>`), `<p><a href="${escapeHtml(link)}">${escapeHtml(t('open'))}</a></p>`].join('\n'),
    telegram: [`<b>${escapeHtml(headline)}</b>`, ...parts.map((p) => p.html), ...(link.startsWith('https://') ? [] : [escapeHtml(link)])].join('\n\n'),
    buttons: openButton(link).length ? [openButton(link)] : [],
    link,
  };
}
