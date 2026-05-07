'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { updateOwnProfile } from '@/lib/profiles/actions';

type Props = {
  initial: {
    full_name: string;
    email: string;
    daily_reminder_at: string;
  };
};

export function ProfileForm({ initial }: Props) {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const [pending, startTransition] = useTransition();

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await updateOwnProfile(formData);
      if (result.ok) toast.success(tCommon('saved'));
      else toast.error(result.message ?? tCommon('error'));
    });
  };

  return (
    <form action={onSubmit} className="space-y-4 max-w-xl">
      <Field label={t('profile.fullName')}>
        <input
          name="full_name"
          type="text"
          defaultValue={initial.full_name}
          className={inputCls}
          required
        />
      </Field>

      <Field label={t('profile.email')} hint={t('profile.emailHint')}>
        <input
          type="email"
          value={initial.email}
          disabled
          className={`${inputCls} text-muted-foreground`}
        />
      </Field>

      <Field label={t('profile.dailyReminder')} hint={t('profile.dailyReminderHint')}>
        <input
          name="daily_reminder_at"
          type="time"
          defaultValue={initial.daily_reminder_at}
          className={inputCls}
        />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? tCommon('saving') : tCommon('save')}
        </Button>
      </div>
    </form>
  );
}

const inputCls =
  'flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs uppercase tracking-wider text-muted-foreground block">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
