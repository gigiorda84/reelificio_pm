import { getSupabaseServerClient } from '@/lib/supabase/server';

export type VoiceBriefRow = {
  id: string;
  page_id: string;
  adjectives: string[];
  reference_audio_urls: string[];
  banned_words: string[];
  allowed_liberties: string | null;
  anomaly_procedure: string | null;
  version: number;
};

export async function getVoiceBriefForPage(
  pageId: string,
): Promise<VoiceBriefRow | null> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('voice_briefs')
    .select(
      'id, page_id, adjectives, reference_audio_urls, banned_words, allowed_liberties, anomaly_procedure, version',
    )
    .eq('page_id', pageId)
    .maybeSingle();
  if (error) throw error;
  return (data as VoiceBriefRow) ?? null;
}
