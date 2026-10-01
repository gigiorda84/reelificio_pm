-- Fase 0 — scale (docs/brain-plan.md). At ~50 pages the app handles ~1,250
-- new reels a month, so lists must stop loading every reel ever made.
--
-- 1. `published_at`: a reel with a posted_url is published and leaves the
--    active set (kanban, dashboard, buffer, stuck alerts). The buffer is now
--    "ready but not yet posted", as the BP defines it.
-- 2. Indexes for the per-page / per-phase filters on the active set.
-- 3. Aggregates computed in SQL instead of loading rows into the server
--    (PostgREST caps responses at 1,000 rows and long `.in()` lists blow the
--    URL limit).

-------------------------------------------------------------------------------
-- 1. Published reels leave the active set
-------------------------------------------------------------------------------

alter table reels add column published_at timestamptz;

create or replace function reels_track_published_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.posted_url is null then
    new.published_at := null;
  elsif tg_op = 'INSERT' or old.posted_url is null then
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$$;

create trigger trg_reels_published_at
  before insert or update of posted_url on reels
  for each row execute function reels_track_published_at();

-- Backfill without bumping updated_at (the weekly digest reads it).
alter table reels disable trigger trg_reels_updated_at;
update reels set published_at = updated_at where posted_url is not null;
alter table reels enable trigger trg_reels_updated_at;

-------------------------------------------------------------------------------
-- 2. Indexes
-------------------------------------------------------------------------------

create index if not exists reels_page_idx on reels(page_id);
create index if not exists reels_active_page_phase_idx
  on reels(page_id, phase, phase_entered_at) where published_at is null;
create index if not exists reels_active_phase_idx
  on reels(phase, phase_entered_at) where published_at is null;
create index if not exists comments_reel_recent_idx
  on comments(target_id, created_at) where target_type = 'reel';

-------------------------------------------------------------------------------
-- 3. Aggregates (SECURITY INVOKER: RLS applies to the caller)
-------------------------------------------------------------------------------

-- Active (not yet published) reels per page and phase.
create or replace function public.active_reel_counts()
returns table (page_id uuid, phase pipeline_phase, reel_count bigint)
language sql
stable
set search_path = public
as $$
  select r.page_id, r.phase, count(*)
  from reels r
  where r.published_at is null
  group by r.page_id, r.phase;
$$;

create or replace function public.batch_reel_counts(p_batch_ids uuid[])
returns table (batch_id uuid, reel_count bigint)
language sql
stable
set search_path = public
as $$
  select r.batch_id, count(*)
  from reels r
  where r.batch_id = any (p_batch_ids)
  group by r.batch_id;
$$;

-- Reels sitting in a working phase since before p_cutoff with no reel
-- comment since then (alert rule `phase_stuck`). Cron-only.
create or replace function public.stuck_reels(p_cutoff timestamptz)
returns table (
  id uuid,
  code text,
  title text,
  page_id uuid,
  phase pipeline_phase,
  phase_entered_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select r.id, r.code, r.title, r.page_id, r.phase, r.phase_entered_at
  from reels r
  where r.published_at is null
    and r.phase not in ('publication', 'qc', 'published')
    and r.phase_entered_at < p_cutoff
    and not exists (
      select 1
      from comments c
      where c.target_type = 'reel'
        and c.target_id = r.id
        and c.created_at >= p_cutoff
    )
  order by r.phase_entered_at;
$$;

revoke execute on function public.active_reel_counts() from public, anon;
revoke execute on function public.batch_reel_counts(uuid[]) from public, anon;
revoke execute on function public.stuck_reels(timestamptz) from public, anon, authenticated;
grant execute on function public.active_reel_counts() to authenticated, service_role;
grant execute on function public.batch_reel_counts(uuid[]) to authenticated, service_role;
grant execute on function public.stuck_reels(timestamptz) to service_role;
