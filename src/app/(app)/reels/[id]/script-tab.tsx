'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateReelScript } from '@/lib/reels/actions';
import type { ReelDetail } from '@/lib/reels/queries';

type Props = { reel: ReelDetail };

const FORMATS = [
  'porcino_mono',
  'papaya_mono',
  'botta_e_risposta',
  'duo',
  'other',
] as const;
const CATEGORIES = ['safe', 'adapted', 'test'] as const;

export function ScriptTab({ reel }: Props) {
  const t = useTranslations('reels.script');
  const tFmt = useTranslations('batches.reel.format');
  const tCat = useTranslations('batches.reel.category');
  const tCommon = useTranslations('common');
  const tDetail = useTranslations('reels.detail');
  const [pending, startTransition] = useTransition();

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await updateReelScript(reel.id, formData);
      if (result.ok) toast.success(t('saved'));
      else toast.error(tCommon('error'));
    });
  };

  return (
    <form action={onSubmit} className="space-y-5 max-w-3xl">
      {reel.parser_warning ? (
        <div className="rounded-md border border-amber-300/70 bg-amber-50 dark:border-amber-700/50 dark:bg-amber-950/30 px-4 py-3 text-sm flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">{tDetail('parserWarning')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {reel.parser_warning}
            </p>
            {reel.raw_content ? (
              <details className="mt-2">
                <summary className="text-xs cursor-pointer">
                  {t('rawContent')}
                </summary>
                <pre className="text-xs whitespace-pre-wrap font-mono mt-2 p-3 bg-background/50 rounded">
                  {reel.raw_content}
                </pre>
              </details>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-3 space-y-1.5">
          <Label htmlFor="title">{t('title')}</Label>
          <Input
            id="title"
            name="title"
            required
            defaultValue={reel.title}
            maxLength={200}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="format">{t('format')}</Label>
          <Select id="format" name="format" defaultValue={reel.format}>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {tFmt(f as 'porcino_mono')}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category">{t('category')}</Label>
          <Select id="category" name="category" defaultValue={reel.category}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {tCat(c as 'safe')}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <ScriptBlock
        label={t('hook')}
        name="hook"
        defaultValue={reel.hook ?? ''}
        rows={3}
      />
      <ScriptBlock
        label={t('corpo')}
        name="corpo"
        defaultValue={reel.corpo ?? ''}
        rows={10}
      />
      <ScriptBlock
        label={t('chiusura')}
        name="chiusura"
        defaultValue={reel.chiusura ?? ''}
        rows={3}
      />
      <ScriptBlock
        label={t('cta')}
        name="cta"
        defaultValue={reel.cta ?? ''}
        rows={3}
      />
      <ScriptBlock
        label={t('notes')}
        name="notes"
        defaultValue={reel.notes ?? ''}
        rows={3}
      />

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}

function ScriptBlock({
  label,
  name,
  defaultValue,
  rows,
}: {
  label: string;
  name: string;
  defaultValue: string;
  rows: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="flex w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
      />
    </div>
  );
}

function Select({
  id,
  name,
  defaultValue,
  children,
}: {
  id: string;
  name: string;
  defaultValue: string;
  children: React.ReactNode;
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      className="flex h-9 w-full rounded-md border bg-background px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {children}
    </select>
  );
}
