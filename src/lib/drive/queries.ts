import { getSupabaseServerClient } from '@/lib/supabase/server';

export type ReelFile = {
  id: string;
  task_id: string | null;
  kind: 'audio' | 'video' | 'script' | 'other';
  version: number;
  name: string;
  web_view_link: string | null;
  size_bytes: number | null;
  approved_at: string | null;
  archived_at: string | null;
  created_at: string;
};

// The ready files of a reel (RLS: whoever sees the reel), newest version
// first within each kind.
export async function listReelFiles(reelId: string): Promise<ReelFile[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('reel_files')
    .select('id, task_id, kind, version, name, web_view_link, size_bytes, approved_at, archived_at, created_at')
    .eq('reel_id', reelId)
    .eq('status', 'ready')
    .order('kind')
    .order('version', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ReelFile[];
}

// The newest ready file of a kind: what a dubbing or animation delivered
// last (uploads happen only while that task is in progress).
export function newestOf(files: ReelFile[], kind: ReelFile['kind'], taskId?: string): ReelFile | null {
  return files.find((f) => f.kind === kind && (!taskId || f.task_id === taskId)) ?? null;
}
