import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { listPages } from '@/lib/pages/queries';
import { BatchForm } from './batch-form';

export default async function NewBatchPage() {
  const t = await getTranslations('batches');
  const pages = (await listPages()).filter((p) => p.active);

  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        href="/batches"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t('detail.back')}
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight">
        {t('form.title')}
      </h1>

      <BatchForm
        pages={pages.map((p) => ({
          id: p.id,
          name: p.name,
          code_prefix: p.code_prefix,
        }))}
      />
    </div>
  );
}
