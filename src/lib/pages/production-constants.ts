// Production settings constants, shared by server queries and the client
// editor. Mirror of `sla_step` and the role columns of `pages`
// (supabase/migrations/20261002141707_fase1_core.sql).

export const SLA_STEPS = [
  'writing',
  'review',
  'validation',
  'dubbing_accept',
  'dubbing',
  'audio_approval',
  'animation_accept',
  'animation',
  'final_approval',
  'scheduling',
] as const;
export type SlaStep = (typeof SLA_STEPS)[number];
export type SlaTrack = 'batch' | 'express';

export const ROLE_FIELDS = [
  'dubber_titular_id',
  'dubber_reserve_id',
  'animator_titular_id',
  'animator_reserve_id',
  'validator_id',
] as const;
export type RoleField = (typeof ROLE_FIELDS)[number];

// The external kind a role field takes; internals fit every role.
export const ROLE_KIND: Record<RoleField, 'dubber' | 'animator' | 'validator'> = {
  dubber_titular_id: 'dubber',
  dubber_reserve_id: 'dubber',
  animator_titular_id: 'animator',
  animator_reserve_id: 'animator',
  validator_id: 'validator',
};
