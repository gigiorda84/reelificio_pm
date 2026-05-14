'use client';

import { useTransition, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { submitDailyUpdate } from '@/lib/daily-updates/actions';

type Props = {
  initial: {
    did_today: string;
    blockers: string;
    tomorrow: string;
  };
  alreadySubmitted: boolean;
};

export function DailyUpdateForm({ initial, alreadySubmitted }: Props) {
  const t = useTranslations('dailyUpdates');
  const tCommon = useTranslations('common');
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(!alreadySubmitted);

  if (alreadySubmitted && !editing) {
    return (
      <div className="space-y-3">
        <div className="space-y-2 text-sm">
          <Block label={t('didToday')} value={initial.did_today} />
          {initial.blockers ? (
            <Block label={t('blockers')} value={initial.blockers} />
          ) : null}
          {initial.tomorrow ? (
            <Block label={t('tomorrow')} value={initial.tomorrow} />
          ) : null}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-emerald-700 dark:text-emerald-300">
            {t('submitted')}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
          >
            {tCommon('edit')}
          </Button>
        </div>
      </div>
    );
  }

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await submitDailyUpdate(formData);
      if (result.ok) {
        toast.success(t('saved'));
        setEditing(false);
      } else {
        toast.error(tCommon('error'));
      }
    });
  };

  return (
    <form action={onSubmit} className="space-y-3">
      <Field label={t('didToday')} required>
        <textarea
          name="did_today"
          rows={2}
          defaultValue={initial.did_today}
          placeholder={t('didTodayPlaceholder')}
          className={textareaCls}
          required
        />
      </Field>
      <Field label={t('blockers')}>
        <textarea
          name="blockers"
          rows={2}
          defaultValue={initial.blockers}
          placeholder={t('blockersPlaceholder')}
          className={textareaCls}
        />
      </Field>
      <Field label={t('tomorrow')}>
        <textarea
          name="tomorrow"
          rows={2}
          defaultValue={initial.tomorrow}
          placeholder={t('tomorrowPlaceholder')}
          className={textareaCls}
        />
      </Field>
      <div className="flex justify-end gap-2">
        {alreadySubmitted ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(false)}
            disabled={pending}
          >
            {tCommon('cancel')}
          </Button>
        ) : null}
        <Button type="submit" disabled={pending} size="sm">
          {pending ? tCommon('saving') : t('submit')}
        </Button>
      </div>
    </form>
  );
}

const textareaCls =
  'w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y min-h-[2.25rem]';

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs uppercase tracking-wider text-muted-foreground block">
        {label}
        {required ? <span aria-hidden> *</span> : null}
      </label>
      {children}
    </div>
  );
}

function Block({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="whitespace-pre-wrap">{value}</div>
    </div>
  );
}
