import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminBootstrapBanner } from '@/components/admin-bootstrap-banner';
import { getAdminStatus } from '@/lib/auth/admin';
import { getDashboardData } from '@/lib/dashboard/queries';
import { countOpenAlerts } from '@/lib/alerts/queries';
import { ALL_PIPELINE_PHASES } from '@/lib/reels/constants';

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default async function DashboardPage() {
  const [t, tPhaseShort, adminStatus, data, openAlertCount] = await Promise.all([
    getTranslations('dashboard'),
    getTranslations('batches.reel.phaseShort'),
    getAdminStatus(),
    getDashboardData(),
    countOpenAlerts(),
  ]);

  const showBootstrap = !adminStatus.isAdmin && !adminStatus.hasAnyAdmin;
  const lowBufferCount = data.pages.filter((p) => p.buffer_below_threshold).length;
  const hasAlerts =
    lowBufferCount > 0 || data.totals.pending_requests > 0 || openAlertCount > 0;
  const hasAnyData =
    data.totals.pages > 0 ||
    data.totals.batches > 0 ||
    data.totals.reels_in_flight > 0;

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

      {showBootstrap ? <AdminBootstrapBanner /> : null}

      {!hasAnyData ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">{t('empty')}</CardTitle>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={t('totals.pages')} value={data.totals.pages} />
            <Stat label={t('totals.batches')} value={data.totals.batches} />
            <Stat
              label={t('totals.reelsInFlight')}
              value={data.totals.reels_in_flight}
            />
            <Stat
              label={t('totals.pendingRequests')}
              value={data.totals.pending_requests}
              tone={data.totals.pending_requests > 0 ? 'warn' : undefined}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">
                {t('alerts.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              {hasAlerts ? (
                <ul className="space-y-1">
                  {openAlertCount > 0 ? (
                    <li className="text-rose-700 dark:text-rose-300">
                      <Link href="/alerts" className="hover:underline">
                        · {t('alerts.openAlerts', { count: openAlertCount })}
                      </Link>
                    </li>
                  ) : null}
                  {data.totals.pending_requests > 0 ? (
                    <li>
                      <Link href="/pipeline" className="hover:underline">
                        ·{' '}
                        {t('alerts.pending', {
                          count: data.totals.pending_requests,
                        })}
                      </Link>
                    </li>
                  ) : null}
                  {lowBufferCount > 0 ? (
                    <li className="text-rose-700 dark:text-rose-300">
                      ·{' '}
                      {t('alerts.lowBuffer', { count: lowBufferCount })}
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t('alerts.allGood')}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">
                {t('pages.title')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.pages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('pages.empty')}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="text-left">
                        <th className="py-2 pr-4 font-medium">
                          {t('pages.title')}
                        </th>
                        <th className="py-2 pr-4 font-medium">
                          {t('pages.inFlight')}
                        </th>
                        {ALL_PIPELINE_PHASES.map((ph) => (
                          <th
                            key={ph}
                            className="py-2 px-2 font-medium text-center"
                          >
                            {tPhaseShort(ph)}
                          </th>
                        ))}
                        <th className="py-2 pl-4 font-medium">
                          {t('pages.buffer')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.pages.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2 pr-4">
                            <Link
                              href={`/pipeline?page=${p.id}`}
                              className="hover:underline"
                            >
                              <span className="font-mono text-xs text-muted-foreground mr-2">
                                {p.code_prefix}
                              </span>
                              {p.name}
                            </Link>
                          </td>
                          <td className="py-2 pr-4 tabular-nums">
                            {p.total_in_flight}
                          </td>
                          {ALL_PIPELINE_PHASES.map((ph) => (
                            <td
                              key={ph}
                              className="py-2 px-2 text-center tabular-nums text-muted-foreground"
                            >
                              {p.phase_counts[ph] || '·'}
                            </td>
                          ))}
                          <td className="py-2 pl-4">
                            <span
                              className={
                                p.buffer_below_threshold
                                  ? 'text-rose-700 dark:text-rose-300 font-medium'
                                  : ''
                              }
                            >
                              {t('pages.bufferOf', {
                                count: p.buffer_count,
                                threshold: p.buffer_threshold,
                              })}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">
                {t('recent.title')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.recent_batches.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('recent.empty')}
                </p>
              ) : (
                <ul className="divide-y text-sm">
                  {data.recent_batches.map((b) => {
                    const synced = formatDate(b.source_doc_synced_at);
                    return (
                      <li
                        key={b.id}
                        className="py-2 flex items-center justify-between gap-4"
                      >
                        <Link
                          href={`/batches/${b.id}`}
                          className="hover:underline truncate"
                        >
                          <span className="font-mono text-xs text-muted-foreground mr-2">
                            {b.page_code_prefix}
                          </span>
                          {b.label}
                          <span className="text-muted-foreground">
                            {' '}
                            · {b.page_name}
                          </span>
                        </Link>
                        <div className="text-xs text-muted-foreground shrink-0 flex items-center gap-3">
                          <span>{t('recent.reels', { count: b.reel_count })}</span>
                          <span>
                            {synced
                              ? t('recent.syncedAt', { date: synced })
                              : t('recent.neverSynced')}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'warn';
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={`mt-1 text-2xl font-semibold tabular-nums ${
            tone === 'warn' && value > 0
              ? 'text-amber-700 dark:text-amber-300'
              : ''
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
