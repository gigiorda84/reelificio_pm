export const ALL_PIPELINE_PHASES = [
  'research_prescript',
  'scientific_validation',
  'script_writing',
  'dubbing',
  'editing',
  'publication',
] as const;
export type PipelinePhase = (typeof ALL_PIPELINE_PHASES)[number];

export const PIPELINE_PHASE_ORDER: Record<PipelinePhase, number> = {
  research_prescript: 0,
  scientific_validation: 1,
  script_writing: 2,
  dubbing: 3,
  editing: 4,
  publication: 5,
};

export const RACI_ROLES = ['responsible', 'approver', 'consulted', 'informed'] as const;
export type RaciRole = (typeof RACI_ROLES)[number];

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
