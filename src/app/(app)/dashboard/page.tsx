import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowUpRight, Layers, FileVideo, Users } from 'lucide-react';
import { AdminBootstrapBanner } from '@/components/admin-bootstrap-banner';
import { getAdminStatus } from '@/lib/auth/admin';
import { getDashboardData } from '@/lib/dashboard/queries';
import { countOpenAlerts } from '@/lib/alerts/queries';
import { ALL_PIPELINE_PHASES } from '@/lib/reels/constants';
import {
  getMyTodayUpdate,
  listTeamUpdatesForDate,
} from '@/lib/daily-updates/queries';
import { DailyUpdateForm } from '@/components/daily-updates/daily-update-form';
import { TeamUpdatesList } from '@/components/daily-updates/team-updates-list';
import { getSupabaseServerClient } from '@/lib/supabase/server';

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'short',
  });
}

export default async function DashboardPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    t,
    tDU,
    tPhaseShort,
    adminStatus,
    data,
    openAlertCount,
    myToday,
    teamToday,
  ] = await Promise.all([
    getTranslations('dashboard'),
    getTranslations('dailyUpdates'),
    getTranslations('batches.reel.phaseShort'),
    getAdminStatus(),
    getDashboardData(),
    countOpenAlerts(),
    getMyTodayUpdate(),
    listTeamUpdatesForDate(),
  ]);

  const showBootstrap = !adminStatus.isAdmin && !adminStatus.hasAnyAdmin;
  const lowBufferCount = data.pages.filter((p) => p.buffer_below_threshold).length;
  const hasAnyData =
    data.totals.pages > 0 ||
    data.totals.batches > 0 ||
    data.totals.reels_in_flight > 0;

  const userName = user?.email?.split('@')[0] ?? '';
  const displayName =
    userName.charAt(0).toUpperCase() + userName.slice(1);

  // Compute global phase distribution for the progress chart
  const phaseTotals: Record<string, number> = Object.fromEntries(
    ALL_PIPELINE_PHASES.map((ph) => [ph, 0]),
  );
  for (const p of data.pages) {
    for (const ph of ALL_PIPELINE_PHASES) {
      phaseTotals[ph] += p.phase_counts[ph] || 0;
    }
  }
  const maxPhase = Math.max(1, ...Object.values(phaseTotals));
  const peakPhase = (ALL_PIPELINE_PHASES as readonly string[]).reduce(
    (acc, ph) => (phaseTotals[ph] > phaseTotals[acc] ? ph : acc),
    ALL_PIPELINE_PHASES[0],
  );

  // Buffer health
  const lowestBufferPage = [...data.pages].sort(
    (a, b) => a.buffer_count / a.buffer_threshold - b.buffer_count / b.buffer_threshold,
  )[0];
  const bufferPct = lowestBufferPage
    ? Math.min(
        100,
        Math.round(
          (lowestBufferPage.buffer_count / lowestBufferPage.buffer_threshold) *
            100,
        ),
      )
    : 0;

  // To-do items
  type Todo = { label: string; href: string; done?: boolean };
  const todos: Todo[] = [];
  if (openAlertCount > 0)
    todos.push({
      label: t('alerts.openAlerts', { count: openAlertCount }),
      href: '/alerts',
    });
  if (data.totals.pending_requests > 0)
    todos.push({
      label: t('alerts.pending', { count: data.totals.pending_requests }),
      href: '/pipeline',
    });
  if (lowBufferCount > 0)
    todos.push({
      label: t('alerts.lowBuffer', { count: lowBufferCount }),
      href: '/pages',
    });
  if (!myToday)
    todos.push({
      label: tDU('myCardTitle'),
      href: '/aggiornamenti',
    });

  return (
    <div className="space-y-6">
      {showBootstrap ? <AdminBootstrapBanner /> : null}

      {/* Hero header */}
      <section className="flex flex-col md:flex-row md:items-end gap-6 pt-2">
        <div className="flex-1">
          <h1 className="text-4xl md:text-5xl font-heading tracking-tight text-zinc-900">
            Bentornato, <span className="italic font-light">{displayName}</span>
          </h1>

          {/* KPI capsules */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <CapsuleStat
              label={t('totals.pages')}
              value={data.totals.pages}
              tone="dark"
            />
            <CapsuleStat
              label={t('totals.batches')}
              value={data.totals.batches}
              tone="accent"
            />
            <CapsuleStat
              label={t('totals.reelsInFlight')}
              value={data.totals.reels_in_flight}
              tone="ghost"
            />
            <CapsuleStat
              label={t('totals.pendingRequests')}
              value={data.totals.pending_requests}
              tone={data.totals.pending_requests > 0 ? 'accent' : 'ghost'}
            />
          </div>
        </div>

        {/* Big number summary */}
        <div className="flex items-end gap-8 md:gap-10">
          <BigStat
            value={data.totals.pages}
            label={t('totals.pages')}
            icon={<Users className="size-4" />}
          />
          <BigStat
            value={data.totals.batches}
            label={t('totals.batches')}
            icon={<Layers className="size-4" />}
          />
          <BigStat
            value={data.totals.reels_in_flight}
            label="Reel"
            icon={<FileVideo className="size-4" />}
          />
        </div>
      </section>

      {!hasAnyData ? (
        <div className="glass-card p-10 text-center text-zinc-600">
          {t('empty')}
        </div>
      ) : (
        <>
          {/* Main 4-card row */}
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Featured page (top in-flight) */}
            <FeaturedPageCard
              page={
                data.pages.slice().sort(
                  (a, b) => b.total_in_flight - a.total_in_flight,
                )[0] ?? null
              }
            />

            {/* Progress chart */}
            <div className="glass-card p-5 col-span-1">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-base font-medium text-zinc-900">
                    Pipeline
                  </p>
                  <p className="mt-1 text-3xl font-heading">
                    {data.totals.reels_in_flight}
                    <span className="ml-1 text-sm font-normal text-zinc-500">
                      reel attivi
                    </span>
                  </p>
                </div>
                <Link
                  href="/pipeline"
                  aria-label="Apri pipeline"
                  className="grid place-items-center size-8 rounded-full bg-white ring-1 ring-black/5 hover:bg-zinc-50"
                >
                  <ArrowUpRight className="size-4" />
                </Link>
              </div>

              <div className="mt-4 flex items-end gap-2 h-24">
                {ALL_PIPELINE_PHASES.map((ph) => {
                  const v = phaseTotals[ph];
                  const h = Math.max(6, Math.round((v / maxPhase) * 92));
                  const isPeak = ph === peakPhase && v > 0;
                  return (
                    <div
                      key={ph}
                      className="flex-1 flex flex-col items-center gap-1 relative"
                    >
                      {isPeak ? (
                        <span className="absolute -top-6 text-[10px] font-medium bg-amber-300 text-zinc-900 rounded-full px-2 py-0.5">
                          {v}
                        </span>
                      ) : null}
                      <div
                        className={`w-full rounded-t-full ${
                          isPeak ? 'bg-amber-300' : 'bg-zinc-800'
                        }`}
                        style={{ height: `${h}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center gap-2">
                {ALL_PIPELINE_PHASES.map((ph) => (
                  <div
                    key={ph}
                    className="flex-1 text-center text-[10px] uppercase tracking-wide text-zinc-500"
                  >
                    {tPhaseShort(ph).slice(0, 3)}
                  </div>
                ))}
              </div>
            </div>

            {/* Buffer tracker (circular) */}
            <div className="glass-card p-5">
              <div className="flex items-start justify-between">
                <p className="text-base font-medium text-zinc-900">
                  Buffer
                </p>
                <Link
                  href="/pages"
                  aria-label="Pagine"
                  className="grid place-items-center size-8 rounded-full bg-white ring-1 ring-black/5 hover:bg-zinc-50"
                >
                  <ArrowUpRight className="size-4" />
                </Link>
              </div>
              <div className="mt-2 grid place-items-center">
                <CircularGauge
                  pct={bufferPct}
                  centerValue={
                    lowestBufferPage
                      ? `${lowestBufferPage.buffer_count}/${lowestBufferPage.buffer_threshold}`
                      : '—'
                  }
                  centerLabel={
                    lowestBufferPage ? lowestBufferPage.name : 'nessuna pagina'
                  }
                  warn={lowestBufferPage?.buffer_below_threshold}
                />
              </div>
            </div>

            {/* To-do card (dark) */}
            <div className="rounded-3xl bg-zinc-900 text-zinc-100 p-5 ring-1 ring-black/10 shadow-sm">
              <div className="flex items-start justify-between">
                <p className="text-base font-medium">Da fare oggi</p>
                <span className="text-xs text-zinc-400">
                  {todos.filter((td) => !td.done).length}/{Math.max(todos.length, 1)}
                </span>
              </div>
              <ul className="mt-4 space-y-3">
                {todos.length === 0 ? (
                  <li className="text-sm text-zinc-400">
                    {t('alerts.allGood')}
                  </li>
                ) : (
                  todos.slice(0, 5).map((td, i) => (
                    <li key={i}>
                      <Link
                        href={td.href}
                        className="flex items-center gap-3 group"
                      >
                        <span className="grid place-items-center size-8 rounded-full bg-zinc-800 ring-1 ring-white/5 text-amber-300 text-xs">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="text-sm text-zinc-200 group-hover:text-white truncate">
                          {td.label}
                        </span>
                        <ArrowUpRight className="size-3.5 ml-auto text-zinc-500 group-hover:text-amber-300" />
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </section>

          {/* Daily update row */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="glass-card p-5 md:col-span-1">
              <p className="text-base font-medium text-zinc-900">
                {tDU('myCardTitle')}
              </p>
              <div className="mt-3">
                <DailyUpdateForm
                  initial={{
                    did_today: myToday?.did_today ?? '',
                    blockers: myToday?.blockers ?? '',
                    tomorrow: myToday?.tomorrow ?? '',
                  }}
                  alreadySubmitted={!!myToday}
                />
              </div>
            </div>
            <div className="glass-card p-5 md:col-span-2">
              <div className="flex items-center justify-between">
                <p className="text-base font-medium text-zinc-900">
                  {tDU('teamTodayTitle')}
                </p>
                <Link
                  href="/aggiornamenti"
                  className="text-xs text-zinc-500 hover:text-zinc-900"
                >
                  {tDU('seeAll')}
                </Link>
              </div>
              <div className="mt-3">
                <TeamUpdatesList updates={teamToday} />
              </div>
            </div>
          </section>

          {/* Pages + recent batches */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="glass-card p-5 lg:col-span-2">
              <p className="text-base font-medium text-zinc-900">
                {t('pages.title')}
              </p>
              {data.pages.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-500">
                  {t('pages.empty')}
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-zinc-500">
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
                    <tbody className="divide-y divide-black/5">
                      {data.pages.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2.5 pr-4">
                            <Link
                              href={`/pipeline?page=${p.id}`}
                              className="hover:underline flex items-center gap-2"
                            >
                              <span className="grid place-items-center size-7 rounded-full bg-amber-200 text-zinc-900 text-[10px] font-semibold">
                                {p.code_prefix}
                              </span>
                              <span>{p.name}</span>
                            </Link>
                          </td>
                          <td className="py-2.5 pr-4 tabular-nums">
                            {p.total_in_flight}
                          </td>
                          {ALL_PIPELINE_PHASES.map((ph) => (
                            <td
                              key={ph}
                              className="py-2.5 px-2 text-center tabular-nums text-zinc-500"
                            >
                              {p.phase_counts[ph] || '·'}
                            </td>
                          ))}
                          <td className="py-2.5 pl-4">
                            <span
                              className={
                                p.buffer_below_threshold
                                  ? 'inline-flex items-center gap-1.5 rounded-full bg-rose-100 text-rose-700 px-2.5 py-0.5 text-xs font-medium'
                                  : 'inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-700 px-2.5 py-0.5 text-xs font-medium'
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
            </div>

            <div className="glass-card p-5">
              <p className="text-base font-medium text-zinc-900">
                {t('recent.title')}
              </p>
              {data.recent_batches.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-500">
                  {t('recent.empty')}
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {data.recent_batches.map((b) => {
                    const synced = formatDate(b.source_doc_synced_at);
                    return (
                      <li key={b.id}>
                        <Link
                          href={`/batches/${b.id}`}
                          className="flex items-center gap-3 group"
                        >
                          <span className="grid place-items-center size-9 rounded-full bg-zinc-900 text-amber-300 text-[10px] font-semibold">
                            {b.page_code_prefix}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-zinc-900 truncate group-hover:underline">
                              {b.label}
                            </span>
                            <span className="block text-xs text-zinc-500 truncate">
                              {b.page_name} ·{' '}
                              {t('recent.reels', { count: b.reel_count })}
                            </span>
                          </span>
                          <span className="text-[10px] text-zinc-500 whitespace-nowrap">
                            {synced ?? t('recent.neverSynced')}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function CapsuleStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'dark' | 'accent' | 'ghost';
}) {
  const styles =
    tone === 'dark'
      ? 'bg-zinc-900 text-white'
      : tone === 'accent'
        ? 'bg-amber-300 text-zinc-900'
        : 'bg-white/70 text-zinc-700 ring-1 ring-black/5';
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-zinc-600">{label}</span>
      <span
        className={`inline-flex items-center justify-center min-w-[64px] rounded-full px-4 py-1.5 text-sm font-semibold ${styles}`}
      >
        {value}
      </span>
    </div>
  );
}

function BigStat({
  value,
  label,
  icon,
}: {
  value: number;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="text-right">
      <div className="text-4xl md:text-5xl font-heading tabular-nums text-zinc-900 leading-none">
        {value}
      </div>
      <div className="mt-1 flex items-center justify-end gap-1.5 text-xs text-zinc-600">
        <span className="grid place-items-center size-5 rounded-full bg-zinc-900 text-amber-300">
          {icon}
        </span>
        <span>{label}</span>
      </div>
    </div>
  );
}

function FeaturedPageCard({
  page,
}: {
  page: {
    id: string;
    name: string;
    code_prefix: string;
    total_in_flight: number;
    buffer_count: number;
    buffer_threshold: number;
  } | null;
}) {
  if (!page) {
    return (
      <div className="glass-card p-5 grid place-items-center text-sm text-zinc-500 min-h-[220px]">
        Nessuna pagina attiva
      </div>
    );
  }
  return (
    <Link
      href={`/pipeline?page=${page.id}`}
      className="relative overflow-hidden rounded-3xl ring-1 ring-black/5 shadow-sm bg-gradient-to-br from-amber-200 via-amber-100 to-amber-50 p-5 flex flex-col min-h-[220px] hover:ring-black/10 transition"
    >
      <div className="flex items-center justify-between">
        <span className="grid place-items-center size-10 rounded-full bg-zinc-900 text-amber-300 text-xs font-bold">
          {page.code_prefix}
        </span>
        <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-[11px] font-medium text-zinc-700">
          Top page
        </span>
      </div>
      <div className="mt-auto">
        <p className="text-lg font-medium text-zinc-900">{page.name}</p>
        <p className="text-xs text-zinc-600 mt-0.5">
          {page.total_in_flight} reel attivi · buffer {page.buffer_count}/
          {page.buffer_threshold}
        </p>
      </div>
    </Link>
  );
}

function CircularGauge({
  pct,
  centerValue,
  centerLabel,
  warn,
}: {
  pct: number;
  centerValue: string;
  centerLabel: string;
  warn?: boolean;
}) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const stroke = warn ? '#f59e0b' : '#18181b';
  return (
    <div className="relative size-32">
      <svg viewBox="0 0 100 100" className="size-32 -rotate-90">
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="8"
          strokeDasharray="2 6"
          strokeLinecap="round"
        />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-lg font-heading tabular-nums">{centerValue}</div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 max-w-[80px] truncate">
            {centerLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
