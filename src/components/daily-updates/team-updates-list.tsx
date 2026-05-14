import { useTranslations } from 'next-intl';
import type { DailyUpdateWithAuthor } from '@/lib/daily-updates/types';

export function TeamUpdatesList({
  updates,
  groupByDate,
}: {
  updates: DailyUpdateWithAuthor[];
  groupByDate?: boolean;
}) {
  const t = useTranslations('dailyUpdates');

  if (updates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t('teamEmpty')}</p>
    );
  }

  if (!groupByDate) {
    return (
      <ul className="space-y-3">
        {updates.map((u) => (
          <UpdateItem key={u.id} u={u} />
        ))}
      </ul>
    );
  }

  const byDate = new Map<string, DailyUpdateWithAuthor[]>();
  for (const u of updates) {
    const list = byDate.get(u.date) ?? [];
    list.push(u);
    byDate.set(u.date, list);
  }

  return (
    <div className="space-y-5">
      {Array.from(byDate.entries()).map(([date, list]) => (
        <div key={date} className="space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
            {formatDateIt(date)}
          </h3>
          <ul className="space-y-3">
            {list.map((u) => (
              <UpdateItem key={u.id} u={u} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function UpdateItem({ u }: { u: DailyUpdateWithAuthor }) {
  const t = useTranslations('dailyUpdates');
  const author = u.author_name ?? u.author_email ?? '—';
  return (
    <li className="rounded-md border bg-card px-3 py-2 text-sm space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{author}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatTimeIt(u.created_at)}
        </span>
      </div>
      <Section label={t('didToday')} value={u.did_today} />
      {u.blockers ? <Section label={t('blockers')} value={u.blockers} tone="warn" /> : null}
      {u.tomorrow ? <Section label={t('tomorrow')} value={u.tomorrow} /> : null}
    </li>
  );
}

function Section({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn';
}) {
  return (
    <div>
      <div
        className={`text-[10px] uppercase tracking-wider ${
          tone === 'warn'
            ? 'text-amber-700 dark:text-amber-300'
            : 'text-muted-foreground'
        }`}
      >
        {label}
      </div>
      <div className="whitespace-pre-wrap">{value}</div>
    </div>
  );
}

function formatDateIt(date: string): string {
  // YYYY-MM-DD -> e.g. "mar 14 mag"
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

function formatTimeIt(iso: string): string {
  return new Date(iso).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
