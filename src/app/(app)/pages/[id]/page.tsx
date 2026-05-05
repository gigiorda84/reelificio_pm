import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPage } from '@/lib/pages/queries';
import { updatePage, type PageActionResult } from '@/lib/pages/actions';
import { PageForm } from '../new/page-form';

export default async function PageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [t, page] = await Promise.all([
    getTranslations('pages'),
    getPage(id),
  ]);

  if (!page) notFound();

  // Bind id into the action so the form can call it without re-passing.
  const updateAction = async (formData: FormData): Promise<PageActionResult> => {
    'use server';
    return updatePage(id, formData);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <Link
        href="/pages"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t('detail.back')}
      </Link>

      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {page.code_prefix}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{page.name}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {t('detail.section.general')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PageForm
            mode="edit"
            action={updateAction}
            initial={{
              name: page.name,
              slug: page.slug,
              code_prefix: page.code_prefix,
              description: page.description,
              buffer_threshold: page.buffer_threshold,
              active: page.active,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {t('detail.section.voiceBrief')}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t('detail.section.comingSoon')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {t('detail.section.raci')}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t('detail.section.comingSoon')}
        </CardContent>
      </Card>
    </div>
  );
}
