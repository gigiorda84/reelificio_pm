'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { claimAdminIfFirst } from '@/lib/auth/admin';

export function AdminBootstrapBanner() {
  const [pending, startTransition] = useTransition();

  const onClaim = () => {
    startTransition(async () => {
      const result = await claimAdminIfFirst();
      if (result.ok) {
        toast.success('Sei stato promosso ad amministratore.');
      } else if (result.error === 'admin_already_exists') {
        toast.error('Un amministratore esiste già.');
      } else {
        toast.error('Operazione non riuscita.');
      }
    });
  };

  return (
    <div className="rounded-lg border border-amber-300/70 bg-amber-50 dark:border-amber-700/50 dark:bg-amber-950/30 px-4 py-3 flex items-center justify-between gap-4">
      <div className="text-sm">
        <p className="font-medium">Configurazione iniziale</p>
        <p className="text-muted-foreground">
          Nessun amministratore configurato. Promuoviti per iniziare a creare
          pagine e batch.
        </p>
      </div>
      <Button size="sm" onClick={onClaim} disabled={pending}>
        {pending ? 'Promozione…' : 'Diventa admin'}
      </Button>
    </div>
  );
}
