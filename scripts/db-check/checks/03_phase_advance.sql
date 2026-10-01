-- Phase advance: only the Responsible files, only the Approver decides,
-- the requester can only cancel, DoD and staleness are enforced.

set role authenticated;

-- Outsider cannot file a request.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  begin
    insert into phase_advance_requests (reel_id, from_phase, to_phase, requested_by, status)
    values ('30000000-0000-0000-0000-000000000001', 'script_writing', 'dubbing', auth.uid(), 'pending');
    raise exception 'FAIL: outsider filed a request';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Responsible files a request; cannot approve it themselves.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
insert into phase_advance_requests (id, reel_id, from_phase, to_phase, requested_by, status)
values ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
        'script_writing', 'dubbing', auth.uid(), 'pending');

do $$ begin
  begin
    update phase_advance_requests set status = 'approved' where id = '40000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: requester approved their own request';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$ begin
  if public.decide_phase_advance('40000000-0000-0000-0000-000000000001', 'approved') <> 'not_authorized' then
    raise exception 'FAIL: Responsible (not Approver) could decide';
  end if;
end $$;

-- Approver (not an admin) decides: request and reel move together.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
do $$ declare r text; begin
  r := public.decide_phase_advance('40000000-0000-0000-0000-000000000001', 'approved', 'ok per me');
  if r <> 'ok' then raise exception 'FAIL: approver decision returned %', r; end if;
  if (select phase from reels where id = '30000000-0000-0000-0000-000000000001') <> 'dubbing' then
    raise exception 'FAIL: reel did not advance';
  end if;
  if (select status from phase_advance_requests where id = '40000000-0000-0000-0000-000000000001') <> 'approved' then
    raise exception 'FAIL: request not marked approved';
  end if;
  if public.decide_phase_advance('40000000-0000-0000-0000-000000000001', 'approved') <> 'invalid_input' then
    raise exception 'FAIL: decided an already-decided request';
  end if;
end $$;

-- The Responsible of script_writing is not Responsible of dubbing.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  begin
    insert into phase_advance_requests (reel_id, from_phase, to_phase, requested_by, status)
    values ('30000000-0000-0000-0000-000000000001', 'dubbing', 'editing', auth.uid(), 'pending');
    raise exception 'FAIL: filed a request outside own RACI phase';
  exception when insufficient_privilege then null;
  end;
end $$;

-- DoD gate at decision time (editing -> publication).
insert into phase_advance_requests (id, reel_id, from_phase, to_phase, requested_by, status)
values ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002',
        'editing', 'publication', auth.uid(), 'pending');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
do $$ begin
  if public.decide_phase_advance('40000000-0000-0000-0000-000000000002', 'approved') <> 'dod_incomplete' then
    raise exception 'FAIL: approved without a complete DoD';
  end if;
end $$;
reset role;
insert into reel_dod_items (reel_id, key)
select '30000000-0000-0000-0000-000000000002', k from unnest(enum_range(null::dod_item_key)) k;
set role authenticated;
do $$ begin
  if public.decide_phase_advance('40000000-0000-0000-0000-000000000002', 'approved') <> 'ok' then
    raise exception 'FAIL: approval refused with a complete DoD';
  end if;
end $$;

-- Requester can cancel their own pending request.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into phase_advance_requests (id, reel_id, from_phase, to_phase, requested_by, status)
values ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001',
        'dubbing', 'editing', auth.uid(), 'pending');
do $$ declare n int; begin
  update phase_advance_requests set status = 'cancelled', decided_at = now()
   where id = '40000000-0000-0000-0000-000000000003';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: requester could not cancel'; end if;
end $$;

-- A request filed for a phase the reel has already left is stale.
reset role;
insert into phase_advance_requests (id, reel_id, from_phase, to_phase, requested_by, status)
values ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001',
        'script_writing', 'dubbing', '00000000-0000-0000-0000-00000000000b', 'pending');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if public.decide_phase_advance('40000000-0000-0000-0000-000000000004', 'approved') <> 'stale_request' then
    raise exception 'FAIL: stale request not detected';
  end if;
end $$;

reset role;
rollback;
