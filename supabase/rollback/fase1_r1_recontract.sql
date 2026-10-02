-- Fase 1 R1 contract (docs/fase1-plan.md §S2, §8 step 7): switches off the
-- Fase 0 paths once the new code is deployed. Re-runnable.
--
-- Used three ways:
-- - becomes the migration <ts>_fase1_r1_contract.sql in its own commit at the
--   end of S4 (tag fase1-r1), so its timestamp follows every expand migration;
-- - until then scripts/db-check/run.sh applies it from here;
-- - after an uncontract, going forward again: this file, then
--   `select fase1_reconcile_tasks();` (§6).

-- Phase advance: no more decisions or new requests; pending ones are closed.
revoke execute on function public.decide_phase_advance(uuid, phase_advance_status, text) from authenticated;
drop policy if exists phase_advance_requests_insert_responsible on phase_advance_requests;
update phase_advance_requests
   set status = 'cancelled', decided_at = now(), decision_note = '[migrazione Fase 1]'
 where status = 'pending';

-- Publication goes through publish_reel() only.
revoke update (posted_url) on table reels from authenticated;

-- phase follows state, never the other way round any more.
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
    raise exception 'phase_without_state: phase and publication change only with the state'
      using errcode = '42501';
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
