'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { applyScriptVersion } from '@/lib/script-lab/actions';
import { BLOCKS, composeMix, sameText, type Block, type VersionText } from '@/lib/script-lab/mix';
import type { ScriptVersion } from '@/lib/script-lab/versions';

// The AI alternatives of the reel side by side (docs/fase2-plan.md AC16):
// choose a base, take any block from another alternative, check the preview,
// apply. Only in bozza and only for admins, the Responsible of the writing
// and the holder of the writing task (the SQL checks it again).
// S6 adds "Rigenera" and the badge for a missing alternative here.
type Props = {
  reelId: string;
  alternatives: ScriptVersion[];
  current: VersionText;
  scriptRev: number;
  canCompose: boolean;
  inBozza: boolean;
};

export function Alternatives({ reelId, alternatives, current, scriptRev, canCompose, inBozza }: Props) {
  const t = useTranslations('scriptLab.alternatives');
  const tBlock = useTranslations('reels.script');
  const tErr = useTranslations('scriptLab.errors');
  const [pending, startTransition] = useTransition();
  const [chosenBase, setBaseId] = useState(alternatives[0]?.id ?? '');
  const [picks, setPicks] = useState<Partial<Record<Block, string>>>({});
  // New alternatives (S6 "Rigenera") replace the old ones: fall back to the
  // first instead of losing the preview.
  const baseId = alternatives.some((a) => a.id === chosenBase) ? chosenBase : (alternatives[0]?.id ?? '');

  const mix = useMemo(() => composeMix(baseId, picks, alternatives), [baseId, picks, alternatives]);
  if (alternatives.length === 0) return null;

  const editable = canCompose && inBozza;
  const label = (v: ScriptVersion) => v.model ?? t('unknownModel');
  const sourceOf = (block: Block) => picks[block] ?? baseId;

  const chooseBase = (id: string) => {
    setBaseId(id);
    setPicks({});
  };
  const pick = (block: Block, id: string) => setPicks({ ...picks, [block]: id === baseId ? undefined : id });

  const apply = () => {
    if (!mix) return;
    startTransition(async () => {
      const result = await applyScriptVersion(reelId, baseId, mix.overrides, scriptRev);
      if (result.ok) {
        toast.success(t('applied'));
        setPicks({});
      } else {
        toast.error(tErr(result.error));
      }
    });
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-medium">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">
          {editable ? t('hint') : inBozza ? t('readOnly') : t('onlyInBozza')}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {alternatives.map((v) => {
          const isBase = v.id === baseId;
          return (
            <div key={v.id} className={`space-y-3 rounded-lg border p-3 ${isBase ? 'border-foreground/40 bg-muted/30' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{label(v)}</span>
                {editable ? (
                  <Button type="button" size="sm" variant={isBase ? 'secondary' : 'outline'} onClick={() => chooseBase(v.id)} disabled={pending}>
                    {isBase ? (
                      <>
                        <Check className="size-3.5" aria-hidden /> {t('base')}
                      </>
                    ) : (
                      t('useAsBase')
                    )}
                  </Button>
                ) : null}
              </div>
              {BLOCKS.map((block) => {
                const taken = sourceOf(block) === v.id;
                return (
                  <div key={block} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs uppercase tracking-wider text-muted-foreground">{tBlock(block)}</span>
                      {editable && !isBase ? (
                        <button
                          type="button"
                          className={`text-xs underline-offset-4 hover:underline ${taken ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
                          onClick={() => pick(block, taken ? baseId : v.id)}
                          disabled={pending}
                          aria-pressed={taken}
                        >
                          {taken ? t('taken') : t('take')}
                        </button>
                      ) : null}
                    </div>
                    <p className={`whitespace-pre-wrap text-sm ${taken ? '' : 'text-muted-foreground'}`}>
                      {v[block] ?? '—'}
                    </p>
                  </div>
                );
              })}
              {v.notes ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">{t('directionNotes')}</summary>
                  <p className="mt-1 whitespace-pre-wrap">{v.notes}</p>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>

      {editable && mix ? (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-medium">{t('preview')}</h3>
          {BLOCKS.map((block) => (
            <div key={block} className="space-y-0.5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {tBlock(block)} · {label(alternatives.find((a) => a.id === mix.sources[block])!)}
              </p>
              <p className="whitespace-pre-wrap text-sm">{mix.blocks[block] ?? '—'}</p>
            </div>
          ))}
          <div className="flex items-center justify-end gap-3">
            {sameText(mix, current) ? <span className="text-xs text-muted-foreground">{t('sameAsCurrent')}</span> : null}
            <Button type="button" onClick={apply} disabled={pending || sameText(mix, current)}>
              {pending ? t('applying') : t('apply')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
