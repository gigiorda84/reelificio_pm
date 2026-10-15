-- Fase 2 S3 — ideas and batches from ideas (docs/fase2-plan.md AC5–AC7).
-- Users from seed.sql: a admin · b Responsible script_writing · c internal
-- without a role · d RACI approver · e external dubber. Page P (prefix PP)
-- has the import batch "Batch Ottobre" with reels PP-2610-01/02 (03 added
-- below, without a title).

create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_id, false);
$$;
create function pg_temp.page() returns uuid language sql immutable as $$
  select '10000000-0000-0000-0000-000000000001'::uuid;
$$;
create function pg_temp.new_idea(p_title text) returns uuid language sql as $$
  select (public.upsert_idea(null, pg_temp.page(), p_title, 'Uno spunto') ->> 'id')::uuid;
$$;

-- Doc ideas and codes, as postgres.
do $$ begin
  if (select count(*) from ideas where page_id = pg_temp.page() and source = 'doc' and status = 'scelta'
        and reel_id in ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002')) <> 2 then
    raise exception 'FAIL: reels inserted into an import batch have no doc idea';
  end if;
  if (select (origin, period) from batches where id = '20000000-0000-0000-0000-000000000001')
     is distinct from ('import'::text, null::date) then
    raise exception 'FAIL: a new import batch is not origin import with a null period';
  end if;
  -- The SQL twin of buildReelCode (src/lib/batches/codes.ts, codes.test.ts).
  if private._reel_code('pp', 2026, 11, 1) <> 'PP-2611-01'
     or private._reel_code('PP', 2026, 11, 12) <> 'PP-2611-12'
     or private._reel_code('PP', 2027, 1, 100) <> 'PP-2701-100' then
    raise exception 'FAIL: _reel_code differs from buildReelCode';
  end if;
  begin
    insert into batches (page_id, label, origin) values (pg_temp.page(), 'Senza mese', 'ideas');
    raise exception 'FAIL: an ideas batch without a period';
  exception when check_violation then null;
  end;
end $$;

-- A Doc header without a title (`SCRIPT 3 — `) still imports: the doc idea
-- takes the reel code.
insert into reels (id, batch_id, page_id, code, ordinal, title) values
  ('30000000-0000-0000-0000-0000000000b3', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-03', 3, '  ');
do $$ begin
  if (select title from ideas where reel_id = '30000000-0000-0000-0000-0000000000b3') is distinct from 'PP-2610-03' then
    raise exception 'FAIL: doc idea of a reel without a title';
  end if;
end $$;

-- A second page, for the cross-page refusal.
insert into pages (id, slug, name, code_prefix) values ('10000000-0000-0000-0000-0000000000c2', 'altra', 'Altra', 'AL');
insert into ideas (id, page_id, title) values ('90000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c2', 'Idea altrui');
-- The import batch gets a month, like a backfilled one: adding ideas to it
-- must be refused because of its origin, not for a missing period.
update batches set period = '2026-10-01' where id = '20000000-0000-0000-0000-000000000001';
-- Batches ideas can't be added to: an ideas batch of the other page, and a
-- closed one of page P.
insert into batches (id, page_id, label, origin, period, status) values
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c2', 'Batch Dicembre', 'ideas', '2026-12-01', 'draft'),
  ('20000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-000000000001', 'Batch Agosto', 'ideas', '2026-08-01', 'closed');
-- A code taken by someone else between numbering and insert (the race with
-- a concurrent import): simulated for the reel titled 'Collisione'.
create function public.db_check_collide() returns trigger language plpgsql as $$
begin
  if new.title = 'Collisione' then
    raise exception using errcode = 'unique_violation', message = 'simulated code collision';
  end if;
  return new;
end $$;
create trigger db_check_collide before insert on reels for each row execute function public.db_check_collide();

set role authenticated;

-- AC5: the Responsible writes the backlog; the others are refused.
do $$ declare v jsonb; i4 uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  v := public.upsert_idea(null, pg_temp.page(), '  Funghi e luna  ', '  ');
  if v->>'code' <> 'ok' then raise exception 'FAIL: Responsible upsert_idea: %', v; end if;
  if (select (title, spunto, source, status, created_by) from ideas where id = (v->>'id')::uuid)
     is distinct from ('Funghi e luna'::text, null::text, 'manuale'::text, 'backlog'::text, '00000000-0000-0000-0000-00000000000b'::uuid) then
    raise exception 'FAIL: new idea fields';
  end if;
  -- Call and verification in separate statements: a subquery in the same
  -- IF is computed before the call.
  if public.upsert_idea((v->>'id')::uuid, null, 'Funghi e luna piena', 'Il mito') ->> 'code' <> 'ok' then
    raise exception 'FAIL: editing a backlog idea';
  end if;
  if (select title from ideas where id = (v->>'id')::uuid) <> 'Funghi e luna piena' then
    raise exception 'FAIL: the edited title was not saved';
  end if;
  if public.upsert_idea(null, pg_temp.page(), '', null) ->> 'code' <> 'invalid_input'
     or public.upsert_idea(null, pg_temp.page(), repeat('x', 201), null) ->> 'code' <> 'invalid_input'
     or public.upsert_idea(null, '10000000-0000-0000-0000-0000000000ff', 'x', null) ->> 'code' <> 'invalid_input' then
    raise exception 'FAIL: invalid ideas accepted';
  end if;

  perform pg_temp.new_idea('Il segreto della papaya');
  perform pg_temp.new_idea('Porcino non si lava');
  i4 := pg_temp.new_idea('Da scartare');
  if public.set_idea_status(i4, 'scartata') <> 'ok' then raise exception 'FAIL: backlog → scartata'; end if;
  if public.set_idea_status(i4, 'backlog') <> 'ok' then raise exception 'FAIL: scartata → backlog'; end if;
  if public.set_idea_status(i4, 'scartata') <> 'ok' then raise exception 'FAIL: backlog → scartata again'; end if;
  if (select decided_at from ideas where id = i4) is null then raise exception 'FAIL: decided_at of a discarded idea'; end if;
  if public.set_idea_status(i4, 'scelta') <> 'invalid_input' then raise exception 'FAIL: status scelta by hand'; end if;

  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
  if public.upsert_idea(null, pg_temp.page(), 'Intrusa', null) ->> 'code' <> 'not_authorized'
     or public.set_idea_status(i4, 'backlog') <> 'not_authorized' then
    raise exception 'FAIL: internal without a role writes ideas';
  end if;
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
  if public.upsert_idea(null, pg_temp.page(), 'Esterna', null) ->> 'code' <> 'not_authorized' then
    raise exception 'FAIL: the external writes ideas';
  end if;
end $$;

-- AC6: a batch from three ideas, then more reels in it, then a second batch
-- of the same month: numbering continues.
do $$
declare
  v jsonb;
  v_batch uuid;
  ids uuid[];
  i5 uuid;
  i6 uuid;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  select array_agg(id order by created_at, title) into ids
    from ideas where page_id = pg_temp.page() and status = 'backlog';
  if cardinality(ids) <> 3 then raise exception 'FAIL: expected 3 backlog ideas, got %', cardinality(ids); end if;

  v := public.create_batch_from_ideas(pg_temp.page(), 2026, 12, ids);
  if v->>'code' <> 'ok' then raise exception 'FAIL: create_batch_from_ideas: %', v; end if;
  v_batch := (v->>'batch_id')::uuid;
  if (select (origin, period, label) from batches where id = v_batch)
     is distinct from ('ideas'::text, '2026-12-01'::date, 'Batch Dicembre'::text) then
    raise exception 'FAIL: the ideas batch';
  end if;
  if (select string_agg(code || ':' || state || ':' || title, ' | ' order by ordinal) from reels where batch_id = v_batch)
     <> 'PP-2612-01:idea:Funghi e luna piena | PP-2612-02:idea:Il segreto della papaya | PP-2612-03:idea:Porcino non si lava' then
    raise exception 'FAIL: reels of the ideas batch: %',
      (select string_agg(code || ':' || state || ':' || title, ' | ' order by ordinal) from reels where batch_id = v_batch);
  end if;
  if exists (select 1 from ideas i where i.id = any (ids)
              and (i.status <> 'scelta' or i.reel_id is null or i.decided_at is null
                   or (select r.title from reels r where r.id = i.reel_id) <> i.title)) then
    raise exception 'FAIL: chosen ideas not linked to their reels';
  end if;
  -- A chosen idea never goes back.
  if public.set_idea_status(ids[1], 'backlog') <> 'invalid_state'
     or public.upsert_idea(ids[1], null, 'Cambiato', null) ->> 'code' <> 'invalid_state' then
    raise exception 'FAIL: a chosen idea changed';
  end if;

  i5 := pg_temp.new_idea('Quinta');
  if public.create_batch_from_ideas(pg_temp.page(), null, null, array[i5], v_batch) ->> 'code' <> 'ok' then
    raise exception 'FAIL: adding an idea to the ideas batch';
  end if;
  if (select (code, batch_id) from reels where title = 'Quinta') is distinct from ('PP-2612-04'::text, v_batch) then
    raise exception 'FAIL: the added reel: %', (select (code, batch_id) from reels where title = 'Quinta');
  end if;
  i6 := pg_temp.new_idea('Sesta');
  v := public.create_batch_from_ideas(pg_temp.page(), 2026, 12, array[i6]);
  if v->>'code' <> 'ok' or (select code from reels where title = 'Sesta') is distinct from 'PP-2612-05'
     or (v->>'batch_id')::uuid = v_batch then
    raise exception 'FAIL: a second batch of the same month does not continue the numbering';
  end if;
end $$;

-- AC5/AC6 for the admin, and numbering after the codes of an import batch
-- of the same month (PP-2610-01…03).
do $$ declare v jsonb; i8 uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
  v := public.upsert_idea(null, pg_temp.page(), 'Ottava', null);
  if v->>'code' <> 'ok' then raise exception 'FAIL: admin upsert_idea: %', v; end if;
  i8 := (v->>'id')::uuid;
  if public.set_idea_status(i8, 'scartata') <> 'ok' or public.set_idea_status(i8, 'backlog') <> 'ok' then
    raise exception 'FAIL: admin set_idea_status';
  end if;
  v := public.create_batch_from_ideas(pg_temp.page(), 2026, 10, array[i8]);
  if v->>'code' <> 'ok' then raise exception 'FAIL: admin create_batch_from_ideas: %', v; end if;
  if (select code from reels where title = 'Ottava') is distinct from 'PP-2610-04' then
    raise exception 'FAIL: numbering after an import batch: %', (select code from reels where title = 'Ottava');
  end if;
end $$;

-- Refusals: nothing is written.
do $$
declare
  n_batches bigint := (select count(*) from batches);
  n_reels bigint := (select count(*) from reels);
  i7 uuid;
  chosen uuid := (select id from ideas where status = 'scelta' and source = 'manuale' limit 1);
  discarded uuid := (select id from ideas where status = 'scartata' limit 1);
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  i7 := pg_temp.new_idea('Settima');
  if public.create_batch_from_ideas(pg_temp.page(), 2026, 12, array[i7, chosen]) ->> 'code' <> 'invalid_input'
     or public.create_batch_from_ideas(pg_temp.page(), 2026, 12, array[i7, '90000000-0000-0000-0000-0000000000c2'::uuid]) ->> 'code' <> 'invalid_input'
     or public.create_batch_from_ideas(pg_temp.page(), 2026, 12, array[discarded]) ->> 'code' <> 'invalid_input'
     or public.create_batch_from_ideas(pg_temp.page(), 2026, 12, array[i7, i7]) ->> 'code' <> 'invalid_input'
     or public.create_batch_from_ideas(pg_temp.page(), 2026, 12, '{}') ->> 'code' <> 'invalid_input'
     or public.create_batch_from_ideas(pg_temp.page(), 2026, 13, array[i7]) ->> 'code' <> 'invalid_input'
     or public.create_batch_from_ideas(pg_temp.page(), null, null, array[i7],
          '20000000-0000-0000-0000-000000000001') ->> 'code' <> 'invalid_input'
     or public.create_batch_from_ideas(pg_temp.page(), null, null, array[i7],
          '20000000-0000-0000-0000-0000000000c2') ->> 'code' <> 'invalid_input'
     or public.create_batch_from_ideas(pg_temp.page(), null, null, array[i7],
          '20000000-0000-0000-0000-0000000000c3') ->> 'code' <> 'invalid_input' then
    raise exception 'FAIL: create_batch_from_ideas accepted an invalid request';
  end if;
  -- A code collision while writing: stale, and the new batch is rolled back.
  if public.create_batch_from_ideas(pg_temp.page(), 2026, 11, array[i7, pg_temp.new_idea('Collisione')]) ->> 'code' <> 'stale' then
    raise exception 'FAIL: a code collision is not reported as stale';
  end if;
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
  if public.create_batch_from_ideas(pg_temp.page(), 2026, 12, array[i7]) ->> 'code' <> 'not_authorized' then
    raise exception 'FAIL: internal without a role created a batch';
  end if;
  if (select count(*) from batches) <> n_batches or (select count(*) from reels) <> n_reels
     or (select status from ideas where id = i7) <> 'backlog' then
    raise exception 'FAIL: a refused request wrote rows';
  end if;
end $$;

-- No doc idea for reels of ideas batches; no direct writes; externals read nothing.
reset role;
insert into tasks (reel_id, kind, status, assignee_id, started_at, accepted_at) values
  ('30000000-0000-0000-0000-000000000002', 'animation', 'in_progress',
   '00000000-0000-0000-0000-00000000000e', now(), now());
set role authenticated;
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
  if (select count(*) from ideas where source = 'doc') <> 3 then
    raise exception 'FAIL: doc ideas for reels of ideas batches';
  end if;
  begin
    insert into ideas (page_id, title) values (pg_temp.page(), 'Diretta');
    raise exception 'FAIL: direct insert into ideas';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
  if (select count(*) from reels) <> 1 or (select count(*) from ideas) <> 0 then
    raise exception 'FAIL: the external reads ideas';
  end if;
end $$;
reset role;

rollback;
