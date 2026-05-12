'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { toggleDodItem } from '@/lib/dod/actions';
import type { DodItem } from '@/lib/dod/queries';
import type { DodItemKey } from '@/lib/dod/constants';

type Props = {
  reelId: string;
  items: DodItem[];
  editable: boolean;
};

export function DoDChecklist({ reelId, items, editable }: Props) {
  const t = useTranslations('dod');
  const allDone = items.every((i) => i.checked);

  return (
    <section className="rounded-lg border p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{t('title')}</h3>
          <p className="text-xs text-muted-foreground">{t('description')}</p>
        </div>
        <span
          className={`text-xs font-medium ${allDone ? 'text-green-700' : 'text-amber-600'}`}
        >
          {allDone ? t('allDone') : t('progress', {
            done: items.filter((i) => i.checked).length,
            total: items.length,
          })}
        </span>
      </div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <DoDRow
            key={item.key}
            reelId={reelId}
            item={item}
            editable={editable}
          />
        ))}
      </ul>
      {!editable ? (
        <p className="text-xs text-muted-foreground">{t('readOnlyHint')}</p>
      ) : null}
    </section>
  );
}

function DoDRow({
  reelId,
  item,
  editable,
}: {
  reelId: string;
  item: DodItem;
  editable: boolean;
}) {
  const t = useTranslations('dod');
  const tCommon = useTranslations('common');
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    if (!editable) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('reel_id', reelId);
      fd.set('key', item.key);
      fd.set('checked', String(!item.checked));
      const result = await toggleDodItem(fd);
      if (result.ok) toast.success(item.checked ? t('unchecked') : t('checked'));
      else if (result.error === 'not_authorized') toast.error(t('notAuthorized'));
      else if (result.error === 'wrong_phase') toast.error(t('wrongPhase'));
      else toast.error(tCommon('error'));
    });
  };

  return (
    <li className="flex items-start gap-3 rounded-md border px-3 py-2">
      <button
        type="button"
        onClick={toggle}
        disabled={!editable || pending}
        aria-pressed={item.checked}
        aria-label={t(`keys.${item.key}` as 'keys.script_validated')}
        className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded border ${
          item.checked
            ? 'bg-green-600 border-green-600 text-white'
            : 'bg-background'
        } ${editable ? 'cursor-pointer hover:border-foreground' : 'cursor-default opacity-80'}`}
      >
        {item.checked ? <Check className="size-3" aria-hidden /> : null}
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">
          {t(`keys.${item.key}` as 'keys.script_validated')}
        </div>
        {item.checked && item.checked_at ? (
          <div className="text-xs text-muted-foreground">
            {item.checked_by_label ? <span>{item.checked_by_label} · </span> : null}
            {new Date(item.checked_at).toLocaleString('it-IT', {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function DoDBlocker({ items }: { items: DodItem[] }) {
  const t = useTranslations('dod');
  const missing = items.filter((i) => !i.checked);
  if (missing.length === 0) return null;
  return (
    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
      {t('blockerHint', { count: missing.length })}
    </p>
  );
}

export type { DodItemKey };
