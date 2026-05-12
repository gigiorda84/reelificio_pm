'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { closeAlert } from '@/lib/alerts/actions';

export function CloseAlertButton({ alertId }: { alertId: string }) {
  const t = useTranslations('alerts');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [solution, setSolution] = useState('');
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    if (!solution.trim()) {
      toast.error(t('solutionRequired'));
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set('alert_id', alertId);
      fd.set('proposed_solution', solution.trim());
      const result = await closeAlert(fd);
      if (result.ok) {
        toast.success(t('closeSuccess'));
        setSolution('');
        setOpen(false);
      } else if (result.error === 'not_authorized') {
        toast.error(t('notAuthorized'));
      } else if (result.error === 'invalid_input') {
        toast.error(t('solutionRequired'));
      } else {
        toast.error(tCommon('error'));
      }
    });
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CheckCircle2 className="size-3" aria-hidden /> {t('close')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('closeDialogTitle')}</DialogTitle>
          <DialogDescription>{t('closeDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="proposed_solution">{t('proposedSolutionLabel')}</Label>
          <Textarea
            id="proposed_solution"
            value={solution}
            onChange={(e) => setSolution(e.target.value)}
            rows={4}
            placeholder={t('proposedSolutionPlaceholder')}
          />
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            {tCommon('cancel')}
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? tCommon('saving') : t('close')}
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
