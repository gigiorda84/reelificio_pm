'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  FileVideo,
  Layers,
  KanbanSquare,
  Bell,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, key: 'dashboard' },
  { href: '/pipeline', icon: KanbanSquare, key: 'pipeline' },
  { href: '/pages', icon: FileVideo, key: 'pages' },
  { href: '/batches', icon: Layers, key: 'batches' },
  { href: '/alerts', icon: Bell, key: 'alerts' },
  { href: '/settings', icon: Settings, key: 'settings' },
] as const;

export function Sidebar() {
  const t = useTranslations('nav');
  const tApp = useTranslations('app');
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-60 md:flex-col border-r bg-card">
      <div className="px-5 py-5 border-b">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {tApp('name')}
        </p>
        <p className="text-sm font-medium">{tApp('tagline')}</p>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden />
              <span>{t(item.key)}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
