import { getSupabaseServerClient } from '@/lib/supabase/server';
import { DOD_ITEM_KEYS, type DodItemKey } from './constants';

export type DodItem = {
  key: DodItemKey;
  checked: boolean;
  checked_by: string | null;
  checked_by_label: string | null;
  checked_at: string | null;
  note: string | null;
};

export async function listDodForReel(reelId: string): Promise<DodItem[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('reel_dod_items')
    .select('key, checked_by, checked_at, note')
    .eq('reel_id', reelId);
  if (error) throw error;

  const rows = data ?? [];
  const checkedByIds = Array.from(
    new Set(
      rows
        .map((r) => r.checked_by as string | null)
        .filter((x): x is string => !!x),
    ),
  );
  const profileMap = new Map<string, string>();
  if (checkedByIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', checkedByIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, (p.full_name as string | null) ?? (p.email as string));
    }
  }

  const byKey = new Map(rows.map((r) => [r.key as DodItemKey, r]));
  return DOD_ITEM_KEYS.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      checked: !!row,
      checked_by: row?.checked_by ?? null,
      checked_by_label: row?.checked_by
        ? profileMap.get(row.checked_by as string) ?? null
        : null,
      checked_at: row?.checked_at ?? null,
      note: row?.note ?? null,
    };
  });
}

export async function isReelDodComplete(reelId: string): Promise<boolean> {
  const supabase = await getSupabaseServerClient();
  const { count } = await supabase
    .from('reel_dod_items')
    .select('*', { count: 'exact', head: true })
    .eq('reel_id', reelId);
  return (count ?? 0) >= DOD_ITEM_KEYS.length;
}
