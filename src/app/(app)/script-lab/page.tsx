import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireInternal } from '@/lib/auth/viewer';
import { cn } from '@/lib/utils';
import { getScriptLabMetrics, type ScriptLabMetrics } from '@/lib/script-lab/metrics';
import {
  metricsPeriod,
  monthLabel,
  parsePeriod,
  PERIOD_CHOICES,
  SENDBACK_TARGET,
  share,
} from '@/lib/script-lab/metrics-period';

// Script Lab metrics for admins (docs/fase2-plan.md S7, AC22–AC25): send-
// backs, batches from ideas versus the Doc, bibles, reels per author and
// where the delivered scripts come from. Others go back to the dashboard.
export default async function ScriptLabPage({
  searchParams,
}: {
  searchParams: Promise<{ mesi?: string | string[] }>;
}) {
  const viewer = await requireInternal();
  if (!viewer.isAdmin) redirect('/dashboard');
  const months = parsePeriod((await searchParams).mesi);
  const period = metricsPeriod(months, new Date());
  const [t, tGaps, metrics] = await Promise.all([
    getTranslations('scriptLabMetrics'),
    getTranslations('bible.gaps'),
    getScriptLabMetrics(period),
  ]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>
        <nav aria-label={t('period')} className="flex gap-1 rounded-full bg-white/70 p-1 ring-1 ring-black/5">
          {PERIOD_CHOICES.map((n) => (
            <Link
              key={n}
              href={`/script-lab?mesi=${n}`}
              aria-current={n === months ? 'page' : undefined}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs',
                n === months ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-900/5',
              )}
            >
              {t('months', { count: n })}
            </Link>
          ))}
        </nav>
      </div>

      <Sendback metrics={metrics} months={period.months} />
      <Batches metrics={metrics} months={period.months} next={period.next} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">{t('bibles.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>{t('bibles.summary', { complete: metrics.bibles.complete, total: metrics.bibles.active_pages })}</p>
          {metrics.bibles.pages.some((p) => p.missing.length > 0) ? (
            <ul className="divide-y rounded-lg border">
              {metrics.bibles.pages
                .filter((p) => p.missing.length > 0)
                .map((p) => (
                  <li key={p.page_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <Link href={`/pages/${p.page_id}/bibbia`} className="font-medium underline underline-offset-4">
                      {p.name}
                    </Link>
                    <span className="text-muted-foreground">
                      {t('bibles.missing', { items: p.missing.map((m) => tGaps(m)).join(', ') })}
                    </span>
                  </li>
                ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Authors metrics={metrics} months={period.months} />
      <Provenance metrics={metrics} months={period.months} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">{t('costs.title')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t('costs.pending')}</CardContent>
      </Card>
    </div>
  );
}

type SectionProps = { metrics: ScriptLabMetrics; months: string[] };

const TH = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground';
const TD = 'px-3 py-2 tabular-nums';

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

async function Sendback({ metrics, months }: SectionProps) {
  const t = await getTranslations('scriptLabMetrics');
  const empty = { arrived: 0, decided: 0, sent_back: 0 };
  const rows = months.map((month) => ({ month, ...(metrics.sendback.find((r) => r.month === month) ?? empty) }));
  const total = rows.reduce(
    (sum, r) => ({ arrived: sum.arrived + r.arrived, decided: sum.decided + r.decided, sent_back: sum.sent_back + r.sent_back }),
    empty,
  );
  // Over target as shown: 20.2% reads "20%" and is not flagged.
  const over = (r: typeof empty) => Math.round((share(r.sent_back, r.decided) ?? 0) * 100) > SENDBACK_TARGET * 100;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">{t('sendback.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t('sendback.intro')}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr className="border-b">
                <th className={TH}>{t('month')}</th>
                <th className={TH}>{t('sendback.arrived')}</th>
                <th className={TH}>{t('sendback.pending')}</th>
                <th className={TH}>{t('sendback.sentBack')}</th>
                <th className={TH}>{t('sendback.share')}</th>
              </tr>
            </thead>
            <tbody>
              {[...rows, { month: 'total', ...total }].map((r) => (
                <tr key={r.month} className={cn('border-b last:border-0', r.month === 'total' && 'font-medium')}>
                  <td className="px-3 py-2">{r.month === 'total' ? t('total') : monthLabel(r.month)}</td>
                  <td className={TD}>{r.arrived}</td>
                  <td className={TD}>{r.arrived - r.decided}</td>
                  <td className={TD}>{r.sent_back}</td>
                  <td className={cn(TD, over(r) && 'text-destructive font-medium')}>
                    {percent(share(r.sent_back, r.decided))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

async function Batches({ metrics, months, next }: SectionProps & { next: string }) {
  const t = await getTranslations('scriptLabMetrics');
  const cell = (month: string, origin: 'ideas' | 'import') => {
    const r = metrics.batches.find((b) => b.month === month && b.origin === origin);
    return r ? t('batches.cell', { batches: r.batches, reels: r.reels }) : '—';
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">{t('batches.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t('batches.intro')}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px]">
            <thead>
              <tr className="border-b">
                <th className={TH}>{t('month')}</th>
                <th className={TH}>{t('batches.ideas')}</th>
                <th className={TH}>{t('batches.import')}</th>
              </tr>
            </thead>
            <tbody>
              {[...months, next].map((month) => (
                <tr key={month} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    {monthLabel(month)}
                    {month === next ? <span className="text-muted-foreground"> · {t('batches.next')}</span> : null}
                  </td>
                  <td className={TD}>{cell(month, 'ideas')}</td>
                  <td className={TD}>{cell(month, 'import')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

async function Authors({ metrics, months }: SectionProps) {
  const t = await getTranslations('scriptLabMetrics');
  const authors = [...new Map(metrics.authors.map((a) => [a.author_id ?? '', a.name])).entries()];
  const count = (id: string, month: string) =>
    metrics.authors.find((a) => (a.author_id ?? '') === id && a.month === month)?.reels ?? 0;
  const total = (id: string) => months.reduce((n, m) => n + count(id, m), 0);
  authors.sort((a, b) => total(b[0]) - total(a[0]) || (a[1] ?? '').localeCompare(b[1] ?? ''));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">{t('authors.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t('authors.intro')}</p>
        {authors.length === 0 ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr className="border-b">
                  <th className={TH}>{t('authors.author')}</th>
                  {months.map((m) => (
                    <th key={m} className={TH}>
                      {monthLabel(m)}
                    </th>
                  ))}
                  <th className={TH}>{t('total')}</th>
                </tr>
              </thead>
              <tbody>
                {authors.map(([id, name]) => (
                  <tr key={id} className="border-b last:border-0">
                    <td className="px-3 py-2">{name ?? t('authors.noName')}</td>
                    {months.map((m) => (
                      <td key={m} className={TD}>
                        {count(id, m) || '—'}
                      </td>
                    ))}
                    <td className={cn(TD, 'font-medium')}>{total(id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

async function Provenance({ metrics, months }: SectionProps) {
  const t = await getTranslations('scriptLabMetrics');
  const rows = metrics.provenance.filter((r) => months.includes(r.month));
  const list = (counts: Record<string, number>) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, n]) => `${k === 'manuale' ? t('provenance.manual') : k} ${n}`)
      .join(' · ') || '—';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">{t('provenance.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t('provenance.intro')}</p>
        {rows.length === 0 ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b">
                  <th className={TH}>{t('month')}</th>
                  <th className={TH}>{t('provenance.delivered')}</th>
                  <th className={TH}>{t('provenance.mixed')}</th>
                  <th className={TH}>{t('provenance.bases')}</th>
                  <th className={TH}>{t('provenance.blocks')}</th>
                  <th className={TH}>{t('provenance.edited')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.month} className="border-b last:border-0 align-top">
                    <td className="px-3 py-2">{monthLabel(r.month)}</td>
                    <td className={TD}>{r.delivered}</td>
                    <td className={TD}>
                      {r.mixed} ({percent(share(r.mixed, r.delivered))})
                    </td>
                    <td className="px-3 py-2">{list(r.bases)}</td>
                    <td className="px-3 py-2">{list(r.blocks)}</td>
                    <td className={TD}>
                      {r.edited_after_mix} ({percent(share(r.edited_after_mix, r.mixed))})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
