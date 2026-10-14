import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPage } from '@/lib/pages/queries';
import { updatePage, type PageActionResult } from '@/lib/pages/actions';
import { getRaciConfigForPage } from '@/lib/raci/queries';
import { listProfiles } from '@/lib/profiles/queries';
import { getBible } from '@/lib/bible/queries';
import { bibleCompleteness } from '@/lib/bible/schema';
import { countIdeas } from '@/lib/ideas/queries';
import { getPageProduction, getPageSla, listApprovalGroups } from '@/lib/pages/production';
import { listAssignableProfiles } from '@/lib/tasks/queries';
import { PageForm } from '../new/page-form';
import { RaciEditor } from './raci-editor';
import { ProductionSettings } from './production-settings';
import { requireInternal } from '@/lib/auth/viewer';

export default async function PageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireInternal();
  const { id } = await params;
  const [t, tBible, tIdeas, ideaCounts, page, raci, profiles, { bible }, production, sla, groups, candidates] = await Promise.all([
    getTranslations('pages'),
    getTranslations('bible'),
    getTranslations('ideas'),
    countIdeas(id),
    getPage(id),
    getRaciConfigForPage(id),
    listProfiles(),
    getBible(id),
    getPageProduction(id),
    getPageSla(id),
    listApprovalGroups(),
    listAssignableProfiles(),
  ]);

  if (!page || !production) notFound();
  const bibleGaps = bibleCompleteness(bible).missing;

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
            {t('detail.section.production')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ProductionSettings
            pageId={id}
            initial={production}
            candidates={candidates}
            sla={sla}
            groups={groups}
            editable={viewer.isAdmin}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {t('detail.section.bible')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {bibleGaps.length === 0
              ? tBible('complete')
              : tBible('incomplete', { missing: bibleGaps.map((m) => tBible(`gaps.${m}`)).join(', ') })}
          </p>
          <Link
            href={`/pages/${id}/bibbia`}
            className="text-sm font-medium underline underline-offset-4 hover:text-foreground"
          >
            {tBible('open')}
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">{t('detail.section.ideas')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {tIdeas('summary', { backlog: ideaCounts.backlog, chosen: ideaCounts.scelta })}
          </p>
          <Link
            href={`/pages/${id}/idee`}
            className="text-sm font-medium underline underline-offset-4 hover:text-foreground"
          >
            {tIdeas('open')}
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {t('detail.section.raci')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RaciEditor pageId={id} profiles={profiles} initial={raci} />
        </CardContent>
      </Card>
    </div>
  );
}
