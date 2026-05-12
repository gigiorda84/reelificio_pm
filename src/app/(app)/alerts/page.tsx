import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getAdminStatus } from '@/lib/auth/admin';
import { listAlerts, type AlertWithRefs } from '@/lib/alerts/queries';
import { CloseAlertButton } from './close-alert-button';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export default async function AlertsPage() {
  const [t, tPhase, adminStatus, open, closed] = await Promise.all([
    getTranslations('alerts'),
    getTranslations('batches.reel.phase'),
    getAdminStatus(),
    listAlerts('open'),
    listAlerts('closed'),
  ]);

  const renderHeadline = (a: AlertWithRefs) => {
    if (a.kind === 'buffer_low') {
      return (
        <div className="text-sm">
          <span className="inline-flex items-center rounded bg-rose-100 dark:bg-rose-900/30 text-rose-800 dark:text-rose-200 text-xs font-medium px-2 py-0.5 mr-2">
            {t('kinds.bufferLow')}
          </span>
          <Link
            href={`/pipeline?page=${a.page_id ?? ''}`}
            className="font-medium hover:underline"
          >
            {a.page_name ?? '—'}
          </Link>
          <span className="text-muted-foreground">
            {' '}
            ·{' '}
            {t('bufferDetail', {
              count: Number(a.payload?.buffer_count ?? 0),
              threshold: Number(a.payload?.buffer_threshold ?? 0),
            })}
          </span>
        </div>
      );
    }
    return (
      <div className="text-sm">
        <span className="inline-flex items-center rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 text-xs font-medium px-2 py-0.5 mr-2">
          {t('kinds.phaseStuck')}
        </span>
        <Link
          href={`/reels/${a.reel_id ?? ''}`}
          className="font-medium hover:underline"
        >
          <span className="font-mono text-xs text-muted-foreground mr-1">
            {a.reel_code ?? ''}
          </span>
          {a.reel_title ?? ''}
        </Link>
        <span className="text-muted-foreground">
          {' '}
          · {a.phase ? tPhase(a.phase) : ''} ·{' '}
          {t('hoursInPhase', { hours: Number(a.payload?.hours_in_phase ?? 0) })}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {t('openTitle', { count: open.length })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('openEmpty')}</p>
          ) : (
            <ul className="divide-y">
              {open.map((a) => (
                <li key={a.id} className="py-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      {renderHeadline(a)}
                      <p className="text-xs text-muted-foreground">
                        {t('openedAt', { date: formatDateTime(a.opened_at) })}
                      </p>
                    </div>
                    {adminStatus.isAdmin ? (
                      <CloseAlertButton alertId={a.id} />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t('adminOnly')}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {t('closedTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {closed.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('closedEmpty')}</p>
          ) : (
            <ul className="divide-y">
              {closed.slice(0, 50).map((a) => (
                <li key={a.id} className="py-3 text-sm space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    {renderHeadline(a)}
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(a.closed_at ?? a.opened_at)}
                    </span>
                  </div>
                  {a.proposed_solution ? (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">
                        {t('proposedSolutionLabel')}:
                      </span>{' '}
                      {a.proposed_solution}
                      {a.closed_by_name ? (
                        <span className="ml-2">— {a.closed_by_name}</span>
                      ) : null}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
