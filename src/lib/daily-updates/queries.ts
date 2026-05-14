import { getSupabaseServerClient } from '@/lib/supabase/server';
import {
  type DailyUpdateRow,
  type DailyUpdateWithAuthor,
  todayIsoInRome,
  isoDaysAgoInRome,
} from './types';

type Joined = DailyUpdateRow & {
  author: { full_name: string | null; email: string } | null;
};

function flatten(rows: Joined[]): DailyUpdateWithAuthor[] {
  return rows.map((r) => ({
    ...r,
    author_name: r.author?.full_name ?? null,
    author_email: r.author?.email ?? null,
  }));
}

export async function getMyTodayUpdate(): Promise<DailyUpdateRow | null> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('daily_updates')
    .select('id, user_id, date, did_today, blockers, tomorrow, created_at, updated_at')
    .eq('user_id', user.id)
    .eq('date', todayIsoInRome())
    .maybeSingle();
  return (data as DailyUpdateRow | null) ?? null;
}

export async function listTeamUpdatesForDate(
  date: string = todayIsoInRome(),
): Promise<DailyUpdateWithAuthor[]> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from('daily_updates')
    .select(`
      id, user_id, date, did_today, blockers, tomorrow, created_at, updated_at,
      author:profiles!daily_updates_user_id_fkey(full_name, email)
    `)
    .eq('date', date)
    .order('created_at', { ascending: true });
  return flatten(((data ?? []) as unknown) as Joined[]);
}

export async function listTeamUpdatesLastNDays(
  days: number,
): Promise<DailyUpdateWithAuthor[]> {
  const supabase = await getSupabaseServerClient();
  const since = isoDaysAgoInRome(days - 1);
  const { data } = await supabase
    .from('daily_updates')
    .select(`
      id, user_id, date, did_today, blockers, tomorrow, created_at, updated_at,
      author:profiles!daily_updates_user_id_fkey(full_name, email)
    `)
    .gte('date', since)
    .order('date', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(500);
  return flatten(((data ?? []) as unknown) as Joined[]);
}
