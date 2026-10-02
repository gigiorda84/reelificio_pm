-- Fase 1 migration report (docs/fase1-plan.md §6). Read-only: it runs on the
-- dump rehearsal and on production (release steps 3 and 5) with
--   PGOPTIONS='-c default_transaction_read_only=on'.
--
--   psql … -v phase=before -v allowlist='a@x.it,b@y.it' -f scripts/fase1-migration-report.sql
--   psql … -v phase=after -f scripts/fase1-migration-report.sql
--
-- Counters print as `counter:key|value` lines so two runs can be diffed (the
-- rehearsal compares before and after). Lists are for people to read. A STOP
-- condition raises an error and ends the run.

\set ON_ERROR_STOP on
\pset footer off
\pset format unaligned
\pset fieldsep '|'

select :'phase' = 'before' as is_before, :'phase' = 'after' as is_after \gset
\if :is_before
\elif :is_after
\else
  \echo 'set -v phase=before|after'
  \quit 1
\endif

-------------------------------------------------------------------------------
\echo '## counters'
-------------------------------------------------------------------------------
\pset tuples_only on
select 'counter:reels_total', count(*) from reels;
select 'counter:reels_published', count(*) from reels where published_at is not null;
select 'counter:comments_total', count(*) from comments;
\if :is_before
select 'counter:dod_preexisting', count(*) from reel_dod_items;
\else
select 'counter:dod_preexisting', count(*) from reel_dod_items where note is distinct from '[migrazione Fase 1]';
\endif
select 'counter:requests_pending', count(*) from phase_advance_requests where status = 'pending';
select 'counter:profiles_total', count(*) from profiles;
select 'counter:published_at_checksum', md5(coalesce(string_agg(id::text || ':' || coalesce(published_at::text, ''), ',' order by id), ''))
  from reels;
select 'counter:posted_url_checksum', md5(coalesce(string_agg(id::text || ':' || coalesce(posted_url, ''), ',' order by id), ''))
  from reels;
\pset tuples_only off

\if :is_before
-------------------------------------------------------------------------------
\echo '## reels by phase (before)'
select phase, (published_at is not null) as published, count(*) from reels group by 1, 2 order by 1, 2;

\echo '## profiles that become internal'
select p.email, p.is_admin, p.created_at::date as created
  from profiles p order by p.created_at;

\echo '## STOP check: every profile on the internal allowlist'
-- psql does not expand variables inside $$, so the list goes through a setting.
select set_config('fase1.allowlist', :'allowlist', false) \gset
do $$
declare
  v_allow text[] := string_to_array(current_setting('fase1.allowlist'), ',');
  v_bad text;
begin
  select string_agg(p.email, ', ') into v_bad
  from profiles p where lower(p.email) <> all (select lower(trim(a)) from unnest(v_allow) a);
  if v_bad is not null then
    raise exception 'STOP: profiles that would become internal but are not on the allowlist: %', v_bad;
  end if;
end $$;

\echo '## telegram_chat_id to clear (group chats, duplicates except the latest)'
select p.email, p.telegram_chat_id,
       case when p.telegram_chat_id like '-%' then 'group' else 'duplicate' end as reason
  from profiles p
 where p.telegram_chat_id like '-%'
    or exists (select 1 from profiles q where q.telegram_chat_id = p.telegram_chat_id
                and (q.updated_at, q.id) > (p.updated_at, p.id));

\echo '## rows normalised by the migration (qc, published, published outside publication)'
select code, phase, published_at from reels
 where phase in ('qc', 'published') or (published_at is not null and phase <> 'publication')
 order by code;

\echo '## reels in scientific_validation (sent back to bozza when the validation is approved, S2)'
select code from reels where phase = 'scientific_validation' order by code;

\echo '## profiles without an auth user'
select p.email from profiles p where not exists (select 1 from auth.users u where u.id = p.id);

\echo '## notification_prefs rows removed (old Telegram-off default)'
select event, count(*) from notification_prefs
 where event in ('assignment', 'phase_approval_request', 'phase_rejected') group by 1 order by 1;

\echo '## pending phase-advance requests (cancelled by the contract migration)'
select r.code, p.email as requested_by, a.created_at::date
  from phase_advance_requests a join reels r on r.id = a.reel_id
  left join profiles p on p.id = a.requested_by
 where a.status = 'pending' order by a.created_at;

\else
-------------------------------------------------------------------------------
\echo '## reels by state (after)'
select state, phase, (published_at is not null) as published, count(*) from reels group by 1, 2, 3 order by 1, 2, 3;

\echo '## STOP checks'
do $$ begin
  if exists (select 1 from reels where state is null) then
    raise exception 'STOP: reels without state';
  end if;
  if exists (select 1 from reels where phase is distinct from public.state_raci_phase(state)) then
    raise exception 'STOP: phase and state out of step';
  end if;
  if exists (select reel_id from tasks where status in ('unassigned', 'assigned', 'in_progress')
             group by reel_id having count(*) > 1) then
    raise exception 'STOP: a reel has more than one open task';
  end if;
  if exists (select 1 from tasks t join reels r on r.id = t.reel_id
              where t.status in ('unassigned', 'assigned', 'in_progress')
                and r.state in ('idea', 'pubblicato')) then
    raise exception 'STOP: an open task on an idea or published reel';
  end if;
end $$;

\echo '## accounts'
select account_type, external_kind, (deactivated_at is not null) as deactivated, count(*)
  from profiles group by 1, 2, 3 order by 1, 2, 3;

\echo '## open tasks by kind and status'
select kind, status, escalation_paused, count(*) from tasks
 where status in ('unassigned', 'assigned', 'in_progress') group by 1, 2, 3 order by 1, 2;

\echo '## tasks to assign (unassigned)'
select r.code, t.kind from tasks t join reels r on r.id = t.reel_id
 where t.status = 'unassigned' order by r.code;

\echo '## DoD items added by the migration'
select count(*) from reel_dod_items where note = '[migrazione Fase 1]';

\echo '## switches'
select key, value from app_config order by key;
\endif
