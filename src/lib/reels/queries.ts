import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { ReelState } from './constants';

export type ReelDetail = {
  id: string;
  batch_id: string;
  page_id: string;
  code: string;
  ordinal: number;
  title: string;
  format: string;
  category: string;

  hook: string | null;
  corpo: string | null;
  chiusura: string | null;
  cta: string | null;
  notes: string | null;
  raw_content: string | null;
  parser_warning: string | null;

  state: ReelState;
  track: 'batch' | 'express';
  script_rev: number;
  phase: string;
  phase_status: string;
  phase_entered_at: string;

  audio_drive_url: string | null;
  video_drive_url: string | null;
  // Drive (S5): the reel folder, and when the animator's kit was ready.
  drive_folder_id: string | null;
  kit_ready_at: string | null;
  caption: string | null;
  scheduled_at: string | null;
  posted_url: string | null;

  // joined
  batch_label: string;
  page_name: string;
  page_code_prefix: string;
};

export async function getReelDetail(id: string): Promise<ReelDetail | null> {
  const supabase = await getSupabaseServerClient();

  const { data: reel, error } = await supabase
    .from('reels')
    .select(
      'id, batch_id, page_id, code, ordinal, title, format, category, hook, corpo, chiusura, cta, notes, raw_content, parser_warning, state, track, script_rev, phase, phase_status, phase_entered_at, audio_drive_url, video_drive_url, drive_folder_id, kit_ready_at, caption, scheduled_at, posted_url',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!reel) return null;

  const [{ data: batch }, { data: page }] = await Promise.all([
    supabase.from('batches').select('label').eq('id', reel.batch_id).maybeSingle(),
    supabase
      .from('pages')
      .select('name, code_prefix')
      .eq('id', reel.page_id)
      .maybeSingle(),
  ]);

  return {
    ...reel,
    batch_label: batch?.label ?? '—',
    page_name: page?.name ?? '—',
    page_code_prefix: page?.code_prefix ?? '??',
  } as ReelDetail;
}
