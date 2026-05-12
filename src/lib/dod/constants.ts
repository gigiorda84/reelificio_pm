export const DOD_ITEM_KEYS = [
  'script_validated',
  'audio_recorded',
  'editing_done',
  'subtitles',
  'qc_approved',
] as const;

export type DodItemKey = (typeof DOD_ITEM_KEYS)[number];
