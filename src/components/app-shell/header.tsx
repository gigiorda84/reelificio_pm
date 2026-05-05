import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth/actions';

type Props = {
  email: string | null;
};

export function Header({ email }: Props) {
  const t = useTranslations('auth');

  return (
    <header className="h-14 border-b bg-background flex items-center justify-end gap-3 px-4 md:px-6">
      <span className="text-sm text-muted-foreground">{email}</span>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="sm">
          <LogOut className="size-4" aria-hidden />
          <span className="sr-only md:not-sr-only">{t('logout')}</span>
        </Button>
      </form>
    </header>
  );
}
