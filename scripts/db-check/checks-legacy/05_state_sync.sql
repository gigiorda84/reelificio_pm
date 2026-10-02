-- State/phase sync BEFORE the Fase 1 contract (run by upgrade.sh after the
-- expand, on seed.sql): the Fase 0 code moves phase or posted_url and the
-- state follows; its Publish save, which sends every column, never moves a
-- reel the engine placed (I4).

-- Phase drives state (Fase 0 code until the contract): decide_phase_advance
-- and posted_url.
update reels set phase = 'editing', phase_entered_at = now() where id = '30000000-0000-0000-0000-000000000001';
do $$ begin
  if (select state from reels where id = '30000000-0000-0000-0000-000000000001') <> 'animazione' then
    raise exception 'FAIL: legacy phase change did not update state';
  end if;
end $$;
update reels set posted_url = 'https://instagram.com/p/y' where id = '30000000-0000-0000-0000-000000000001';
do $$ begin
  if (select (state, phase)::text from reels where id = '30000000-0000-0000-0000-000000000001')
     <> '(pubblicato,publication)' then
    raise exception 'FAIL: posted_url did not publish';
  end if;
end $$;
update reels set posted_url = null where id = '30000000-0000-0000-0000-000000000001';

-- I4: the Fase 0 Publish tab saves every column; unchanged values must not
-- move a reel the engine placed in revisione / confermato / approvazione_finale.
do $$ declare s reel_state; n int; begin
  foreach s in array array['revisione', 'confermato', 'approvazione_finale']::reel_state[] loop
    update reels set state = s where id = '30000000-0000-0000-0000-000000000001';
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
    update reels
       set title = title, caption = 'c', scheduled_at = scheduled_at, posted_url = posted_url,
           audio_drive_url = audio_drive_url, video_drive_url = video_drive_url
     where id = '30000000-0000-0000-0000-000000000001';
    get diagnostics n = row_count;
    reset role;
    if n <> 1 then raise exception 'FAIL: member save refused (state %)', s; end if;
    if (select state from reels where id = '30000000-0000-0000-0000-000000000001') <> s then
      raise exception 'FAIL: an unchanged save moved the reel out of %', s;
    end if;
  end loop;
end $$;

rollback;
