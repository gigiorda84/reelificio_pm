'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Copy, Link as LinkIcon, Mail, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createInvite, revokeInvite } from '@/lib/invites/actions';
import { buildInviteUrlClient } from './invite-url-client';
import type { InviteRow } from '@/lib/invites/queries';

type Props = {
  reelId: string;
  invites: InviteRow[];
};

export function InvitePanel({ reelId, invites }: Props) {
  const t = useTranslations('invites');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  const submit = (formData: FormData) => {
    formData.set('reel_id', reelId);
    startTransition(async () => {
      const result = await createInvite(formData);
      if (result.ok) {
        toast.success(t('created'));
        if (result.url) setLastUrl(result.url);
        setOpen(false);
      } else if (result.error === 'not_authorized') {
        toast.error(t('notAuthorized'));
      } else if (result.error === 'invalid_input') {
        toast.error(t('invalidInput'));
      } else {
        toast.error(tCommon('error'));
      }
    });
  };

  return (
    <section className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{t('title')}</h3>
          <p className="text-xs text-muted-foreground">{t('description')}</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <UserPlus className="size-3" aria-hidden /> {t('invite')}
        </Button>
      </div>

      {lastUrl ? <InviteUrlBanner url={lastUrl} onDismiss={() => setLastUrl(null)} /> : null}

      {invites.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {invites.map((inv) => (
            <InviteListItem key={inv.id} invite={inv} />
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form action={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t('dialogTitle')}</DialogTitle>
              <DialogDescription>{t('dialogDescription')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="external_label">{t('labelField')}</Label>
                <Input
                  id="external_label"
                  name="external_label"
                  required
                  maxLength={120}
                  placeholder={t('labelPlaceholder')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invitee_email">{t('emailField')}</Label>
                <Input
                  id="invitee_email"
                  name="invitee_email"
                  type="email"
                  maxLength={200}
                  placeholder="nome@esempio.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="expires_in_days">{t('expiresField')}</Label>
                <Input
                  id="expires_in_days"
                  name="expires_in_days"
                  type="number"
                  min={1}
                  max={60}
                  defaultValue={14}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">{t('notesField')}</Label>
                <Textarea id="notes" name="notes" rows={2} maxLength={1000} />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? tCommon('saving') : t('create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function InviteListItem({ invite }: { invite: InviteRow }) {
  const t = useTranslations('invites');
  const tCommon = useTranslations('common');
  const [pending, startTransition] = useTransition();
  const [now] = useState(() => Date.now());
  const url = buildInviteUrlClient(invite.token);

  const expired = new Date(invite.expires_at).getTime() < now;
  const revoked = !!invite.revoked_at;
  const active = !expired && !revoked;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('copied'));
    } catch {
      toast.error(tCommon('error'));
    }
  };

  const onRevoke = () => {
    if (!confirm(t('revokeConfirm'))) return;
    startTransition(async () => {
      const result = await revokeInvite(invite.id);
      if (result.ok) toast.success(t('revoked'));
      else toast.error(tCommon('error'));
    });
  };

  return (
    <li className="flex items-center gap-3 text-xs border rounded-md px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">
          {invite.external_label ?? t('unnamed')}
        </div>
        <div className="text-muted-foreground flex items-center gap-2 flex-wrap">
          {invite.invitee_email ? (
            <span className="inline-flex items-center gap-1">
              <Mail className="size-3" aria-hidden /> {invite.invitee_email}
            </span>
          ) : null}
          <span>
            {t('expires')}:{' '}
            {new Date(invite.expires_at).toLocaleDateString('it-IT')}
          </span>
          {revoked ? <span className="text-red-600">{t('statusRevoked')}</span> : null}
          {expired && !revoked ? (
            <span className="text-amber-600">{t('statusExpired')}</span>
          ) : null}
          {active ? (
            <span className="text-green-700">{t('statusActive')}</span>
          ) : null}
          {invite.used_at ? (
            <span>· {t('used')} {new Date(invite.used_at).toLocaleDateString('it-IT')}</span>
          ) : null}
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        type="button"
        onClick={copy}
        disabled={!active}
        title={url}
      >
        <Copy className="size-3" aria-hidden /> {t('copyLink')}
      </Button>
      {active ? (
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={onRevoke}
          disabled={pending}
        >
          <X className="size-3" aria-hidden /> {t('revoke')}
        </Button>
      ) : null}
    </li>
  );
}

function InviteUrlBanner({ url, onDismiss }: { url: string; onDismiss: () => void }) {
  const t = useTranslations('invites');
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    toast.success(t('copied'));
  };
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2 flex items-center gap-3">
      <LinkIcon className="size-4 text-muted-foreground" aria-hidden />
      <code className="text-xs truncate flex-1">{url}</code>
      <Button size="sm" variant="outline" onClick={copy}>
        <Copy className="size-3" aria-hidden /> {t('copyLink')}
      </Button>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        <X className="size-3" aria-hidden />
      </Button>
    </div>
  );
}
