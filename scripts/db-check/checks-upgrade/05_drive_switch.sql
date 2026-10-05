-- R1 → R2 (I13): the Drive migration was applied on top of reels the R1
-- engine left in flight (seed-r1-in-flight.sql), then
-- fase1-r2-enable-drive.sql (Drive on, backfill). The job simulated (folder id, then mark_drive_reconciled), and every open R1
-- task closes up to programmato with no kit_not_ready or file_missing; the
-- tasks created afterwards follow Drive.

create function pg_temp.reel(p_n integer) returns uuid language sql immutable as $$
  select ('e0000000-0000-0000-0000-00000000000' || p_n)::uuid;
$$;
create function pg_temp.task(p_n integer) returns tasks language sql as $$
  select * from tasks where reel_id = pg_temp.reel(p_n) and status in ('unassigned', 'assigned', 'in_progress');
$$;
create function pg_temp.act(p_actor uuid, p_n integer, p_op text, p_payload jsonb default null)
returns void language plpgsql as $$
declare
  v text := private.task_action_core(p_actor, (pg_temp.task(p_n)).id, p_op, null, p_payload, 'app');
begin
  if v <> 'ok' then
    raise exception 'FAIL: reel % %: %', p_n, p_op, v;
  end if;
end $$;
create function pg_temp.reconcile(p_n integer) returns void language plpgsql as $$
declare
  s jsonb := public.drive_desired_state(pg_temp.reel(p_n));
begin
  if (s ->> 'folder_needed')::boolean and s -> 'reel' ->> 'folder_id' is null then
    perform public.save_drive_folder(pg_temp.reel(p_n), 'reel', 'folder_rr_' || p_n || '_xxxx');
  end if;
  if public.mark_drive_reconciled(pg_temp.reel(p_n), s -> 'kit' ->> 'hash') <> 'ok' then
    raise exception 'FAIL: reconcile reel %', p_n;
  end if;
end $$;
create function pg_temp.upload_video(p_actor uuid, p_n integer) returns void language plpgsql as $$
declare
  v jsonb := public.prepare_upload_as(p_actor, (pg_temp.task(p_n)).id, 'mp4', 'video/mp4', 1000);
begin
  if v ->> 'code' <> 'ok'
     or public.finish_upload_as(p_actor, (v ->> 'file_id')::uuid, 'drive_rr_video_' || p_n || '_xxxx',
                                'https://drive.google.com/rr' || p_n) <> 'ok' then
    raise exception 'FAIL: upload on reel %: %', p_n, v;
  end if;
end $$;

do $$
declare
  p uuid := 'a0000000-0000-0000-0000-000000000006';
  s uuid := 'a0000000-0000-0000-0000-000000000005';
  x uuid := 'a0000000-0000-0000-0000-0000000000e1';
  y uuid := 'a0000000-0000-0000-0000-0000000000e2';
  done jsonb := '{"editing_done": true, "subtitles": true}';
  n integer;
  v_bad text;
begin
  if exists (select 1 from tasks where requires_drive) then
    raise exception 'FAIL: an R1 task needs Drive';
  end if;
  if (select string_agg(state::text, ' ' order by code) from reels where page_id = 'b0000000-0000-0000-0000-0000000000a1')
     <> 'confermato doppiaggio doppiaggio animazione animazione approvazione_finale programmato' then
    raise exception 'FAIL: R1 fixture states';
  end if;

  -- R2: upgrade.sh ran scripts/fase1-r2-enable-drive.sql.
  if (select value from app_config where key = 'drive_enabled') <> 'true'::jsonb then
    raise exception 'FAIL: drive_enabled';
  end if;
  if (select count(*) from job_outbox
       where kind = 'drive_reconcile' and done_at is null
         and (payload ->> 'reel_id')::uuid in (select id from reels where page_id = 'b0000000-0000-0000-0000-0000000000a1')) <> 7 then
    raise exception 'FAIL: backfill did not queue the 7 reels in flight';
  end if;
  for n in 1..7 loop
    perform pg_temp.reconcile(n);
  end loop;
  if (select string_agg((kit_ready_at is not null)::text, ' ' order by code) from reels
       where page_id = 'b0000000-0000-0000-0000-0000000000a1')
     <> 'false false false true true true true' then
    raise exception 'FAIL: legacy kits';
  end if;

  -- Each open R1 task closes; the new tasks upload.
  perform private.schedule_reel(s, pg_temp.reel(7), null, now() + interval '1 day');
  perform pg_temp.act(p, 6, 'approve');
  -- 5: delivered with a link, then sent back to the animator: a Drive task
  -- that starts at once on the legacy kit.
  perform pg_temp.act(y, 5, 'deliver', done || '{"file_url": "https://link.r1.test/v5b.mp4"}');
  perform pg_temp.act(p, 5, 'send_back', '{"to": "animation"}');
  if not (pg_temp.task(5)).requires_drive or (pg_temp.task(5)).notified_at is null then
    raise exception 'FAIL: send-back after R2 does not start on the legacy kit';
  end if;
  perform pg_temp.upload_video(y, 5);
  perform pg_temp.act(y, 5, 'deliver', done);
  perform pg_temp.act(p, 5, 'approve');
  perform pg_temp.act(y, 4, 'accept');
  perform pg_temp.act(y, 4, 'deliver', done || '{"file_url": "https://link.r1.test/v4.mp4"}');
  perform pg_temp.act(p, 4, 'approve');
  for n in 1..3 loop
    if n = 1 then perform pg_temp.act(x, n, 'accept'); end if;
    if n < 3 then
      perform pg_temp.act(x, n, 'deliver', jsonb_build_object('file_url', 'https://link.r1.test/a' || n || '.wav'));
    end if;
    perform pg_temp.act(p, n, 'approve');
    if (pg_temp.task(n)).notified_at is not null then
      raise exception 'FAIL: reel % animation notified before its kit', n;
    end if;
    perform pg_temp.reconcile(n);
    perform pg_temp.act(y, n, 'accept');
    perform pg_temp.upload_video(y, n);
    perform pg_temp.act(y, n, 'deliver', done);
    perform pg_temp.act(p, n, 'approve');
  end loop;

  if (select string_agg(state::text, ' ' order by code) from reels where page_id = 'b0000000-0000-0000-0000-0000000000a1')
     <> 'programmato programmato programmato programmato programmato programmato programmato' then
    raise exception 'FAIL: not every reel reached programmato';
  end if;
  if exists (select 1 from task_events e join tasks t on t.id = e.task_id
              where not t.requires_drive and e.code in ('kit_not_ready', 'file_missing')) then
    raise exception 'FAIL: an R1 task was refused for Drive';
  end if;
  select string_agg(code || ':' || state || '≠' || coalesce(private.derived_state(id)::text, 'null'), ', ')
    into v_bad
    from reels where state is distinct from private.derived_state(id);
  if v_bad is not null then
    raise exception 'FAIL: incoherent reels after R2: %', v_bad;
  end if;
end $$;
