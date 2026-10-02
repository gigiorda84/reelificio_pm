-- Forward again after re-contract: fase1_reconcile_tasks() aligns the tasks
-- with the states the Fase 0 code left, idempotently; afterwards every reel
-- is in the state its tasks derive.

do $$
declare
  v_first jsonb := public.fase1_reconcile_tasks();
  v_second jsonb := public.fase1_reconcile_tasks();
begin
  if (v_first ->> 'cancelled')::int <> 2 or (v_first ->> 'created')::int <> 1 then
    raise exception 'FAIL: reconcile returned %', v_first;
  end if;
  if (v_second ->> 'cancelled')::int <> 0 or (v_second ->> 'created')::int <> 0 then
    raise exception 'FAIL: reconcile not idempotent: %', v_second;
  end if;
end $$;

do $$ declare v_bad text; begin
  -- LG-04 now has an animation task (titular or RACI), paused and silent.
  if (select t.kind::text || '/' || t.origin || '/' || t.escalation_paused
        from tasks t join reels r on r.id = t.reel_id
       where r.code = 'LG-2609-04' and t.status in ('unassigned', 'assigned', 'in_progress'))
     <> 'animation/migration/true' then
    raise exception 'FAIL: LG-04 animation task not created by the reconciliation';
  end if;
  if exists (select 1 from tasks t join reels r on r.id = t.reel_id
              where r.code = 'LG-2609-07' and t.status in ('unassigned', 'assigned', 'in_progress')) then
    raise exception 'FAIL: published LG-07 kept an open task';
  end if;
  if (select count(*) from task_events where op = 'reconcile') <> 3 then
    raise exception 'FAIL: reconcile events';
  end if;

  select string_agg(code || ':' || state || '≠' || coalesce(private.derived_state(id)::text, 'null'), ', ')
    into v_bad
    from reels where state is distinct from private.derived_state(id);
  if v_bad is not null then
    raise exception 'FAIL: incoherent reels after reconciling: %', v_bad;
  end if;
end $$;
