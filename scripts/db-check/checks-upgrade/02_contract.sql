-- After the contract on the legacy fixture: the pending request is closed
-- with the migration note, the old phase path refuses, publication is
-- through publish_reel only.

do $$ begin
  if (select status::text || '/' || decision_note from phase_advance_requests)
     <> 'cancelled/[migrazione Fase 1]' then
    raise exception 'FAIL: pending request not cancelled by the contract';
  end if;
  if has_function_privilege('authenticated',
       'public.decide_phase_advance(uuid, phase_advance_status, text)', 'EXECUTE') then
    raise exception 'FAIL: decide_phase_advance still executable';
  end if;
  if has_column_privilege('authenticated', 'public.reels', 'posted_url', 'UPDATE') then
    raise exception 'FAIL: posted_url still writable';
  end if;
  begin
    update reels set phase = 'editing' where code = 'LG-2609-04';
    raise exception 'FAIL: phase moved without the state';
  exception when insufficient_privilege then null;
  end;
end $$;
