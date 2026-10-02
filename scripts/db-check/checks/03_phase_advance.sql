-- Phase advance after the Fase 1 contract: the Fase 0 path is switched off.
-- (Its behaviour before the contract: checks-legacy/03_phase_advance.sql,
-- run by upgrade.sh.)

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

do $$ begin
  begin
    perform public.decide_phase_advance(gen_random_uuid(), 'approved');
    raise exception 'FAIL: decide_phase_advance still executable';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into phase_advance_requests (reel_id, from_phase, to_phase, requested_by, status)
    values ('30000000-0000-0000-0000-000000000001', 'script_writing', 'dubbing', auth.uid(), 'pending');
    raise exception 'FAIL: phase advance request accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

-- phase moves only with the state, for every role.
reset role;
do $$ begin
  begin
    update reels set phase = 'dubbing' where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: phase changed without the state';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
