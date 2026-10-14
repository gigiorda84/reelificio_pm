-- Fase 2, release A (docs/fase2-plan.md D-A). Files in supabase/fase2/ are
-- not migrations: `supabase db push` never reads this folder, run.sh applies
-- it after the R1 contract, and scripts/fase2-promote.sh moves it into
-- supabase/migrations/ with fresh timestamps only at the release, after R2.
--
-- Guard on the two Fase 1 functions that Fase 2 rewrites
-- (private.start_writing and public.claim_jobs). Their bodies are pinned by
-- md5: an R1 or R2 hotfix that changes either one makes run.sh fail here, so
-- the Fase 2 rewrite is re-based instead of silently overwriting the hotfix.
-- Every file stays re-runnable (sandbox re-migration, upgrade.sh restore and
-- forward again): a pin is checked only while the Fase 1 signature exists,
-- and once Fase 2 has rewritten a function its Fase 2 md5 is accepted too.

create or replace function private._assert_body(p_fn regprocedure, p_allowed text[])
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_md5 text;
begin
  select md5(prosrc) into v_md5 from pg_proc where oid = p_fn;
  if v_md5 is null or not (v_md5 = any (p_allowed)) then
    raise exception 'fase2 guard: % has body md5 %, expected one of %: re-base the Fase 2 rewrite on the new body',
      p_fn, v_md5, p_allowed;
  end if;
end;
$$;

do $$
begin
  -- Fase 1 bodies after the R1 contract (fase1_task_engine.sql:734-781 and
  -- :1208-1211, fase1_outbox.sql:23-57). S6 adds the Fase 2 md5s.
  if to_regprocedure('private.start_writing(uuid,uuid,integer)') is not null then
    perform private._assert_body('private.start_writing(uuid,uuid,integer)',
      array['45a97cd5bd98e9fd4a2ca1f4ffcfd08e']);
  end if;
  if to_regprocedure('public.start_writing(uuid,integer)') is not null then
    perform private._assert_body('public.start_writing(uuid,integer)',
      array['ad84a39e5deba53e292ccae94b5f749b']);
  end if;
  perform private._assert_body('public.claim_jobs(integer,interval)',
    array['ae1fa6e2a7b98cc198332b9be6e733a0']);
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
