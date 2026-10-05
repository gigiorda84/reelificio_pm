-- Fixture for the R1 → R2 leg of upgrade.sh (I13): reels in flight under the
-- R1 engine, before the Drive migration. Page RR, one reel per R1 state,
-- link deliveries, external dubber and animator.
--
-- People: legacy A admin, W writer, S SMM, P approver (internal); new X
-- dubber and Y animator (external, born after the expand).

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000e1', 'dubber@r1.test'),
  ('a0000000-0000-0000-0000-0000000000e2', 'animator@r1.test');
update profiles set external_kind = 'dubber' where id = 'a0000000-0000-0000-0000-0000000000e1';
update profiles set external_kind = 'animator', drive_email = 'animator.google@r1.test'
 where id = 'a0000000-0000-0000-0000-0000000000e2';

insert into approval_groups (id, name, approver_id)
values ('d0000000-0000-0000-0000-000000000001', 'R1 → R2', 'a0000000-0000-0000-0000-000000000006');
insert into pages (id, slug, name, code_prefix, approval_group_id,
                   dubber_titular_id, animator_titular_id) values
  ('b0000000-0000-0000-0000-0000000000a1', 'r1-in-flight', 'R1 in volo', 'RR',
   'd0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e2');
insert into batches (id, page_id, label) values
  ('c0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a1', 'Batch Novembre');
insert into raci_configs (page_id, phase, responsible) values
  ('b0000000-0000-0000-0000-0000000000a1', 'script_writing', '{a0000000-0000-0000-0000-000000000001}'),
  ('b0000000-0000-0000-0000-0000000000a1', 'publication', '{a0000000-0000-0000-0000-000000000005}');

create function pg_temp.reel(p_n integer) returns uuid language sql immutable as $$
  select ('e0000000-0000-0000-0000-00000000000' || p_n)::uuid;
$$;
create function pg_temp.act(p_actor uuid, p_n integer, p_op text, p_payload jsonb default null)
returns void language plpgsql as $$
declare
  v text;
begin
  v := private.task_action_core(p_actor,
         (select id from tasks where reel_id = pg_temp.reel(p_n) and status in ('unassigned', 'assigned', 'in_progress')),
         p_op, null, p_payload, 'app');
  if v <> 'ok' then
    raise exception 'FAIL: R1 fixture, reel % %: %', p_n, p_op, v;
  end if;
end $$;

do $$
declare
  w uuid := 'a0000000-0000-0000-0000-000000000001';
  p uuid := 'a0000000-0000-0000-0000-000000000006';
  x uuid := 'a0000000-0000-0000-0000-0000000000e1';
  y uuid := 'a0000000-0000-0000-0000-0000000000e2';
  n integer;
begin
  for n in 1..7 loop
    insert into reels (id, batch_id, page_id, code, ordinal, title, hook, corpo)
    values (pg_temp.reel(n), 'c0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a1',
            'RR-2611-0' || n, n, 'In volo ' || n, 'Hook ' || n, 'Corpo ' || n);
    perform private._create_task(pg_temp.reel(n), 'writing', w, 'in_progress', 'a0000000-0000-0000-0000-00000000000a', null, null);
    perform private._set_state(pg_temp.reel(n), 'bozza');
    perform pg_temp.act(w, n, 'deliver');
    perform pg_temp.act(p, n, 'approve',
      jsonb_build_object('rev', (select script_rev from reels where id = pg_temp.reel(n))));
    -- 1: confermato
    continue when n < 2;
    perform pg_temp.act(x, n, 'accept');
    -- 2: doppiaggio, dubbing in progress
    continue when n < 3;
    perform pg_temp.act(x, n, 'deliver', jsonb_build_object('file_url', 'https://link.r1.test/a' || n || '.wav'));
    -- 3: doppiaggio, audio approval open (audio as a link)
    continue when n < 4;
    perform pg_temp.act(p, n, 'approve');
    -- 4: animazione, animation assigned
    continue when n < 5;
    perform pg_temp.act(y, n, 'accept');
    -- 5: animazione, animation in progress
    continue when n < 6;
    perform pg_temp.act(y, n, 'deliver', jsonb_build_object(
      'file_url', 'https://link.r1.test/v' || n || '.mp4', 'editing_done', true, 'subtitles', true));
    -- 6: approvazione_finale
    continue when n < 7;
    perform pg_temp.act(p, n, 'approve');
    -- 7: programmato, scheduling open
  end loop;
end $$;
