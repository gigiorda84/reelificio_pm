'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Copy, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { unlinkTelegram } from '@/lib/profiles/actions';

type Props = {
  linked: boolean;
  linkToken: string;
  botUsername: string;
};

export function TelegramLink({ linked, linkToken, botUsername }: Props) {
  const t = useTranslations('settings.telegram');
  const tCommon = useTranslations('common');
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const command = `/link ${linkToken}`;
  const botUrl = botUsername
    ? `https://t.me/${botUsername.replace(/^@/, '')}?start=${linkToken}`
    : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(tCommon('error'));
    }
  };

  const onUnlink = () => {
    if (!confirm(t('unlinkConfirm'))) return;
    startTransition(async () => {
      const result = await unlinkTelegram();
      if (result.ok) toast.success(t('unlinked'));
      else toast.error(result.message ?? tCommon('error'));
    });
  };

  if (linked) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Check className="size-4 text-green-600" aria-hidden />
          <span>{t('linkedDescription')}</span>
        </div>
        <Button variant="outline" size="sm" onClick={onUnlink} disabled={pending}>
          <Unlink className="size-3.5 mr-1.5" aria-hidden />
          {t('unlink')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      <ol className="text-sm space-y-2 list-decimal list-inside">
        <li>
          {botUrl ? (
            <>
              {t('step1Bot')}{' '}
              <a
                href={botUrl}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                @{botUsername.replace(/^@/, '')}
              </a>
              .
            </>
          ) : (
            t('step1NoBot')
          )}
        </li>
        <li>
          {t('step2')}
          <div className="mt-1.5 flex items-center gap-2">
            <code className="flex-1 rounded-md border bg-muted px-3 py-1.5 text-xs font-mono break-all">
              {command}
            </code>
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? (
                <Check className="size-3.5 mr-1.5" aria-hidden />
              ) : (
                <Copy className="size-3.5 mr-1.5" aria-hidden />
              )}
              {copied ? t('copied') : t('copy')}
            </Button>
          </div>
        </li>
        <li>{t('step3')}</li>
      </ol>
    </div>
  );
}
