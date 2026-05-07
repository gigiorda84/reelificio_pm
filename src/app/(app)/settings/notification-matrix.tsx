'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { saveOwnPrefMatrix } from '@/lib/notifications/prefs-actions';
import {
  NOTIFICATION_EVENTS,
  type NotificationChannel,
  type NotificationEvent,
} from '@/lib/notifications/types';
import type { PrefMatrix } from '@/lib/notifications/prefs';

const EDITABLE_CHANNELS: NotificationChannel[] = ['email', 'telegram'];

type Props = {
  initial: PrefMatrix;
  telegramLinked: boolean;
};

export function NotificationMatrix({ initial, telegramLinked }: Props) {
  const t = useTranslations('settings.matrix');
  const tEvent = useTranslations('settings.events');
  const tChannel = useTranslations('settings.channels');
  const tCommon = useTranslations('common');
  const [matrix, setMatrix] = useState<PrefMatrix>(structuredClone(initial));
  const [pending, startTransition] = useTransition();

  const toggle = (event: NotificationEvent, channel: NotificationChannel) => {
    setMatrix((prev) => ({
      ...prev,
      [event]: { ...prev[event], [channel]: !prev[event][channel] },
    }));
  };

  const save = () => {
    startTransition(async () => {
      const result = await saveOwnPrefMatrix(matrix);
      if (result.ok) toast.success(tCommon('saved'));
      else toast.error(result.message ?? tCommon('error'));
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('description')}</p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-medium">{t('columnEvent')}</th>
              <th className="px-3 py-2 font-medium">{tChannel('in_app')}</th>
              {EDITABLE_CHANNELS.map((c) => (
                <th key={c} className="px-3 py-2 font-medium">
                  {tChannel(c)}
                  {c === 'telegram' && !telegramLinked ? (
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      ({t('telegramNotLinked')})
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_EVENTS.map((event) => (
              <tr key={event} className="border-t">
                <td className="px-3 py-2 font-medium whitespace-nowrap">
                  {tEvent(event)}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {t('alwaysOn')}
                </td>
                {EDITABLE_CHANNELS.map((channel) => {
                  const disabled = channel === 'telegram' && !telegramLinked;
                  return (
                    <td key={channel} className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={!!matrix[event][channel]}
                        disabled={disabled}
                        onChange={() => toggle(event, channel)}
                        className="size-4 rounded border accent-foreground"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending}>
          {pending ? tCommon('saving') : tCommon('save')}
        </Button>
      </div>
    </div>
  );
}
