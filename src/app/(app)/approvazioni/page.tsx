import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { listMyApprovals } from '@/lib/tasks/queries';
import { checkReels } from '@/lib/script-lab/recent';
import { ApprovalCard } from './approval-card';
import { requireInternal } from '@/lib/auth/viewer';

// What waits for my decision (assignee, approver or delegate), Express
// first. Mobile-first: each card has everything needed to decide, including
// the warnings of the automatic checks on a script (Fase 2 S5).
export default async function ApprovalsPage() {
  await requireInternal();
  const t = await getTranslations('tasks.approvals');
  const items = await listMyApprovals();
  const scripts = items.filter((i) => i.kind === 'review' || i.kind === 'validation').map((i) => i.reel);
  const warnings = await checkReels(scripts);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle', { count: items.length })}</p>
      </div>
      {items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{t('empty')}</Card>
      ) : (
        items.map((item) => <ApprovalCard key={item.id} item={item} warnings={warnings.get(item.reel.id)} />)
      )}
    </div>
  );
}
