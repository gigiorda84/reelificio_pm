import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [t, { error }] = await Promise.all([getTranslations(), searchParams]);
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {t('app.name')}
          </p>
          <CardTitle>{t('auth.login.title')}</CardTitle>
          <CardDescription>{t('auth.login.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error === 'callback_failed' ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
              {t('auth.login.linkFailed')}
            </p>
          ) : null}
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
