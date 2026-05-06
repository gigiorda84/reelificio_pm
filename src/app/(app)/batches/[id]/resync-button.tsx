'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { resyncBatch, type ResyncDiff } from '@/lib/batches/actions';

type Props = { batchId: string };

export function ResyncButton({ batchId }: Props) {
  const t = useTranslations('batches');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<ResyncDiff | null>(null);
  const [pending, startTransition] = useTransition();

  const onPreview = () => {
    startTransition(async () => {
      const result = await resyncBatch(batchId, { apply: false });
      if (result.ok) {
        setDiff(result.diff);
        setOpen(true);
      } else {
        toast.error(t(`form.errors.${mapDriveError(result.error)}` as Parameters<typeof t>[0]));
      }
    });
  };

  const onApply = () => {
    startTransition(async () => {
      const result = await resyncBatch(batchId, { apply: true });
      if (result.ok) {
        setOpen(false);
        toast.success(tCommon('saved'));
      } else {
        toast.error(t(`form.errors.${mapDriveError(result.error)}` as Parameters<typeof t>[0]));
      }
    });
  };

  const isEmptyDiff =
    diff &&
    diff.added.length === 0 &&
    diff.changed.length === 0 &&
    diff.removed.length === 0;

  return (
    <>
      <Button variant="outline" size="sm" onClick={onPreview} disabled={pending}>
        <RefreshCw className="size-4" aria-hidden />
        {pending ? t('detail.resyncing') : t('detail.resync')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('detail.diff.title')}</DialogTitle>
            <DialogDescription>{diff?.warnings.join(' ')}</DialogDescription>
          </DialogHeader>

          {isEmptyDiff ? (
            <p className="text-sm text-muted-foreground py-2">
              {t('detail.diff.noChanges')}
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              {diff && diff.added.length > 0 ? (
                <DiffSection
                  label={t('detail.diff.added')}
                  items={diff.added.map((n) => `#${n}`)}
                  tone="add"
                />
              ) : null}
              {diff && diff.changed.length > 0 ? (
                <DiffSection
                  label={t('detail.diff.changed')}
                  items={diff.changed.map((c) => `#${c.ordinal} (${c.fields.join(', ')})`)}
                  tone="change"
                />
              ) : null}
              {diff && diff.removed.length > 0 ? (
                <DiffSection
                  label={t('detail.diff.removed')}
                  items={diff.removed.map((n) => `#${n}`)}
                  tone="remove"
                />
              ) : null}
              {diff && diff.unchanged.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('detail.diff.unchanged')}: {diff.unchanged.length}
                </p>
              ) : null}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {tCommon('cancel')}
            </Button>
            {!isEmptyDiff ? (
              <Button onClick={onApply} disabled={pending}>
                {pending ? t('detail.resyncing') : tCommon('save')}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DiffSection({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: 'add' | 'change' | 'remove';
}) {
  const toneClass =
    tone === 'add'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'remove'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-blue-700 dark:text-blue-400';

  return (
    <div>
      <p className={`text-xs uppercase tracking-wider ${toneClass}`}>{label}</p>
      <p className="font-mono text-xs leading-relaxed">{items.join('  ')}</p>
    </div>
  );
}

function mapDriveError(
  err:
    | 'batch_not_found'
    | 'page_not_found'
    | 'no_source_doc'
    | 'drive_invalid_url'
    | 'drive_not_found'
    | 'drive_forbidden'
    | 'drive_unsupported'
    | 'drive_unknown'
    | 'no_reels'
    | 'not_admin'
    | 'unknown',
):
  | 'invalidUrl'
  | 'driveNotFound'
  | 'driveForbidden'
  | 'driveUnsupported'
  | 'driveUnknown'
  | 'noReels'
  | 'notAdmin'
  | 'unknown' {
  switch (err) {
    case 'drive_invalid_url':
      return 'invalidUrl';
    case 'drive_not_found':
      return 'driveNotFound';
    case 'drive_forbidden':
      return 'driveForbidden';
    case 'drive_unsupported':
      return 'driveUnsupported';
    case 'drive_unknown':
      return 'driveUnknown';
    case 'no_reels':
      return 'noReels';
    case 'not_admin':
      return 'notAdmin';
    default:
      return 'unknown';
  }
}
