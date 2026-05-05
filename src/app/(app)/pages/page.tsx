import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Plus } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { listPages } from '@/lib/pages/queries';

export default async function PagesListPage() {
  const t = await getTranslations('pages.list');
  const pages = await listPages();

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>
        <Link href="/pages/new" className={buttonVariants()}>
          <Plus className="size-4" aria-hidden />
          {t('new')}
        </Link>
      </div>

      {pages.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {t('empty')}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">{t('columnName')}</th>
                <th className="px-4 py-2 font-medium">{t('columnPrefix')}</th>
                <th className="px-4 py-2 font-medium">{t('columnBuffer')}</th>
                <th className="px-4 py-2 font-medium">{t('columnStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr key={page.id} className="border-b last:border-0 hover:bg-accent/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/pages/${page.id}`}
                      className="font-medium hover:underline"
                    >
                      {page.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{page.slug}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{page.code_prefix}</td>
                  <td className="px-4 py-3">{page.buffer_threshold}</td>
                  <td className="px-4 py-3">
                    {page.active ? t('active') : t('inactive')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
