'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createBatch, type CreateBatchResult } from '@/lib/batches/actions';

type Page = { id: string; name: string; code_prefix: string };

type Props = { pages: Page[] };

export function BatchForm({ pages }: Props) {
  const t = useTranslations('batches.form');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await createBatch(formData);
      // Server action redirects on success; only error responses get here.
      if ('ok' in result && !result.ok) {
        const map: Record<Exclude<CreateBatchResult, { ok: true }>['error'], string> = {
          invalid_input: t('errors.unknown'),
          drive_invalid_url: t('errors.invalidUrl'),
          drive_not_found: t('errors.driveNotFound'),
          drive_forbidden: t('errors.driveForbidden'),
          drive_unsupported: t('errors.driveUnsupported'),
          drive_unknown: t('errors.driveUnknown'),
          no_reels: t('errors.noReels'),
          page_not_found: t('errors.unknown'),
          not_admin: t('errors.notAdmin'),
          unknown: t('errors.unknown'),
        };
        const base = map[result.error] ?? t('errors.unknown');
        const msg = result.message ? `${base} (${result.message})` : base;
        setError(msg);
        toast.error(msg);
      }
    });
  };

  if (pages.length === 0) {
    return (
      <div className="rounded-md border border-amber-300/70 bg-amber-50 dark:border-amber-700/50 dark:bg-amber-950/30 px-4 py-3 text-sm">
        {t('errors.noPages')}
      </div>
    );
  }

  return (
    <form action={onSubmit} className="space-y-5 max-w-xl">
      <div className="space-y-1.5">
        <Label htmlFor="page_id">{t('page')}</Label>
        <select
          id="page_id"
          name="page_id"
          required
          defaultValue={pages[0]?.id}
          className="flex h-9 w-full rounded-md border bg-background px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {pages.map((page) => (
            <option key={page.id} value={page.id}>
              {page.code_prefix} — {page.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="source_doc_url">{t('sourceDocUrl')}</Label>
        <Input
          id="source_doc_url"
          name="source_doc_url"
          type="url"
          required
          placeholder="https://docs.google.com/document/d/…"
        />
        <p className="text-xs text-muted-foreground">{t('sourceDocUrlHelp')}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="label_override">{t('label')}</Label>
        <Input
          id="label_override"
          name="label_override"
          placeholder="Batch Maggio 2026"
          maxLength={120}
        />
        <p className="text-xs text-muted-foreground">{t('labelHelp')}</p>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? t('submitting') : t('submit')}
      </Button>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
