import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { requireInternal } from '@/lib/auth/viewer';
import { getPage } from '@/lib/pages/queries';
import { canEditBible } from '@/lib/bible/queries';
import { listIdeas, listIdeasBatches } from '@/lib/ideas/queries';
import { IdeasBacklog } from './ideas-backlog';

// The ideas backlog of a page (docs/fase2-plan.md S3, AC5–AC6): every
// internal reads it; admins and the RACI Responsible of the writing add,
// edit, discard and turn ideas into a batch (the same rule as the bible).
export default async function IdeasPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireInternal();
  const { id } = await params;
  const [t, page, ideas, batches, editable] = await Promise.all([
    getTranslations('ideas'),
    getPage(id),
    listIdeas(id),
    listIdeasBatches(id),
    canEditBible(id, viewer),
  ]);
  if (!page) notFound();

  return (
    <div className="space-y-6 max-w-4xl">
      <Link
        href={`/pages/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {page.name}
      </Link>
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{page.code_prefix}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{editable ? t('intro') : t('readOnly')}</p>
      </div>
      <IdeasBacklog pageId={id} ideas={ideas} batches={batches} editable={editable} />
    </div>
  );
}
