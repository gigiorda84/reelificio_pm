'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bell, Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { signOut } from '@/lib/auth/actions';

const NAV_ITEMS = [
  { href: '/dashboard', key: 'dashboard' },
  { href: '/pipeline', key: 'pipeline' },
  { href: '/aggiornamenti', key: 'updates' },
  { href: '/pages', key: 'pages' },
  { href: '/batches', key: 'batches' },
  { href: '/alerts', key: 'alerts' },
] as const;

type Props = {
  email: string | null;
};

export function TopNav({ email }: Props) {
  const t = useTranslations('nav');
  const tApp = useTranslations('app');
  const pathname = usePathname();

  const initials = (email ?? '?')
    .split('@')[0]
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="px-4 md:px-8 pt-5">
      <div className="flex items-center gap-3 md:gap-4">
        {/* Brand pill */}
        <Link
          href="/dashboard"
          className="pill bg-white/80 backdrop-blur-sm ring-1 ring-black/5 shrink-0"
        >
          <span className="font-heading text-base tracking-tight">
            {tApp('name')}
          </span>
        </Link>

        {/* Nav pill */}
        <nav className="hidden md:flex items-center gap-1 rounded-full bg-white/70 backdrop-blur-sm ring-1 ring-black/5 p-1 mx-auto">
          {NAV_ITEMS.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-full px-4 py-2 text-sm transition-colors whitespace-nowrap',
                  active
                    ? 'bg-zinc-900 text-white shadow-sm'
                    : 'text-zinc-700 hover:bg-zinc-900/5',
                )}
              >
                {t(item.key)}
              </Link>
            );
          })}
        </nav>

        {/* Right side: settings, bell, avatar, logout */}
        <div className="flex items-center gap-2 ml-auto">
          <Link
            href="/settings"
            className="pill bg-white/80 backdrop-blur-sm ring-1 ring-black/5 text-zinc-700 hover:text-zinc-900"
          >
            <Settings className="size-4" aria-hidden />
            <span className="hidden sm:inline">{t('settings')}</span>
          </Link>
          <Link
            href="/alerts"
            aria-label={t('alerts')}
            className="relative grid place-items-center size-10 rounded-full bg-white/80 backdrop-blur-sm ring-1 ring-black/5 text-zinc-700 hover:text-zinc-900"
          >
            <Bell className="size-4" aria-hidden />
            <span className="absolute top-2 right-2 size-2 rounded-full bg-amber-400" />
          </Link>
          <div
            className="grid place-items-center size-10 rounded-full bg-zinc-900 text-white text-xs font-semibold"
            title={email ?? ''}
          >
            {initials}
          </div>
          <form action={signOut}>
            <button
              type="submit"
              aria-label="logout"
              className="grid place-items-center size-10 rounded-full bg-white/80 backdrop-blur-sm ring-1 ring-black/5 text-zinc-700 hover:text-zinc-900"
            >
              <LogOut className="size-4" aria-hidden />
            </button>
          </form>
        </div>
      </div>

      {/* Mobile nav */}
      <nav className="md:hidden mt-3 flex items-center gap-1 overflow-x-auto rounded-full bg-white/70 backdrop-blur-sm ring-1 ring-black/5 p-1">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs transition-colors whitespace-nowrap',
                active
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-700 hover:bg-zinc-900/5',
              )}
            >
              {t(item.key)}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
