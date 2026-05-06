import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import {
  getPipelineBoard,
  listPagesForFilter,
  listBatchesForFilter,
} from '@/lib/pipeline/queries';
import {
  ALL_PIPELINE_PHASES,
  type PipelinePhase,
} from '@/lib/reels/constants';
import { PipelineFilters } from './filters';

const STATUS_DOT: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-rose-500',
};

function daysSince(iso: string, today: Date): number {
  const then = new Date(iso);
  const ms = today.getTime() - then.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; batch?: string }>;
}) {
  const sp = await searchParams;
  const filters = {
    pageId: sp.page || undefined,
    batchId: sp.batch || undefined,
  };

  const [t, tPhaseShort, tFmt, board, pages, batches] = await Promise.all([
    getTranslations('pipeline'),
    getTranslations('batches.reel.phaseShort'),
    getTranslations('batches.reel.format'),
    getPipelineBoard(filters),
    listPagesForFilter(),
    listBatchesForFilter(filters.pageId),
  ]);

  const today = new Date();
  const totalCards = ALL_PIPELINE_PHASES.reduce(
    (sum, p) => sum + (board[p]?.length ?? 0),
    0,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <PipelineFilters
        pages={pages}
        batches={batches}
        selectedPageId={filters.pageId}
        selectedBatchId={filters.batchId}
      />

      {totalCards === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">{t('empty')}</Card>
      ) : (
        <div className="overflow-x-auto -mx-6 px-6 pb-4">
          <div className="flex gap-3 min-w-max">
            {ALL_PIPELINE_PHASES.map((phase) => (
              <Column
                key={phase}
                phase={phase}
                cards={board[phase] ?? []}
                today={today}
                t={{
                  phaseShort: tPhaseShort,
                  fmt: tFmt,
                  pendingBadge: t('pendingBadge'),
                  daysIn: t,
                  today: t('today'),
                  empty: t('phaseEmpty'),
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type ColumnProps = {
  phase: PipelinePhase;
  cards: Awaited<ReturnType<typeof getPipelineBoard>>[PipelinePhase];
  today: Date;
  t: {
    phaseShort: (key: string) => string;
    fmt: (key: string) => string;
    pendingBadge: string;
    daysIn: (key: 'daysIn', vars: { count: number }) => string;
    today: string;
    empty: string;
  };
};

function Column({ phase, cards, today, t }: ColumnProps) {
  return (
    <div className="w-72 shrink-0">
      <div className="flex items-center justify-between px-1 mb-2">
        <h2 className="text-sm font-medium">{t.phaseShort(phase)}</h2>
        <span className="text-xs text-muted-foreground">{cards.length}</span>
      </div>
      <div className="space-y-2">
        {cards.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1 py-4 text-center">
            {t.empty}
          </p>
        ) : (
          cards.map((c) => {
            const days = daysSince(c.phase_entered_at, today);
            return (
              <Link
                key={c.id}
                href={`/reels/${c.id}`}
                className="block rounded-lg border bg-card p-3 hover:border-foreground/20 hover:shadow-sm transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {c.code}
                  </span>
                  <span
                    aria-hidden
                    className={`size-2 rounded-full mt-1 ${STATUS_DOT[c.phase_status]}`}
                  />
                </div>
                <p className="mt-1 text-sm font-medium leading-snug line-clamp-2">
                  {c.title}
                </p>
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{c.page_code_prefix}</span>
                  <span>·</span>
                  <span>
                    {days === 0 ? t.today : t.daysIn('daysIn', { count: days })}
                  </span>
                </div>
                {c.has_pending_request ? (
                  <p className="mt-2 inline-block rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 text-[10px] px-2 py-0.5">
                    {t.pendingBadge}
                  </p>
                ) : null}
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
