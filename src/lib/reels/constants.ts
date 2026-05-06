export const ALL_PIPELINE_PHASES = [
  'research',
  'script_validation',
  'dubbing',
  'editing',
  'qc',
  'publish_queue',
  'published',
] as const;
export type PipelinePhase = (typeof ALL_PIPELINE_PHASES)[number];

export const ALL_REEL_FORMATS = [
  'porcino_mono',
  'papaya_mono',
  'botta_e_risposta',
  'duo',
  'other',
] as const;
export type ReelFormat = (typeof ALL_REEL_FORMATS)[number];

export const ALL_REEL_CATEGORIES = ['safe', 'adapted', 'test'] as const;
export type ReelCategory = (typeof ALL_REEL_CATEGORIES)[number];
