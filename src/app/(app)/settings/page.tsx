import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getOwnPrefMatrix } from '@/lib/notifications/prefs';
import { getViewer } from '@/lib/auth/viewer';
import { listApprovalGroups } from '@/lib/pages/production';
import { ProfileForm } from './profile-form';
import { TelegramLink } from './telegram-link';
import { NotificationMatrix } from './notification-matrix';
import { ApproversSettings, type InternalPerson } from './approvers-settings';

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
  const viewer = await getViewer();
  const approvers = viewer?.isAdmin ? await loadApprovers(supabase) : null;
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

      {approvers ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">{t('section.approvers')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ApproversSettings groups={approvers.groups} people={approvers.people} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// Admin: approval groups and the internals who may approve or be absent.
async function loadApprovers(supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>) {
  const [groups, { data }] = await Promise.all([
    listApprovalGroups(),
    supabase
      .from('profiles')
      .select('id, full_name, email, absent_until')
      .eq('account_type', 'internal')
      .is('deactivated_at', null)
      .order('full_name'),
  ]);
  const now = Date.now();
  const people: InternalPerson[] = (data ?? []).map((p) => ({
    id: p.id,
    label: p.full_name?.trim() || p.email,
    absent_until: p.absent_until,
    away: !!p.absent_until && Date.parse(p.absent_until) > now,
  }));
  return { groups, people };
}
