import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Plus } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { listBatches } from '@/lib/batches/queries';

export default async function BatchesListPage() {
  const tList = await getTranslations('batches.list');
  const tStatus = await getTranslations('batches.status');
  const batches = await listBatches();

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {tList('title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tList('subtitle')}
          </p>
        </div>
        <Link href="/batches/new" className={buttonVariants()}>
          <Plus className="size-4" aria-hidden />
          {tList('new')}
        </Link>
      </div>

      {batches.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {tList('empty')}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">{tList('columnLabel')}</th>
                <th className="px-4 py-2 font-medium">{tList('columnPage')}</th>
                <th className="px-4 py-2 font-medium text-right">
                  {tList('columnReels')}
                </th>
                <th className="px-4 py-2 font-medium">{tList('columnSynced')}</th>
                <th className="px-4 py-2 font-medium">{tList('columnStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr
                  key={batch.id}
                  className="border-b last:border-0 hover:bg-accent/30"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/batches/${batch.id}`}
                      className="font-medium hover:underline"
                    >
                      {batch.label}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-muted-foreground mr-2">
                      {batch.page_code_prefix}
                    </span>
                    {batch.page_name}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {batch.reel_count}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {batch.source_doc_synced_at
                      ? new Date(batch.source_doc_synced_at).toLocaleString('it-IT', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : '—'}
                  </td>
                  <td className="px-4 py-3">{tStatus(batch.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
