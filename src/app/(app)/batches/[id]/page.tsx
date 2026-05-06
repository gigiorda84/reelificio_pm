import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft, ExternalLink, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { getBatchDetail } from '@/lib/batches/queries';
import { ResyncButton } from './resync-button';

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [tDetail, tList, tStatus, tReel, batch] = await Promise.all([
    getTranslations('batches.detail'),
    getTranslations('batches.list'),
    getTranslations('batches.status'),
    getTranslations('batches.reel'),
    getBatchDetail(id),
  ]);

  if (!batch) notFound();

  const warningCount = batch.reels.filter((r) => r.parser_warning).length;

  return (
    <div className="space-y-6 max-w-6xl">
      <Link
        href="/batches"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {tDetail('back')}
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            <span className="font-mono">{batch.page_code_prefix}</span> · {batch.page_name}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {batch.label}
          </h1>
          <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
            <span>{tStatus(batch.status)}</span>
            <span>·</span>
            <span>
              {batch.source_doc_synced_at
                ? `${tDetail('lastSynced')} ${new Date(batch.source_doc_synced_at).toLocaleString('it-IT')}`
                : tDetail('neverSynced')}
            </span>
            {batch.source_doc_url ? (
              <>
                <span>·</span>
                <a
                  href={batch.source_doc_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                >
                  <ExternalLink className="size-3" aria-hidden />
                  {tDetail('openInDrive')}
                </a>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ResyncButton batchId={batch.id} />
        </div>
      </div>

      {warningCount > 0 ? (
        <div className="rounded-md border border-amber-300/70 bg-amber-50 dark:border-amber-700/50 dark:bg-amber-950/30 px-4 py-3 text-sm flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>
            {tDetail('warningParserHeader')}: {warningCount}/{batch.reels.length}
          </span>
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium tracking-tight">
            {tDetail('reels')}
          </h2>
          <span className="text-sm text-muted-foreground">
            {batch.reels.length} {tList('columnReels').toLowerCase()}
          </span>
        </div>

        {batch.reels.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            {tDetail('noReels')}
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 font-medium w-32">Codice</th>
                  <th className="px-4 py-2 font-medium">Titolo</th>
                  <th className="px-4 py-2 font-medium">Formato</th>
                  <th className="px-4 py-2 font-medium">Fase</th>
                </tr>
              </thead>
              <tbody>
                {batch.reels.map((reel) => (
                  <tr
                    key={reel.id}
                    className="border-b last:border-0 hover:bg-accent/30 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link href={`/reels/${reel.id}`} className="block">
                        {reel.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/reels/${reel.id}`} className="block">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{reel.title}</span>
                          {reel.parser_warning ? (
                            <AlertTriangle
                              className="size-3.5 text-amber-600"
                              aria-label={reel.parser_warning}
                            />
                          ) : null}
                        </div>
                        {reel.hook ? (
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                            {reel.hook}
                          </p>
                        ) : null}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <Link href={`/reels/${reel.id}`} className="block">
                        {tReel(`format.${reel.format}` as 'format.porcino_mono')}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <Link href={`/reels/${reel.id}`} className="block">
                        {tReel(`phase.${reel.phase}` as 'phase.research_prescript')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
