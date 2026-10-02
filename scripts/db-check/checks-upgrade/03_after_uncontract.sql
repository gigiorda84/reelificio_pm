-- After an uncontract the Fase 0 code (deployment fase1-pre-r1) works again:
-- the Responsible files a request, the approver decides, a member posts the
-- URL. State follows, tasks are left behind (reconciled later). No
-- `using (true)` policy came back (the guards run next, in expand mode).

set role authenticated;

-- D (Responsible dubbing) asks to move LG-04 dubbing → editing; P approves.
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000003', false);
insert into phase_advance_requests (id, reel_id, from_phase, to_phase, requested_by, status)
values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004',
        'dubbing', 'editing', auth.uid(), 'pending');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000006', false);
do $$ begin
  if public.decide_phase_advance('e0000000-0000-0000-0000-000000000001', 'approved') <> 'ok' then
    raise exception 'FAIL: legacy approval refused after the uncontract';
  end if;
end $$;

-- S (Responsible publication) posts LG-07, which has an open scheduling task.
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000005', false);
update reels set posted_url = 'https://instagram.com/p/legacy07' where code = 'LG-2609-07';

reset role;
do $$ begin
  if (select state::text || '/' || phase from reels where code = 'LG-2609-04') <> 'animazione/editing' then
    raise exception 'FAIL: legacy advance did not move the state';
  end if;
  if (select state from reels where code = 'LG-2609-07') <> 'pubblicato' then
    raise exception 'FAIL: legacy posting did not publish';
  end if;
  -- Left behind for the reconciliation: a dubbing task on an animating reel,
  -- a scheduling task on a published one.
  if (select count(*) from tasks t join reels r on r.id = t.reel_id
       where r.code in ('LG-2609-04', 'LG-2609-07') and t.status in ('unassigned', 'assigned', 'in_progress')) <> 2 then
    raise exception 'FAIL: expected two stale open tasks before reconciling';
  end if;
end $$;
