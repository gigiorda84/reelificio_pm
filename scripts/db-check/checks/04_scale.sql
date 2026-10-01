-- Scale: published reels leave the active set; aggregates and stuck detection.

-- Posting a reel stamps published_at; clearing the URL un-publishes it.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
update reels set posted_url = 'https://instagram.com/p/x' where id = '30000000-0000-0000-0000-000000000002';
do $$ begin
  if (select published_at from reels where id = '30000000-0000-0000-0000-000000000002') is null then
    raise exception 'FAIL: posting did not set published_at';
  end if;
  begin
    update reels set published_at = null where id = '30000000-0000-0000-0000-000000000002';
    raise exception 'FAIL: user wrote published_at directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Active counts skip the published reel.
do $$ begin
  if (select coalesce(sum(reel_count), 0) from public.active_reel_counts()) <> 1 then
    raise exception 'FAIL: active_reel_counts includes published reels';
  end if;
  if (select reel_count from public.batch_reel_counts(array['20000000-0000-0000-0000-000000000001'::uuid])) <> 2 then
    raise exception 'FAIL: batch_reel_counts';
  end if;
end $$;

update reels set posted_url = null where id = '30000000-0000-0000-0000-000000000002';
do $$ begin
  if (select published_at from reels where id = '30000000-0000-0000-0000-000000000002') is not null then
    raise exception 'FAIL: clearing posted_url kept published_at';
  end if;
end $$;

-- stuck_reels is cron-only.
do $$ begin
  begin
    perform public.stuck_reels(now());
    raise exception 'FAIL: authenticated user could call stuck_reels';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Stuck detection: old phase entry and no recent comment; a fresh comment clears it.
reset role;
update reels set phase_entered_at = now() - interval '3 days';
do $$ begin
  if (select count(*) from public.stuck_reels(now() - interval '24 hours')) <> 2 then
    raise exception 'FAIL: expected 2 stuck reels';
  end if;
end $$;
insert into comments (target_type, target_id, author_id, body)
values ('reel', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'ci sto lavorando');
do $$ begin
  if (select count(*) from public.stuck_reels(now() - interval '24 hours')) <> 1 then
    raise exception 'FAIL: a recent comment did not clear the stuck reel';
  end if;
end $$;

rollback;
