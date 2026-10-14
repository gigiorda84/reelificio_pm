'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { formatRome } from '@/lib/dates';
import { restoreScriptVersion } from '@/lib/script-lab/actions';
import { BLOCKS } from '@/lib/script-lab/mix';
import type { ScriptVersion } from '@/lib/script-lab/versions';

// Every version the script went through (docs/fase2-plan.md AC17): source,
// model, author, date. Any older one can be restored in bozza by whoever may
// compose the script (the SQL checks it again).
type Props = {
  reelId: string;
  versions: ScriptVersion[];
  scriptRev: number;
  canRestore: boolean;
};

export function VersionHistory({ reelId, versions, scriptRev, canRestore }: Props) {
  const t = useTranslations('scriptLab.history');
  const tSource = useTranslations('scriptLab.sources');
  const tBlock = useTranslations('reels.script');
  const tErr = useTranslations('scriptLab.errors');
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);

  if (versions.length === 0) return null;

  const restore = (id: string) => {
    startTransition(async () => {
      const result = await restoreScriptVersion(reelId, id, scriptRev);
      if (result.ok) toast.success(t('restored'));
      else toast.error(tErr(result.error));
    });
  };

  return (
    <section className="space-y-3">
      <h2 className="text-base font-medium">{t('title')}</h2>
      <ul className="divide-y rounded-lg border">
        {versions.map((v) => {
          const isCurrent = v.script_rev === scriptRev;
          return (
            <li key={v.id} className="space-y-2 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="rounded-full border px-2 py-0.5 text-xs">{tSource(v.source)}</span>
                  {v.model ? <span className="text-xs text-muted-foreground">{v.model}</span> : null}
                  <span className="text-xs text-muted-foreground">
                    {formatRome(v.created_at)}
                    {v.author_name ? ` · ${v.author_name}` : ''}
                  </span>
                  {isCurrent ? <span className="text-xs font-medium">{t('current')}</span> : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(open === v.id ? null : v.id)}>
                    {open === v.id ? t('hide') : t('show')}
                  </Button>
                  {canRestore && !isCurrent ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => restore(v.id)} disabled={pending}>
                      {t('restore')}
                    </Button>
                  ) : null}
                </div>
              </div>
              {open === v.id ? (
                <div className="space-y-2 rounded-md bg-muted/40 p-3">
                  {BLOCKS.map((block) => (
                    <div key={block}>
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">{tBlock(block)}</p>
                      <p className="whitespace-pre-wrap text-sm">{v[block] ?? '—'}</p>
                    </div>
                  ))}
                  {v.notes ? (
                    <div>
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">{tBlock('notes')}</p>
                      <p className="whitespace-pre-wrap text-sm">{v.notes}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
