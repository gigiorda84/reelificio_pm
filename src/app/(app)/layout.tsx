import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { TopNav } from '@/components/app-shell/top-nav';
import { getViewer } from '@/lib/auth/viewer';
import { countMyApprovals } from '@/lib/tasks/queries';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewer = await getViewer();

  if (!user || !viewer) {
    redirect('/login');
  }

  const approvalsCount = viewer.isExternal ? 0 : await countMyApprovals();

  return (
    <div className="min-h-screen w-full bg-app-gradient">
      <TopNav email={user.email ?? null} isExternal={viewer.isExternal} approvalsCount={approvalsCount} />
      <main className="px-4 md:px-8 py-6 max-w-[1400px] mx-auto">
        {children}
      </main>
    </div>
  );
}
