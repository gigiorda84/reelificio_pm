import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function DashboardPage() {
  const t = useTranslations('dashboard');

  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {t('empty')}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Sprint 0 — fondamenta pronte. Le funzionalità verranno aggiunte negli
          sprint successivi.
        </CardContent>
      </Card>
    </div>
  );
}
