import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminBootstrapBanner } from '@/components/admin-bootstrap-banner';
import { getAdminStatus } from '@/lib/auth/admin';

export default async function DashboardPage() {
  const [t, adminStatus] = await Promise.all([
    getTranslations('dashboard'),
    getAdminStatus(),
  ]);

  const showBootstrap = !adminStatus.isAdmin && !adminStatus.hasAnyAdmin;

  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

      {showBootstrap ? <AdminBootstrapBanner /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">{t('empty')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Sprint 1 in corso — la dashboard si popolerà man mano che le
          funzionalità vengono completate.
        </CardContent>
      </Card>
    </div>
  );
}
