import { createTranslator } from 'next-intl';
import messages from '@/messages/it.json';
import { formatRome, romeParts } from '@/lib/dates';
import { healthIssues, type JobHealth } from '@/lib/jobs/health';
import { escapeHtml } from '@/lib/notifications/task-messages';
import type { TaskKind } from '@/lib/tasks/constants';

// The daily stand-up for the team chat (docs/fase1-plan.md §3): late, due
// today, to assign; Express first (the SQL orders each list); a health line
// only when something is wrong. Telegram caps a message at 4096 characters:
// what does not fit becomes "+N altri — apri l'app".

const t = createTranslator({ locale: 'it', messages, namespace: 'standup' });
const tKind = createTranslator({ locale: 'it', messages, namespace: 'tasks.kind' });

export type StandupItem = {
  task_id: string;
  reel_id: string;
  code: string;
  title: string;
  kind: TaskKind;
  status: string;
  due_at: string | null;
  express: boolean;
  assignee_name: string | null;
};

export type StandupSnapshot = {
  late: StandupItem[];
  due_today: StandupItem[];
  unassigned: StandupItem[];
  health: JobHealth | null;
};

export const TELEGRAM_LIMIT = 4096;

function itemLine(i: StandupItem, withDue: 'date' | 'time' | 'none'): string {
  const title = i.title.length > 60 ? `${i.title.slice(0, 59)}…` : i.title;
  const parts = [
    `${i.express ? '⚡ ' : ''}<code>${escapeHtml(i.code)}</code> ${escapeHtml(title)}`,
    escapeHtml(tKind(i.kind)),
  ];
  if (i.assignee_name) parts.push(escapeHtml(i.assignee_name));
  if (i.due_at && withDue === 'date') parts.push(escapeHtml(formatRome(i.due_at)));
  if (i.due_at && withDue === 'time') parts.push(escapeHtml(formatRome(i.due_at, { timeStyle: 'short' })));
  return parts.join(' · ');
}

// The cron fires at 06:30 and 07:30 UTC; only the run at 08:30 ± 10 min in
// Rome sends (CEST in summer, CET in winter).
export function isStandupTime(now: Date): boolean {
  const { hour, minute } = romeParts(now);
  return Math.abs(hour * 60 + minute - (8 * 60 + 30)) <= 10;
}

export function hasStandupNews(s: StandupSnapshot): boolean {
  return s.late.length + s.due_today.length + s.unassigned.length > 0;
}

// Weekend: Batch deadlines skip Saturday and Sunday, so the message goes out
// only for Express items or work already late.
export function worthSendingOnWeekend(s: StandupSnapshot): boolean {
  return s.late.length > 0 || [...s.due_today, ...s.unassigned].some((i) => i.express);
}

export function formatStandup(args: { snapshot: StandupSnapshot; dayLabel: string; appUrl: string }): string {
  const { snapshot: s } = args;
  const head = `<b>${escapeHtml(t('title', { day: args.dayLabel }))}</b>`;
  const issues = healthIssues(s.health);
  const health = issues.length
    ? `⚙️ ${escapeHtml(issues.map((k) => t(`health.${k}`, {
        minutes: s.health?.sweep_age_minutes ?? 0,
        errors: s.health?.sweep_errors ?? 0,
        backlog: s.health?.oldest_job_minutes ?? 0,
        dead: s.health?.dead_letters_24h ?? 0,
        violations: s.health?.violations ?? 0,
      })).join(' · '))}`
    : null;

  const sections: { title: string; lines: string[] }[] = [
    { title: t('late', { count: s.late.length }), lines: s.late.map((i) => itemLine(i, 'date')) },
    { title: t('dueToday', { count: s.due_today.length }), lines: s.due_today.map((i) => itemLine(i, 'time')) },
    { title: t('unassigned', { count: s.unassigned.length }), lines: s.unassigned.map((i) => itemLine(i, 'none')) },
  ].filter((sec) => sec.lines.length > 0);

  const link = args.appUrl.startsWith('https://') ? escapeHtml(`${args.appUrl}/compiti`) : null;
  const tail = [health, link].filter((x): x is string => !!x);
  // Room for the tail and the "+N altri" line.
  const budget = TELEGRAM_LIMIT - tail.join('\n\n').length - 120;

  const parts = [head];
  let used = head.length;
  let dropped = 0;
  // Once the budget is reached everything after it is dropped: the lists
  // are in priority order.
  let full = false;
  for (const sec of sections) {
    const title = `<b>${escapeHtml(sec.title)}</b>`;
    const kept: string[] = [];
    let size = 2 + title.length;
    for (const line of sec.lines) {
      if (full || used + size + 1 + line.length > budget) {
        full = true;
        dropped += 1;
        continue;
      }
      kept.push(line);
      size += 1 + line.length;
    }
    if (kept.length) {
      parts.push([title, ...kept].join('\n'));
      used += size;
    }
  }
  if (sections.length === 0) parts.push(escapeHtml(t('nothing')));
  if (dropped > 0) parts.push(escapeHtml(t('more', { count: dropped })));
  return [...parts, ...tail].join('\n\n');
}
