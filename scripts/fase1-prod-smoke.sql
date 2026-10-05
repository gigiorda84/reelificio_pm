-- Fase 1 production smoke fixture (docs/fase1-plan.md I12, release step 9).
-- After step 8: an inactive test page "Smoke test" (ZZ, no buffer alert)
-- with two reels:
--   ZZ-SMOKE-01 — a review assigned to an admin linked to Telegram: the
--                 approval from Telegram is tried on it;
--   ZZ-SMOKE-02 — a dubbing waiting for the test external's acceptance: the
--                 external must see this reel and nothing else.
-- At the end of step 11 the same file with mode=cleanup removes both reels
-- and the page; the external is offboarded with
-- `scripts/fase1-collaborators.ts --target production --as <admin> offboard <email>`.
--
--   psql "$PROD_DB_URL" -v mode=create  -v admin_email=… -v external_email=… -f scripts/fase1-prod-smoke.sql
--   psql "$PROD_DB_URL" -v mode=cleanup -f scripts/fase1-prod-smoke.sql
--
-- The tasks are created by the engine's own functions, so they have SLA
-- thresholds and queue their notifications like real ones (the next sweep
-- or app action sends them).

\set ON_ERROR_STOP on

begin;

\if :{?mode}
\else
  \echo 'set -v mode=create or -v mode=cleanup'
  \quit
\endif

select (:'mode' = 'create') as creating \gset

\if :creating

create function pg_temp.person(p_email text, p_type account_type, p_kind external_kind default null)
returns uuid
language plpgsql
as $$
declare
  v public.profiles%rowtype;
begin
  select * into v from public.profiles where lower(email) = lower(trim(p_email));
  if not found or v.deactivated_at is not null then
    raise exception 'person %: no active profile', p_email;
  end if;
  if v.account_type <> p_type or v.external_kind is distinct from p_kind then
    raise exception 'person %: is %/%, expected %/%', p_email, v.account_type, v.external_kind, p_type, p_kind;
  end if;
  return v.id;
end;
$$;

do $$
begin
  if exists (select 1 from pages where code_prefix = 'ZZ') then
    raise exception 'page ZZ exists already: run mode=cleanup first';
  end if;
end $$;

insert into pages (slug, name, code_prefix, active) values ('smoke-test', 'Smoke test', 'ZZ', false);
insert into batches (page_id, label) select id, 'Batch Smoke' from pages where code_prefix = 'ZZ';
insert into reels (batch_id, page_id, code, ordinal, title, hook, corpo)
select b.id, b.page_id, v.code, v.ordinal, v.title, 'Hook di prova', 'Corpo di prova'
  from batches b
  join pages p on p.id = b.page_id and p.code_prefix = 'ZZ'
 cross join (values ('ZZ-SMOKE-01', 1, 'Smoke: approvazione da Telegram'),
                    ('ZZ-SMOKE-02', 2, 'Smoke: compito dell''esterno di prova')) as v(code, ordinal, title);

select pg_temp.person(:'admin_email', 'internal') as admin_id \gset
select pg_temp.person(:'external_email', 'external', 'dubber') as external_id \gset

create function pg_temp.require_telegram_admin(p_id uuid)
returns void
language plpgsql
as $$
begin
  if not exists (select 1 from profiles where id = p_id and is_admin and telegram_chat_id is not null) then
    raise exception 'the smoke admin must be an admin with Telegram linked';
  end if;
end;
$$;
select pg_temp.require_telegram_admin(:'admin_id'::uuid);

select private._create_task(r.id, 'review', :'admin_id'::uuid, 'in_progress', :'admin_id'::uuid, null, 'phase_approval_request')
  from reels r where r.code = 'ZZ-SMOKE-01';
select private._set_state(r.id, 'revisione') from reels r where r.code = 'ZZ-SMOKE-01';

select private._create_task(r.id, 'dubbing', :'external_id'::uuid, 'assigned', :'admin_id'::uuid, null, 'assignment')
  from reels r where r.code = 'ZZ-SMOKE-02';
select private._set_state(r.id, 'confermato') from reels r where r.code = 'ZZ-SMOKE-02';

select r.code, r.state, t.kind, t.status, p.email as assignee
  from reels r
  join tasks t on t.reel_id = r.id and t.status in ('unassigned', 'assigned', 'in_progress')
  join profiles p on p.id = t.assignee_id
 where r.code like 'ZZ-SMOKE-%'
 order by r.code;

\else

-- Cleanup: the smoke reels with their tasks, events and comments, then the
-- page. Only the ZZ page, refused if it ever became active.
do $$
declare
  v_page uuid;
begin
  select id into v_page from pages where code_prefix = 'ZZ' and slug = 'smoke-test';
  if v_page is null then
    raise exception 'no smoke page';
  end if;
  if (select active from pages where id = v_page) then
    raise exception 'the ZZ page is active: not a smoke page, stopped';
  end if;
  delete from comments where target_type = 'reel'
     and target_id in (select id from reels where page_id = v_page);
  delete from reels where page_id = v_page;
  delete from batches where page_id = v_page;
  delete from pages where id = v_page;
end $$;

\endif

commit;
