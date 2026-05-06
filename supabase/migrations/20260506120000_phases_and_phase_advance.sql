-- Sprint 3 — phase model overhaul + phase-advance approvals.
--
-- Pipeline phases were updated 2026-05-06 to match the production RACI:
--   research_prescript → scientific_validation → script_writing
--     → dubbing → editing → publication
-- (QC absorbed into editing; publish_queue/published collapsed into publication.)
--
-- Postgres enums cannot drop values, so 'qc' and 'published' remain in the type
-- as deprecated values. Application code never assigns them. The default for
-- reels.phase moves to 'research_prescript'.

-------------------------------------------------------------------------------
-- 1. Rename / extend the pipeline_phase enum
-------------------------------------------------------------------------------

alter type pipeline_phase rename value 'research'           to 'research_prescript';
alter type pipeline_phase rename value 'script_validation'  to 'script_writing';
alter type pipeline_phase rename value 'publish_queue'      to 'publication';
alter type pipeline_phase add value if not exists 'scientific_validation' after 'research_prescript';

-------------------------------------------------------------------------------
-- 2. Update default on reels.phase
-------------------------------------------------------------------------------

alter table reels alter column phase set default 'research_prescript';

-------------------------------------------------------------------------------
-- 3. Phase advance request workflow
-------------------------------------------------------------------------------

create type phase_advance_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table phase_advance_requests (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references reels(id) on delete cascade,
  from_phase pipeline_phase not null,
  to_phase pipeline_phase not null,
  requested_by uuid references profiles(id) on delete set null,
  request_note text,
  status phase_advance_status not null default 'pending',
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index phase_advance_requests_reel_idx on phase_advance_requests(reel_id);
create index phase_advance_requests_status_idx on phase_advance_requests(status);

-- Only one pending request per reel.
create unique index phase_advance_requests_one_pending_per_reel
  on phase_advance_requests(reel_id)
  where status = 'pending';

create trigger trg_phase_advance_requests_updated_at
  before update on phase_advance_requests
  for each row execute function set_updated_at();

alter table phase_advance_requests enable row level security;

create policy phase_advance_requests_read_auth on phase_advance_requests
  for select to authenticated using (true);

create policy phase_advance_requests_insert_auth on phase_advance_requests
  for insert to authenticated with check (requested_by = auth.uid());

-- Approvers (admins for now; tightened once RACI lookup is enforced server-side)
-- can update; requester can cancel their own pending request.
create policy phase_advance_requests_update_auth on phase_advance_requests
  for update to authenticated
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
    or requested_by = auth.uid()
  )
  with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
    or requested_by = auth.uid()
  );
