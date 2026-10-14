-- Fase 2 S4 — script versions (docs/fase2-plan.md D-E, AC16–19, §7.2).
-- Users from seed.sql: a admin · b Responsible script_writing (page
-- member) · c internal without a role · d RACI approver (page member) ·
-- e external dubber. Reel 1 is in bozza (phase script_writing).

create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_id, false);
$$;
create function pg_temp.r1() returns uuid language sql immutable as $$
  select '30000000-0000-0000-0000-000000000001'::uuid;
$$;
create function pg_temp.rev() returns integer language sql as $$
  select script_rev from reels where id = pg_temp.r1();
$$;
create function pg_temp.nver() returns bigint language sql as $$
  select count(*) from script_versions where reel_id = pg_temp.r1() and source <> 'ai';
$$;
create function pg_temp.last() returns script_versions language sql as $$
  select * from script_versions where reel_id = pg_temp.r1() and source <> 'ai'
   order by created_at desc, script_rev desc nulls last limit 1;
$$;

-- Fixture: b holds the writing task of reel 1 (bozza); two fake AI
-- alternatives on reel 1; a reel born with text (Doc import).
insert into tasks (id, reel_id, kind, status, assignee_id, started_at) values
  ('50000000-0000-0000-0000-000000000c01', pg_temp.r1(), 'writing', 'in_progress',
   '00000000-0000-0000-0000-00000000000b', now());
insert into script_versions (id, reel_id, source, model, hook, corpo, chiusura, cta, notes) values
  ('80000000-0000-0000-0000-00000000000a', pg_temp.r1(), 'ai', 'm/alpha', 'Hook A', 'Corpo A', 'Chiusura A', 'CTA A', 'Regia A'),
  ('80000000-0000-0000-0000-00000000000b', pg_temp.r1(), 'ai', 'm/beta', 'Hook B', 'Corpo B', 'Chiusura B', 'CTA B', 'Regia B');
insert into reels (id, batch_id, page_id, code, ordinal, title, phase, hook) values
  ('30000000-0000-0000-0000-0000000000c3', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-09', 9, 'Importato', 'script_writing', 'Hook importato');

do $$ begin
  -- Import: a reel inserted with text has one `import` version; one without none.
  if (select count(*) from script_versions where reel_id = '30000000-0000-0000-0000-0000000000c3' and source = 'import') <> 1
     or pg_temp.nver() <> 0 then
    raise exception 'FAIL: import versions on insert';
  end if;
  -- The four RPCs run as the caller (D-E).
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosecdef
                and p.proname in ('save_reel_script', 'apply_script_version', 'restore_script_version',
                                  'reel_script_provenance')) then
    raise exception 'FAIL: a script RPC is SECURITY DEFINER';
  end if;
end $$;

set role authenticated;

-- Form (manuale): one version per real change, none for the same text or a
-- title; stale, sources and keys refused.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ declare v0 integer := pg_temp.rev(); begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  if public.save_reel_script(pg_temp.r1(), '{"hook": "H1", "corpo": "C1"}', v0) <> 'ok' then
    raise exception 'FAIL: Responsible save_reel_script';
  end if;
  if pg_temp.rev() <> v0 + 1 or pg_temp.nver() <> 1 or (pg_temp.last()).source <> 'manuale'
     or (pg_temp.last()).author_id <> '00000000-0000-0000-0000-00000000000b'
     or (pg_temp.last()).hook <> 'H1' or (pg_temp.last()).script_rev <> v0 + 1 then
    raise exception 'FAIL: manual version (rev %, versions %)', pg_temp.rev(), pg_temp.nver();
  end if;
  if public.save_reel_script(pg_temp.r1(), '{"hook": "H1", "title": "Nuovo titolo"}', v0 + 1) <> 'ok'
     or pg_temp.nver() <> 1 or pg_temp.rev() <> v0 + 1 then
    raise exception 'FAIL: a version without a text change';
  end if;
  if public.save_reel_script(pg_temp.r1(), '{"hook": "vecchio"}', v0) <> 'stale' then
    raise exception 'FAIL: old revision not stale';
  end if;
  if public.save_reel_script(pg_temp.r1(), '{"hook": "x"}', v0 + 1, 'resync') <> 'invalid_input'
     or public.save_reel_script(pg_temp.r1(), '{"hook": "x"}', v0 + 1, 'mix') <> 'invalid_input'
     or public.save_reel_script(pg_temp.r1(), '{"code": "XX"}', v0 + 1) <> 'invalid_input'
     or public.save_reel_script(pg_temp.r1(), '{"format": "nessuno"}', v0 + 1) <> 'invalid_input'
     or public.save_reel_script('30000000-0000-0000-0000-0000000000ff', '{"hook": "x"}', 0) <> 'invalid_input' then
    raise exception 'FAIL: refused sources, keys, enum values or reel';
  end if;
  if pg_temp.nver() <> 1 then raise exception 'FAIL: a refused save left a version'; end if;

  -- Re-sync: admins only, source `resync`.
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
  if public.save_reel_script(pg_temp.r1(), '{"corpo": "C dal Doc"}', v0 + 1, 'resync') <> 'ok'
     or (pg_temp.last()).source <> 'resync' then
    raise exception 'FAIL: admin re-sync version';
  end if;
end $$;

-- Parity (D-E): save_reel_script succeeds exactly when a direct update of
-- the same user would. Each attempt is rolled back.
do $$
declare
  u text;
  v_direct boolean;
  v_rpc text;
  v_id uuid;
  v_bad text;
begin
  foreach u in array array['a', 'b', 'c', 'd', 'e'] loop
    perform pg_temp.as_user('00000000-0000-0000-0000-00000000000' || u);
    begin
      update reels set notes = 'parità ' || u where id = pg_temp.r1() returning id into v_id;
      v_direct := v_id is not null;
      raise exception 'undo';
    exception when raise_exception then null;
    end;
    begin
      v_rpc := public.save_reel_script(pg_temp.r1(), jsonb_build_object('notes', 'parità ' || u), pg_temp.rev());
      raise exception 'undo';
    exception when raise_exception then null;
    end;
    if v_direct <> (v_rpc = 'ok') then
      v_bad := coalesce(v_bad || ', ', '') || u || ': direct ' || v_direct || ' rpc ' || v_rpc;
    end if;
    v_id := null;
  end loop;
  if v_bad is not null then raise exception 'FAIL: parity with the direct update: %', v_bad; end if;
end $$;

-- Mix (AC16) and provenance (AC18).
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ declare v0 integer := pg_temp.rev(); v jsonb; begin
  -- Internal without a role: refused by RLS; RACI approver: passes RLS,
  -- refused by the compose check.
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
  if public.apply_script_version(pg_temp.r1(), '80000000-0000-0000-0000-00000000000a', '{}', v0) <> 'not_authorized' then
    raise exception 'FAIL: internal without a role mixed';
  end if;
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
  if public.apply_script_version(pg_temp.r1(), '80000000-0000-0000-0000-00000000000a', '{}', v0) <> 'not_authorized' then
    raise exception 'FAIL: the RACI approver mixed';
  end if;

  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  if public.apply_script_version(pg_temp.r1(), '80000000-0000-0000-0000-00000000000a',
       '{"cta": "80000000-0000-0000-0000-00000000000b"}', v0 - 1) <> 'stale'
     or public.apply_script_version(pg_temp.r1(), '80000000-0000-0000-0000-00000000000a',
       '{"titolo": "80000000-0000-0000-0000-00000000000b"}', v0) <> 'invalid_input'
     or public.apply_script_version(pg_temp.r1(), '80000000-0000-0000-0000-00000000000a',
       '{"cta": "non-un-uuid"}', v0) <> 'invalid_input'
     or public.apply_script_version(pg_temp.r1(),
       (select id from script_versions where reel_id = '30000000-0000-0000-0000-0000000000c3'), '{}', v0) <> 'invalid_input' then
    raise exception 'FAIL: mix refusals (stale, block, id, version of another reel)';
  end if;
  if public.apply_script_version(pg_temp.r1(), '80000000-0000-0000-0000-00000000000a',
       '{"cta": "80000000-0000-0000-0000-00000000000b"}', v0) <> 'ok' then
    raise exception 'FAIL: Responsible mix';
  end if;
  if (select (hook, corpo, chiusura, cta, notes) from reels where id = pg_temp.r1())
     is distinct from ('Hook A'::text, 'Corpo A'::text, 'Chiusura A'::text, 'CTA B'::text, 'Regia A'::text)
     or pg_temp.rev() <> v0 + 1 or (pg_temp.last()).source <> 'mix'
     or (pg_temp.last()).base_version_id <> '80000000-0000-0000-0000-00000000000a'
     or (pg_temp.last()).block_sources->>'cta' <> '80000000-0000-0000-0000-00000000000b'
     or (pg_temp.last()).block_sources->>'hook' <> '80000000-0000-0000-0000-00000000000a' then
    raise exception 'FAIL: mix result';
  end if;

  v := public.reel_script_provenance(pg_temp.r1());
  if v->>'base_model' <> 'm/alpha' or v->'blocks'->>'cta' <> 'm/beta' or v->'blocks'->>'hook' <> 'm/alpha'
     or (v->>'edited_after_mix')::boolean then
    raise exception 'FAIL: provenance right after the mix: %', v;
  end if;
  if public.save_reel_script(pg_temp.r1(), '{"hook": "Hook A rivisto"}', v0 + 1) <> 'ok' then
    raise exception 'FAIL: manual edit after the mix';
  end if;
  v := public.reel_script_provenance(pg_temp.r1());
  if v->'blocks'->>'hook' <> 'manuale' or v->'blocks'->>'corpo' <> 'm/alpha'
     or not (v->>'edited_after_mix')::boolean or v->>'last_source' <> 'manuale' then
    raise exception 'FAIL: provenance after a manual edit: %', v;
  end if;
end $$;

-- Restore (AC17).
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ declare v0 integer := pg_temp.rev(); v_first uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  select id into v_first from script_versions
   where reel_id = pg_temp.r1() and source = 'manuale' order by script_rev limit 1;
  if public.restore_script_version(pg_temp.r1(), v_first, v0) <> 'ok' then
    raise exception 'FAIL: restore';
  end if;
  if (pg_temp.last()).source <> 'ripristino' or (pg_temp.last()).restored_from_id <> v_first
     or (select hook from reels where id = pg_temp.r1()) <> 'H1' then
    raise exception 'FAIL: restore result';
  end if;
end $$;

-- From revisione (AC19): text locked for non-admins, mix and restore refused,
-- an accepted proposal recorded as `proposta`.
reset role;
update reels set state = 'revisione' where id = pg_temp.r1();
update tasks set status = 'delivered', closed_at = now() where id = '50000000-0000-0000-0000-000000000c01';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ declare v0 integer := pg_temp.rev(); n bigint := pg_temp.nver(); v_prop uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  begin
    update reels set hook = 'diretto' where id = pg_temp.r1();
    raise exception 'FAIL: direct text update in revisione';
  exception when insufficient_privilege then null;
  end;
  if public.save_reel_script(pg_temp.r1(), '{"hook": "via rpc"}', v0) <> 'not_authorized'
     or public.apply_script_version(pg_temp.r1(), '80000000-0000-0000-0000-00000000000a', '{}', v0) <> 'invalid_state'
     or public.restore_script_version(pg_temp.r1(), '80000000-0000-0000-0000-00000000000a', v0) <> 'invalid_state' then
    raise exception 'FAIL: writes in revisione not refused';
  end if;
  if pg_temp.nver() <> n then raise exception 'FAIL: a refused write left a version'; end if;

  if public.propose_text_change(pg_temp.r1(), 'cta', 'CTA proposta') <> 'ok' then
    raise exception 'FAIL: proposal';
  end if;
  select id into v_prop from text_change_proposals where reel_id = pg_temp.r1() and status = 'pending';
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
  if public.decide_text_proposal(v_prop, 'accepted') <> 'ok' then
    raise exception 'FAIL: accepting the proposal';
  end if;
  if (pg_temp.last()).source <> 'proposta' or (pg_temp.last()).proposal_id <> v_prop
     or (pg_temp.last()).cta <> 'CTA proposta' then
    raise exception 'FAIL: accepted proposal not recorded as proposta (%)', (pg_temp.last()).source;
  end if;

  -- An admin typing in revisione: `manuale`.
  if public.save_reel_script(pg_temp.r1(), '{"corpo": "Corpo admin"}', pg_temp.rev()) <> 'ok'
     or (pg_temp.last()).source <> 'manuale' then
    raise exception 'FAIL: admin edit in revisione';
  end if;
end $$;

-- Externals read no version (Q7), not even on a reel they work on.
reset role;
insert into tasks (reel_id, kind, status, assignee_id, started_at, accepted_at) values
  ('30000000-0000-0000-0000-000000000002', 'animation', 'in_progress',
   '00000000-0000-0000-0000-00000000000e', now(), now());
insert into script_versions (reel_id, source, hook) values ('30000000-0000-0000-0000-000000000002', 'manuale', 'x');
set role authenticated;
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
  if (select count(*) from reels) <> 1 or (select count(*) from script_versions) <> 0 then
    raise exception 'FAIL: the external reads script versions';
  end if;
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
  if (select count(*) from script_versions) = 0 then
    raise exception 'FAIL: internals cannot read the history';
  end if;
  begin
    insert into script_versions (reel_id, source) values (pg_temp.r1(), 'manuale');
    raise exception 'FAIL: direct insert into script_versions';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
