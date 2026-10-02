-- Scale: published reels leave the active set; aggregates and stuck detection.
-- Since the Fase 1 contract a reel is published only through publish_reel().

-- Reel 2 is ready to publish (programmato, no open task).
update reels set state = 'programmato' where id = '30000000-0000-0000-0000-000000000002';

set role authenticated;

-- Not the SMM nor in publication RACI: refused.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if public.publish_reel('30000000-0000-0000-0000-000000000002', 'https://instagram.com/p/x') <> 'not_authorized' then
    raise exception 'FAIL: a member outside publication published';
  end if;
end $$;

-- The admin publishes: published_at stamped, state and phase follow.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if public.publish_reel('30000000-0000-0000-0000-000000000002', 'not a url') <> 'invalid_input' then
    raise exception 'FAIL: publish_reel accepted a bad URL';
  end if;
  if public.publish_reel('30000000-0000-0000-0000-000000000002', 'https://instagram.com/p/x') <> 'ok' then
    raise exception 'FAIL: admin could not publish';
  end if;
end $$;
do $$ begin
  if (select (published_at is not null, state, phase)::text from reels
       where id = '30000000-0000-0000-0000-000000000002') <> '(t,pubblicato,publication)' then
    raise exception 'FAIL: publication did not stamp published_at and move the state';
  end if;
  if public.publish_reel('30000000-0000-0000-0000-000000000002', 'https://instagram.com/p/x') <> 'invalid_state' then
    raise exception 'FAIL: published twice';
  end if;
  if public.publish_reel('30000000-0000-0000-0000-000000000001', 'https://instagram.com/p/y') <> 'invalid_state' then
    raise exception 'FAIL: published a reel that is not programmato';
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

-- stuck_reels is cron-only.
do $$ begin
  begin
    perform public.stuck_reels(now());
    raise exception 'FAIL: authenticated user could call stuck_reels';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Stuck detection: old phase entry and no recent comment; a fresh comment
-- clears it; published reels are never stuck.
reset role;
update reels set phase_entered_at = now() - interval '3 days';
do $$ begin
  if (select count(*) from public.stuck_reels(now() - interval '24 hours')) <> 1 then
    raise exception 'FAIL: expected 1 stuck reel';
  end if;
end $$;
insert into comments (target_type, target_id, author_id, body)
values ('reel', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'ci sto lavorando');
do $$ begin
  if (select count(*) from public.stuck_reels(now() - interval '24 hours')) <> 0 then
    raise exception 'FAIL: a recent comment did not clear the stuck reel';
  end if;
end $$;

rollback;
