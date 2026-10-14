import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { requireInternal } from '@/lib/auth/viewer';
import { getPage } from '@/lib/pages/queries';
import { canEditBible, getBible, listApprovedScripts, listProfileFirstNames } from '@/lib/bible/queries';
import { EMPTY_VOICE } from '@/lib/bible/schema';
import { BibleEditor } from './bible-editor';

// The page bible (docs/fase2-plan.md S2): creative fields and Voce section on
// one screen. Every internal reads it; admins and the RACI Responsible of
// script_writing edit it.
export default async function BiblePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireInternal();
  const { id } = await params;
  const [t, page, { bible, voice }, editable, approved, firstNames] = await Promise.all([
    getTranslations('bible'),
    getPage(id),
    getBible(id),
    canEditBible(id, viewer),
    listApprovedScripts(id),
    listProfileFirstNames(),
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
      <BibleEditor
        pageId={id}
        initialBible={bible}
        initialVoice={voice ?? EMPTY_VOICE}
        editable={editable}
        approved={approved}
        firstNames={firstNames}
      />
    </div>
  );
}
