-- Reels: writes limited to admins and page members, phase columns locked.

set role authenticated;

-- Outsider: can read, cannot edit.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ declare n int; begin
  if (select count(*) from reels) <> 2 then raise exception 'FAIL: outsider cannot read reels'; end if;
  update reels set title = 'x' where id = '30000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: outsider edited a reel'; end if;
  delete from reels where id = '30000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: outsider deleted a reel'; end if;
end $$;

-- Member (Responsible on the page): edits content, not phase; cannot insert.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ declare n int; begin
  update reels set title = 'Titolo nuovo', caption = 'caption' where id = '30000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: member could not edit content (% rows)', n; end if;
end $$;

do $$ begin
  begin
    update reels set phase = 'publication' where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: member changed phase directly';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$ begin
  begin
    insert into reels (batch_id, page_id, code, ordinal, title)
    values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'PP-2610-09', 9, 'x');
    raise exception 'FAIL: member inserted a reel';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Approver counts as a member too.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
do $$ declare n int; begin
  update reels set notes = 'nota' where id = '30000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: approver could not edit content'; end if;
end $$;

-- Admin: inserts and deletes; phase still only via decide_phase_advance().
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ declare n int; begin
  insert into reels (batch_id, page_id, code, ordinal, title)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'PP-2610-03', 3, 'Reel tre');
  delete from reels where code = 'PP-2610-03';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: admin could not delete'; end if;
end $$;

do $$ begin
  begin
    update reels set phase = 'publication' where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: admin changed phase directly';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
