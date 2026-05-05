'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PageActionResult } from '@/lib/pages/actions';

type Props = {
  mode: 'create' | 'edit';
  initial?: {
    name: string;
    slug: string;
    code_prefix: string;
    description: string | null;
    buffer_threshold: number;
    active: boolean;
  };
  action: (formData: FormData) => Promise<PageActionResult>;
};

export function PageForm({ mode, initial, action }: Props) {
  const t = useTranslations('pages.form');
  const tCommon = useTranslations('common');
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const onSubmit = (formData: FormData) => {
    setFieldErrors({});
    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        if (mode === 'edit') toast.success(tCommon('saved'));
        // create-mode redirects via Server Action; nothing to do.
      } else {
        if (result.error === 'invalid_input' && result.fieldErrors) {
          setFieldErrors(result.fieldErrors);
        } else if (result.error === 'slug_taken') {
          setFieldErrors({ slug: t('errors.slugTaken') });
        } else if (result.error === 'code_prefix_taken') {
          setFieldErrors({ code_prefix: t('errors.codePrefixTaken') });
        } else if (result.error === 'not_admin') {
          toast.error(t('errors.notAdmin'));
        } else {
          toast.error(t('errors.unknown'));
        }
      }
    });
  };

  return (
    <form action={onSubmit} className="space-y-5 max-w-xl">
      <Field
        id="name"
        label={t('name')}
        help={t('nameHelp')}
        error={fieldErrors.name}
      >
        <Input
          id="name"
          name="name"
          required
          placeholder={t('namePlaceholder')}
          defaultValue={initial?.name}
          maxLength={120}
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field
          id="slug"
          label={t('slug')}
          help={t('slugHelp')}
          error={fieldErrors.slug ?? (fieldErrors.slug ? t('errors.slugFormat') : undefined)}
        >
          <Input
            id="slug"
            name="slug"
            required
            placeholder={t('slugPlaceholder')}
            defaultValue={initial?.slug}
            pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
            maxLength={60}
          />
        </Field>

        <Field
          id="code_prefix"
          label={t('codePrefix')}
          help={t('codePrefixHelp')}
          error={fieldErrors.code_prefix ?? (fieldErrors.code_prefix ? t('errors.codePrefixFormat') : undefined)}
        >
          <Input
            id="code_prefix"
            name="code_prefix"
            required
            placeholder={t('codePrefixPlaceholder')}
            defaultValue={initial?.code_prefix}
            pattern="^[A-Za-z]{2}$"
            maxLength={2}
            className="uppercase font-mono"
          />
        </Field>
      </div>

      <Field
        id="buffer_threshold"
        label={t('bufferThreshold')}
        help={t('bufferThresholdHelp')}
        error={fieldErrors.buffer_threshold}
      >
        <Input
          id="buffer_threshold"
          name="buffer_threshold"
          type="number"
          min={0}
          max={50}
          required
          defaultValue={initial?.buffer_threshold ?? 3}
          className="max-w-[8rem]"
        />
      </Field>

      <Field
        id="description"
        label={t('description')}
        error={fieldErrors.description}
      >
        <textarea
          id="description"
          name="description"
          placeholder={t('descriptionPlaceholder')}
          defaultValue={initial?.description ?? ''}
          rows={3}
          maxLength={500}
          className="flex w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </Field>

      <div className="flex items-center gap-2">
        <input
          id="active"
          name="active"
          type="checkbox"
          defaultChecked={initial?.active ?? true}
          className="size-4 rounded border-input"
        />
        <Label htmlFor="active" className="font-normal">{t('active')}</Label>
      </div>

      <div className="pt-2">
        <Button type="submit" disabled={pending}>
          {pending
            ? tCommon('saving')
            : mode === 'create'
              ? t('submitNew')
              : t('submitEdit')}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : help ? (
        <p className="text-xs text-muted-foreground">{help}</p>
      ) : null}
    </div>
  );
}
