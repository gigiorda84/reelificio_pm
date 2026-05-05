'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sendMagicLink } from './actions';

export function LoginForm() {
  const t = useTranslations('auth.login');
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await sendMagicLink(formData);
      if (result.ok) {
        setSent(true);
        toast.success(t('linkSent'));
      } else {
        toast.error(t('error'));
      }
    });
  };

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">{t('emailLabel')}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder={t('emailPlaceholder')}
          disabled={pending || sent}
        />
      </div>
      <Button type="submit" className="w-full" disabled={pending || sent}>
        {pending ? t('submitting') : t('submit')}
      </Button>
      {sent ? (
        <p className="text-sm text-muted-foreground text-center">
          {t('linkSent')}
        </p>
      ) : null}
    </form>
  );
}
