import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { createPage } from '@/lib/pages/actions';
import { PageForm } from './page-form';

export default async function NewPagePage() {
  const t = await getTranslations('pages');

  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        href="/pages"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t('detail.back')}
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight">
        {t('form.newTitle')}
      </h1>

      <PageForm mode="create" action={createPage} />
    </div>
  );
}
