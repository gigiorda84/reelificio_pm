-- Fase 1 R1 uncontract (docs/fase1-plan.md §6, rollback level 2): lets the
-- Fase 0 code (deployment fase1-pre-r1) run again after the contract.
--
-- Restores only what the contract took away: the grant on
-- decide_phase_advance, the insert policy of phase-advance requests, the
-- grant on posted_url and the permissive state/phase trigger. It never
-- restores a `using (true)` policy and never drops a table: tasks,
-- proposals and deliveries stay, and external accounts stay isolated.
-- Forward again: deploy the new code, run fase1_r1_recontract.sql, then
-- `select fase1_reconcile_tasks();`.

grant execute on function public.decide_phase_advance(uuid, phase_advance_status, text) to authenticated;

drop policy if exists phase_advance_requests_insert_responsible on phase_advance_requests;
create policy phase_advance_requests_insert_responsible on phase_advance_requests
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and status = 'pending'
    and exists (
      select 1
      from reels r
      where r.id = reel_id
        and r.phase = from_phase
        and (public.is_admin() or public.has_raci_role(r.page_id, r.phase, 'responsible'))
    )
  );

grant update (posted_url) on table reels to authenticated;

-- Permissive trigger of the expand (20261002141707_fase1_core.sql): phase or
-- published_at moved by the Fase 0 code drag the state along.
create or replace function private.reels_sync_state()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_phase pipeline_phase;
begin
  if tg_op = 'INSERT' then
    if new.phase = 'research_prescript' and new.published_at is null then
      new.phase := public.state_raci_phase(new.state);
    else
      new.state := private.legacy_phase_to_state(new.phase, new.published_at);
      new.phase := public.state_raci_phase(new.state);
    end if;
    return new;
  end if;

  if new.state is distinct from old.state then
    new.state_entered_at := now();
  elsif new.phase is distinct from old.phase
     or new.published_at is distinct from old.published_at then
    new.state := private.legacy_phase_to_state(new.phase, new.published_at);
    if new.state is distinct from old.state then
      new.state_entered_at := now();
    end if;
  end if;

  v_phase := public.state_raci_phase(new.state);
  if new.phase is distinct from v_phase then
    new.phase := v_phase;
  end if;
  if new.phase is distinct from old.phase
     and new.phase_entered_at is not distinct from old.phase_entered_at then
    new.phase_entered_at := now();
  end if;

  if (new.hook, new.corpo, new.chiusura, new.cta, new.notes, new.raw_content)
     is distinct from (old.hook, old.corpo, old.chiusura, old.cta, old.notes, old.raw_content) then
    new.script_rev := old.script_rev + 1;
  else
    new.script_rev := old.script_rev;
  end if;
  return new;
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
