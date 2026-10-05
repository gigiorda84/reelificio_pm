-- R2 (docs/fase1-plan.md §8 and I2): Drive on. Run once, after the Drive
-- migration and the code are in production:
--   psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f scripts/fase1-r2-enable-drive.sql
-- It never touches fase1-prod-config.sql or the R1 backfill. Rehearsed by
-- scripts/db-check/rehearse-dump.sh --release r2.
--
-- Then every reel from confermato on gets its folder, kit (a legacy one when
-- the audio was approved as a link) and shares from drive_reconcile, which
-- the task-sweep cron drains. The open R1 tasks keep delivering with links.

\set ON_ERROR_STOP on

begin;
select 'drive_enabled|' || public.set_app_config('drive_enabled', 'true');
select 'reels_queued|' || public.drive_backfill();
commit;

-- Report (lines "key|value…", read by the rehearsal).
-- Open tasks born in R1, by kind: they still deliver with a link.
select 'open_r1_task|' || kind || '|' || count(*)
  from tasks
 where status in ('unassigned', 'assigned', 'in_progress') and not requires_drive
 group by kind
 order by kind;

-- Reels whose kit will be a legacy one (approved audio as a link), and kits
-- with no audio at all (I6b: the admins are told when the kit is written).
with kits as (
  select r.code, r.state, public.drive_desired_state(r.id) -> 'kit' ->> 'audio_ref' as audio_ref
    from reels r
   where r.published_at is null and r.state in ('animazione', 'approvazione_finale', 'programmato')
)
select case when audio_ref like 'link:%' then 'legacy_kit|' else 'kit_without_audio|' end || code || '|' || state
  from kits
 where audio_ref not like 'file:%'
 order by 1;

-- Reels queued but not drained yet (should fall to 0 within minutes).
select 'drive_jobs_pending|' || count(*)
  from job_outbox
 where kind = 'drive_reconcile' and done_at is null and failed_at is null;
