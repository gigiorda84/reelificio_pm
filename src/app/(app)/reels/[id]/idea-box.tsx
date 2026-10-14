import { getTranslations } from 'next-intl/server';
import { Lightbulb } from 'lucide-react';
import type { Idea } from '@/lib/ideas/queries';

// The idea the reel was born from (docs/fase2-plan.md S3), for internals:
// the brief the writer works from. Doc ideas carry only the title.
export async function IdeaBox({ idea }: { idea: Idea }) {
  const t = await getTranslations('ideas');
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-4 py-3 text-sm">
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {t('fromIdea')} · {t(`source.${idea.source}`)}
        </p>
        <p className="font-medium">{idea.title}</p>
        {idea.spunto ? <p className="whitespace-pre-wrap text-muted-foreground">{idea.spunto}</p> : null}
      </div>
    </div>
  );
}
