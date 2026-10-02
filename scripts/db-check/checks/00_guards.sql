-- Guards on the whole catalog (docs/fase1-plan.md §7.2). Catalog queries
-- only — no fixture, no writes — so it also runs read-only against
-- production (release steps 5 and 7):
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD_DB_URL" -f 00_guards.sql
-- Mode (I3): before the contract migration `decide_phase_advance` is still
-- on the allowlist; after it, run with `-c db_check.contract_applied=on`.

do $$
declare
  v_contract boolean := coalesce(current_setting('db_check.contract_applied', true), 'off') = 'on';
  v_allow text[] := array[
    -- Fase 0
    'is_admin', 'has_raci_role', 'is_page_member', 'claim_admin_if_first', 'unlink_telegram',
    'active_reel_counts', 'batch_reel_counts',
    -- Fase 1 (S1)
    'is_internal', 'state_raci_phase', 'visible_reel_ids', 'visible_page_ids', 'holds_open_task',
    'set_app_config', 'profile_names', 'comment_is_visible', 'admin_set_collaborator',
    'offboard_collaborator'
  ];
  v_bad text;
begin
  if not v_contract then
    v_allow := v_allow || 'decide_phase_advance'::text;
  end if;

  -- 1. RLS on every table in public.
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'FAIL: RLS disabled on %', v_bad;
  end if;

  -- 2. No read-everything policy for authenticated or public.
  select string_agg(tablename || '.' || policyname, ', ') into v_bad
  from pg_policies
  where schemaname = 'public'
    and cmd in ('SELECT', 'ALL')
    and qual = 'true'
    and roles && array['authenticated', 'public']::name[];
  if v_bad is not null then
    raise exception 'FAIL: using (true) policies: %', v_bad;
  end if;

  -- 3. Views run with the caller's rights.
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and not exists (
      select 1 from unnest(coalesce(c.reloptions, '{}')) o
       where o in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1'));
  if v_bad is not null then
    raise exception 'FAIL: views without security_invoker: %', v_bad;
  end if;

  -- 4. Functions callable by users: the allowlist only; nothing for anon.
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and p.proname <> all (v_allow);
  if v_bad is not null then
    raise exception 'FAIL: executable by authenticated, not on the allowlist: %', v_bad;
  end if;
  if v_contract then
    select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'decide_phase_advance'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE');
    if v_bad is not null then
      raise exception 'FAIL: contract applied but still executable: %', v_bad;
    end if;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_bad is not null then
    raise exception 'FAIL: executable by anon: %', v_bad;
  end if;

  -- 5. Actor-explicit functions are for the service role only.
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and 'p_actor' = any (p.proargnames)
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad is not null then
    raise exception 'FAIL: p_actor functions executable by users: %', v_bad;
  end if;

  -- 6. Schema private is not reachable by users.
  if has_schema_privilege('anon', 'private', 'USAGE')
     or has_schema_privilege('authenticated', 'private', 'USAGE') then
    raise exception 'FAIL: USAGE on schema private for anon/authenticated';
  end if;

  -- 7. Every SECURITY DEFINER function pins its search_path.
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if v_bad is not null then
    raise exception 'FAIL: security definer without search_path: %', v_bad;
  end if;
end $$;
