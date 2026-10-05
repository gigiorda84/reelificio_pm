import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Zap } from 'lucide-react';
import type { TaskListItem } from '@/lib/tasks/queries';
import { semaforo, slaPercent } from '@/lib/tasks/semaforo';
import { formatRome } from '@/lib/dates';

const LIGHT: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-red-500',
};

// One open task in a list: semaforo, kind and status, reel, deadline. Opens
// the reel on its task panel.
export async function TaskRow({ task }: { task: TaskListItem }) {
  const t = await getTranslations('tasks');
  const thresholds = {
    startedAt: task.started_at,
    yellowAt: task.yellow_at,
    dueAt: task.due_at,
    escalateAt: task.escalate_at,
  };
  const light = semaforo(thresholds);
  const pct = slaPercent(thresholds);

  return (
    <Link
      href={`/reels/${task.reel.id}?task=${task.id}#task`}
      className="flex items-center gap-3 rounded-lg border bg-background px-4 py-3 hover:bg-accent/30"
    >
      <span
        className={`size-2.5 shrink-0 rounded-full ${light ? LIGHT[light] : 'bg-zinc-300'}`}
        aria-label={light ?? ''}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {t(`kind.${task.kind}`)}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{t(`status.${task.status}`)}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          <span className="font-mono">{task.reel.code}</span> · {task.reel.title}
          {task.reel.page_name ? ` · ${task.reel.page_name}` : ''}
        </p>
      </div>
      <div className="shrink-0 text-right text-xs">
        {task.reel.track === 'express' ? (
          <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-red-800 dark:bg-red-950 dark:text-red-200">
            <Zap className="size-3" aria-hidden /> {t('panel.express')}
          </span>
        ) : null}
        <p className="text-muted-foreground">
          {task.due_at
            ? formatRome(task.due_at)
            : '—'}
        </p>
        {pct !== null ? <p className="text-muted-foreground">{t('panel.slaUsed', { pct })}</p> : null}
      </div>
    </Link>
  );
}
