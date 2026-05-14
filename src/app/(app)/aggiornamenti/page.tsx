import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getMyTodayUpdate,
  listTeamUpdatesLastNDays,
} from '@/lib/daily-updates/queries';
import { DailyUpdateForm } from '@/components/daily-updates/daily-update-form';
import { TeamUpdatesList } from '@/components/daily-updates/team-updates-list';

export default async function AggiornamentiPage() {
  const [t, myToday, updates] = await Promise.all([
    getTranslations('dailyUpdates'),
    getMyTodayUpdate(),
    listTeamUpdatesLastNDays(7),
  ]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('pageSubtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">{t('myCardTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DailyUpdateForm
            initial={{
              did_today: myToday?.did_today ?? '',
              blockers: myToday?.blockers ?? '',
              tomorrow: myToday?.tomorrow ?? '',
            }}
            alreadySubmitted={!!myToday}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">{t('historyTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <TeamUpdatesList updates={updates} groupByDate />
        </CardContent>
      </Card>
    </div>
  );
}
