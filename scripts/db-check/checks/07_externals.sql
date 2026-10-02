-- External accounts (AC4): the external dubber `e` holds a task on 1 reel of
-- 3 and sees exactly that reel, its page and voice brief, the reel's comments
-- that are not internal-only, and their own task and profile. Nothing else.

-- Fixture: a third reel, a voice brief, e's open task on reel 1, comments,
-- and one row in each internal-only table.
insert into reels (id, batch_id, page_id, code, ordinal, title, phase) values
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-03', 3, 'Reel tre', 'dubbing');
insert into voice_briefs (page_id, adjectives) values ('10000000-0000-0000-0000-000000000001', '{caldo}');
insert into tasks (id, reel_id, kind, status, assignee_id, started_at, accepted_at) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'dubbing',
   'in_progress', '00000000-0000-0000-0000-00000000000e', now(), now()),
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'animation',
   'in_progress', '00000000-0000-0000-0000-00000000000b', now(), now());
insert into comments (id, target_type, target_id, author_id, body, internal_only) values
  ('60000000-0000-0000-0000-000000000001', 'reel', '30000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000000b', 'Per il doppiatore', false),
  ('60000000-0000-0000-0000-000000000002', 'reel', '30000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000000d', 'Solo per noi', true),
  ('60000000-0000-0000-0000-000000000003', 'reel', '30000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-00000000000b', 'Altro reel', false),
  ('60000000-0000-0000-0000-000000000004', 'batch', '20000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000000b', 'Sul batch', false);
insert into reel_dod_items (reel_id, key) values ('30000000-0000-0000-0000-000000000001', 'script_validated');
insert into alerts (kind, dedup_key, page_id) values ('buffer_low', 'buffer:pp', '10000000-0000-0000-0000-000000000001');
insert into daily_updates (user_id, date, did_today) values ('00000000-0000-0000-0000-00000000000b', current_date, 'x');
insert into phase_advance_requests (reel_id, from_phase, to_phase, requested_by)
values ('30000000-0000-0000-0000-000000000003', 'dubbing', 'editing', '00000000-0000-0000-0000-00000000000b');
insert into page_members (page_id, user_id, role)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'core');
insert into notifications (id, recipient_id, event, channel, payload) values
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e', 'mention', 'in_app', '{"subject":"x"}');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);

-- Reads.
do $$ declare v_bad text; begin
  select string_agg(t || '=' || n, ', ') into v_bad from (
    select 'reels' t, (select count(*) from reels) n, 1 want
    union all select 'pages', (select count(*) from pages), 1
    union all select 'voice_briefs', (select count(*) from voice_briefs), 1
    union all select 'comments', (select count(*) from comments), 1
    union all select 'tasks', (select count(*) from tasks), 1
    union all select 'profiles', (select count(*) from profiles), 1
    union all select 'notifications', (select count(*) from notifications), 1
    union all select 'batches', (select count(*) from batches), 0
    union all select 'raci_configs', (select count(*) from raci_configs), 0
    union all select 'page_members', (select count(*) from page_members), 0
    union all select 'reel_assignments', (select count(*) from reel_assignments), 0
    union all select 'alerts', (select count(*) from alerts), 0
    union all select 'reel_dod_items', (select count(*) from reel_dod_items), 0
    union all select 'daily_updates', (select count(*) from daily_updates), 0
    union all select 'phase_advance_requests', (select count(*) from phase_advance_requests), 0
    union all select 'magic_link_invites', (select count(*) from magic_link_invites), 0
    union all select 'approval_groups', (select count(*) from approval_groups), 0
    union all select 'sla_policies', (select count(*) from sla_policies), 0
    union all select 'task_events', (select count(*) from task_events), 0
    union all select 'text_change_proposals', (select count(*) from text_change_proposals), 0
    union all select 'app_config', (select count(*) from app_config), 0
  ) x where n <> want;
  if v_bad is not null then raise exception 'FAIL: external row counts: %', v_bad; end if;

  if (select id from reels) <> '30000000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: external sees the wrong reel';
  end if;
  if (select id from comments) <> '60000000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: external sees the wrong comment';
  end if;
end $$;

-- profile_names: names of the people on their reels, never emails.
do $$ declare v text; begin
  select string_agg(id::text, ',' order by id) into v
  from public.profile_names(array[
    '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
    '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d',
    '00000000-0000-0000-0000-00000000000e']::uuid[]);
  if v <> '00000000-0000-0000-0000-00000000000b,00000000-0000-0000-0000-00000000000e' then
    raise exception 'FAIL: profile_names returned %', v;
  end if;
  if (select count(*) from information_schema.routines r
        join information_schema.parameters p on p.specific_name = r.specific_name
       where r.routine_name = 'profile_names' and p.parameter_mode = 'OUT' and p.parameter_name = 'email') > 0 then
    raise exception 'FAIL: profile_names exposes email';
  end if;
end $$;

-- Writes.
do $$ declare n int; begin
  update reels set title = 'x' where id = '30000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: external edited a reel'; end if;

  begin
    insert into tasks (reel_id, kind, status, assignee_id)
    values ('30000000-0000-0000-0000-000000000001', 'writing', 'assigned', auth.uid());
    raise exception 'FAIL: external inserted a task';
  exception when insufficient_privilege then null;
  end;

  begin
    update notifications set payload = '{"subject":"forged"}' where id = '70000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: notification payload writable';
  exception when insufficient_privilege then null;
  end;
  update notifications set read_at = now() where id = '70000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: external cannot mark own notification read'; end if;

  -- Comments: own reel yes; other reels, batches, internal-only no.
  insert into comments (id, target_type, target_id, author_id, body)
  values ('60000000-0000-0000-0000-000000000010', 'reel', '30000000-0000-0000-0000-000000000001', auth.uid(), 'Fatto');
  begin
    insert into comments (target_type, target_id, author_id, body)
    values ('reel', '30000000-0000-0000-0000-000000000002', auth.uid(), 'x');
    raise exception 'FAIL: external commented a reel they cannot see';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into comments (target_type, target_id, author_id, body)
    values ('batch', '20000000-0000-0000-0000-000000000001', auth.uid(), 'x');
    raise exception 'FAIL: external commented a batch';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into comments (target_type, target_id, author_id, body, internal_only)
    values ('reel', '30000000-0000-0000-0000-000000000001', auth.uid(), 'x', true);
    raise exception 'FAIL: external wrote an internal-only comment';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into comments (target_type, target_id, author_id, body, parent_id)
    values ('reel', '30000000-0000-0000-0000-000000000001', auth.uid(), 'x', '60000000-0000-0000-0000-000000000002');
    raise exception 'FAIL: external replied to an internal-only comment';
  exception when insufficient_privilege then null;
  end;

  -- Own comment: body yes; never internal-only, never moved.
  update comments set body = 'Fatto, ricaricato' where id = '60000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: external cannot edit own comment body'; end if;
  begin
    update comments set internal_only = true where id = '60000000-0000-0000-0000-000000000010';
    raise exception 'FAIL: external made own comment internal-only';
  exception when insufficient_privilege then null;
  end;
  begin
    update comments set target_id = '30000000-0000-0000-0000-000000000002' where id = '60000000-0000-0000-0000-000000000010';
    raise exception 'FAIL: external moved a comment';
  exception when insufficient_privilege then null;
  end;
  begin
    update comments set target_type = 'batch' where id = '60000000-0000-0000-0000-000000000010';
    raise exception 'FAIL: external changed a comment target type';
  exception when insufficient_privilege then null;
  end;
  begin
    update comments set parent_id = '60000000-0000-0000-0000-000000000001' where id = '60000000-0000-0000-0000-000000000010';
    raise exception 'FAIL: external changed a comment parent';
  exception when insufficient_privilege then null;
  end;

  -- Functions outside the allowlist and schema private are out of reach.
  begin
    perform public.set_collaborator_as(auth.uid(), auth.uid(), 'internal', null);
    raise exception 'FAIL: external called set_collaborator_as';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.is_admin_uid(auth.uid());
    raise exception 'FAIL: external reached schema private';
  exception when insufficient_privilege then null;
  end;
  if public.admin_set_collaborator(auth.uid(), 'internal', null) <> 'not_authorized'
     or public.offboard_collaborator('00000000-0000-0000-0000-00000000000b') <> 'not_authorized' then
    raise exception 'FAIL: external ran admin collaborator functions';
  end if;
  if public.set_app_config('drive_enabled', 'true') <> 'not_authorized' then
    raise exception 'FAIL: external flipped a switch';
  end if;
end $$;

-- An internal may mark their own comment internal-only.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ declare n int; begin
  update comments set internal_only = true where id = '60000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: internal cannot mark own comment internal-only'; end if;
end $$;
reset role;
update comments set internal_only = false where id = '60000000-0000-0000-0000-000000000001';

-- Visibility follows the task: lost on decline/expiry/cancel, kept 7 days
-- after an outcome, lost when deactivated.
do $$
declare
  c record;
  n int;
begin
  for c in select * from (values
    ('declined', 'declined'::task_status, now(), 0),
    ('expired', 'expired', now(), 0),
    ('cancelled', 'cancelled', now(), 0),
    ('delivered today', 'delivered', now(), 1),
    ('approved 6 days ago', 'approved', now() - interval '6 days', 1),
    ('sent back 8 days ago', 'sent_back', now() - interval '8 days', 0)
  ) as v(label, status, closed_at, want) loop
    update tasks set status = c.status, closed_at = c.closed_at
     where id = '50000000-0000-0000-0000-000000000001';
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
    select count(*) into n from reels;
    reset role;
    if n <> c.want then
      raise exception 'FAIL: external sees % reels with a task %', n, c.label;
    end if;
  end loop;
end $$;

-- An external cannot be put in RACI.
do $$ begin
  update raci_configs set consulted = '{00000000-0000-0000-0000-00000000000e}'
   where page_id = '10000000-0000-0000-0000-000000000001' and phase = 'editing';
  raise exception 'FAIL: external accepted in RACI';
exception when check_violation then null;
end $$;

-- Collaborator management: the admin converts and offboards; guards hold.
update tasks set status = 'in_progress', closed_at = null where id = '50000000-0000-0000-0000-000000000001';
update pages set dubber_titular_id = '00000000-0000-0000-0000-00000000000e'
 where id = '10000000-0000-0000-0000-000000000001';
do $$ begin
  if public.set_collaborator_as('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
                                'external', 'dubber') <> 'invalid_state' then
    raise exception 'FAIL: a RACI member became external';
  end if;
  if public.set_collaborator_as('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e',
                                'external', 'animator') <> 'invalid_state' then
    raise exception 'FAIL: the dubber titular changed kind';
  end if;
  if public.set_collaborator_as('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e',
                                'external', null) <> 'invalid_input'
     or public.set_collaborator_as('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e',
                                   'external', 'dubber', 'not-an-email') <> 'invalid_input' then
    raise exception 'FAIL: bad collaborator input accepted';
  end if;
  if public.set_collaborator_as('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000e',
                                'external', 'dubber') <> 'not_authorized' then
    raise exception 'FAIL: a non-admin actor managed collaborators';
  end if;
  -- Call first, then read: subqueries in the same expression would read the
  -- snapshot taken before the call.
  if public.set_collaborator_as('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e',
                                'external', 'dubber', 'dubber.drive@gmail.com', 'Mario Voce') <> 'ok' then
    raise exception 'FAIL: admin could not update a collaborator';
  end if;
  if (select drive_email from profiles where id = '00000000-0000-0000-0000-00000000000e') <> 'dubber.drive@gmail.com' then
    raise exception 'FAIL: drive_email not saved';
  end if;

  if public.offboard_collaborator_as('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e') <> 'ok' then
    raise exception 'FAIL: offboarding refused';
  end if;
  if (select deactivated_at from profiles where id = '00000000-0000-0000-0000-00000000000e') is null
     or (select dubber_titular_id from pages where id = '10000000-0000-0000-0000-000000000001') is not null then
    raise exception 'FAIL: offboarding did not deactivate and clear page roles';
  end if;
  if public.offboard_collaborator_as('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a') <> 'invalid_input' then
    raise exception 'FAIL: admin offboarded themselves';
  end if;
end $$;

-- Offboarded: sees nothing even with an open task.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
do $$ begin
  if (select count(*) from reels) <> 0 or (select count(*) from comments) <> 0 or (select count(*) from tasks) <> 0 then
    raise exception 'FAIL: offboarded external still sees data';
  end if;
end $$;
reset role;

rollback;
