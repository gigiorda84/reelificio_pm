'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Copy, Unlink } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { createTelegramLinkToken, unlinkTelegram } from '@/lib/profiles/actions';

type Props = {
  linked: boolean;
  botUsername: string;
};

// Linking: a one-time token (15 minutes) generated on request, opened with
// the bot's deep link or sent as /link <token>.
export function TelegramLink({ linked, botUsername }: Props) {
  const t = useTranslations('settings.telegram');
  const tCommon = useTranslations('common');
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<{ token: string; expiresAt: string } | null>(null);

  const bot = botUsername.replace(/^@/, '');
  const command = link ? `/link ${link.token}` : '';
  const botUrl = link && bot ? `https://t.me/${bot}?start=${link.token}` : null;

  const generate = () => {
    startTransition(async () => {
      const result = await createTelegramLinkToken();
      if (result.ok) setLink({ token: result.token, expiresAt: result.expiresAt });
      else toast.error(result.message ?? tCommon('error'));
    });
  };

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

  if (!link) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        <Button onClick={generate} disabled={pending}>
          {t('generate')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t('expires', { time: new Date(link.expiresAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) })}
      </p>
      {botUrl ? (
        <a href={botUrl} target="_blank" rel="noreferrer" className={buttonVariants()}>
          {t('openBot', { bot })}
        </a>
      ) : (
        <p className="text-sm">{t('step1NoBot')}</p>
      )}
      <div className="space-y-1.5 text-sm">
        <p className="text-muted-foreground">{t('orSend')}</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-md border bg-muted px-3 py-1.5 text-xs font-mono break-all">{command}</code>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check className="size-3.5 mr-1.5" aria-hidden /> : <Copy className="size-3.5 mr-1.5" aria-hidden />}
            {copied ? t('copied') : t('copy')}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('step3')}</p>
    </div>
  );
}
