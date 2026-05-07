import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { buildTelegramLinkToken } from '@/lib/notifications/telegram-link';
import { getOwnPrefMatrix } from '@/lib/notifications/prefs';
import { ProfileForm } from './profile-form';
import { TelegramLink } from './telegram-link';
import { NotificationMatrix } from './notification-matrix';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/settings');

  const [t, profileRes, matrix] = await Promise.all([
    getTranslations('settings'),
    supabase
      .from('profiles')
      .select('full_name, email, daily_reminder_at, telegram_chat_id')
      .eq('id', user.id)
      .maybeSingle(),
    getOwnPrefMatrix(),
  ]);

  const profile = profileRes.data;
  const linkToken = buildTelegramLinkToken(user.id);
  const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? '';

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">{t('section.profile')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm
            initial={{
              full_name: profile?.full_name ?? '',
              email: profile?.email ?? user.email ?? '',
              daily_reminder_at: profile?.daily_reminder_at?.slice(0, 5) ?? '18:00',
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">{t('section.telegram')}</CardTitle>
        </CardHeader>
        <CardContent>
          <TelegramLink
            linked={!!profile?.telegram_chat_id}
            linkToken={linkToken}
            botUsername={botUsername}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">{t('section.notifications')}</CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationMatrix initial={matrix} telegramLinked={!!profile?.telegram_chat_id} />
        </CardContent>
      </Card>
    </div>
  );
}
