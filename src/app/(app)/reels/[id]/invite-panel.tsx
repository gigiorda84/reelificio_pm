'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Copy, Mail, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { revokeInvite } from '@/lib/invites/actions';
import { buildInviteUrlClient } from './invite-url-client';
import type { InviteRow } from '@/lib/invites/queries';
import { formatRome } from '@/lib/dates';

const DATE_ONLY = { year: 'numeric', month: 'numeric', day: 'numeric' } as const;

type Props = {
  invites: InviteRow[];
};

// Invites created before Fase 1: listed with "Revoca" only. Collaborators
// get accounts now, so no new invite is created here.
export function InvitePanel({ invites }: Props) {
  const t = useTranslations('invites');
  if (invites.length === 0) return null;

  return (
    <section className="rounded-lg border p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium">{t('title')}</h3>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </div>
      <ul className="space-y-1.5">
        {invites.map((inv) => (
          <InviteListItem key={inv.id} invite={inv} />
        ))}
      </ul>
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
            {formatRome(invite.expires_at, DATE_ONLY)}
          </span>
          {revoked ? <span className="text-red-600">{t('statusRevoked')}</span> : null}
          {expired && !revoked ? (
            <span className="text-amber-600">{t('statusExpired')}</span>
          ) : null}
          {active ? (
            <span className="text-green-700">{t('statusActive')}</span>
          ) : null}
          {invite.used_at ? (
            <span>· {t('used')} {formatRome(invite.used_at, DATE_ONLY)}</span>
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
