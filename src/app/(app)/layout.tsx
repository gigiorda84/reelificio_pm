import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { TopNav } from '@/components/app-shell/top-nav';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen w-full bg-app-gradient">
      <TopNav email={user.email ?? null} />
      <main className="px-4 md:px-8 py-6 max-w-[1400px] mx-auto">
        {children}
      </main>
    </div>
  );
}
