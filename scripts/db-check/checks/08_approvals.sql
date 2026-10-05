-- Approvers (AC11) and production configuration (S3).
-- The default group's approver gets approvals; when away
-- (absent_until, set by an admin) new ones go to the delegate and
-- set_absence moves the open ones; the delegate decides even while the
-- approver is present; a page in group B uses B's approver with no code
-- change.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000071', 'delegate@example.test'),
  ('00000000-0000-0000-0000-000000000072', 'approver-b@example.test');
update profiles set account_type = 'internal'
 where id in ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000072');
update approval_groups
   set approver_id = '00000000-0000-0000-0000-00000000000d',
       delegate_id = '00000000-0000-0000-0000-000000000071'
 where is_default;

-- Two reels written and waiting for review.
update reels set hook = 'h' where id in ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
update reels set state = 'idea' where id in ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
select private.start_writing('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 2);
select private.task_action_core('00000000-0000-0000-0000-00000000000b', id, 'deliver', null, null, 'app')
  from tasks where kind = 'writing' and status = 'in_progress';

do $$ begin
  if (select count(*) from tasks where kind = 'review' and status = 'in_progress'
        and assignee_id = '00000000-0000-0000-0000-00000000000d') <> 2 then
    raise exception 'FAIL: reviews did not go to the approver';
  end if;
end $$;

-- The delegate decides while the approver is present.
do $$ declare v_task uuid; v_rev jsonb; begin
  select t.id, jsonb_build_object('rev', r.script_rev) into v_task, v_rev
    from tasks t join reels r on r.id = t.reel_id
   where t.kind = 'review' and t.status = 'in_progress' and r.id = '30000000-0000-0000-0000-000000000001';
  if private.task_action_core('00000000-0000-0000-0000-000000000071', v_task, 'send_back', 'rivedi', v_rev, 'app') <> 'ok' then
    raise exception 'FAIL: the delegate could not decide';
  end if;
end $$;

-- Absence: only an admin sets it; open approvals move to the delegate.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
do $$ begin
  if public.set_absence('00000000-0000-0000-0000-00000000000d', now() + interval '3 days') <> 'not_authorized' then
    raise exception 'FAIL: the approver set their own absence';
  end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if public.set_absence('00000000-0000-0000-0000-00000000000d', now() + interval '3 days') <> 'ok' then
    raise exception 'FAIL: admin could not set the absence';
  end if;
end $$;
reset role;
do $$ begin
  if (select assignee_id from tasks
       where reel_id = '30000000-0000-0000-0000-000000000002' and kind = 'review' and status = 'in_progress')
     <> '00000000-0000-0000-0000-000000000071' then
    raise exception 'FAIL: the open review did not move to the delegate';
  end if;
  if (select decision_note from tasks
       where reel_id = '30000000-0000-0000-0000-000000000002' and kind = 'review' and status = 'cancelled')
     <> '[assenza]' then
    raise exception 'FAIL: the moved task is not marked';
  end if;
end $$;

-- New approvals during the absence go to the delegate too.
select private.task_action_core('00000000-0000-0000-0000-00000000000b', id, 'deliver', null, null, 'app')
  from tasks where reel_id = '30000000-0000-0000-0000-000000000001' and kind = 'writing' and status = 'in_progress';
do $$ begin
  if (select assignee_id from tasks
       where reel_id = '30000000-0000-0000-0000-000000000001' and kind = 'review' and status = 'in_progress')
     <> '00000000-0000-0000-0000-000000000071' then
    raise exception 'FAIL: a new approval went to the absent approver';
  end if;
end $$;

-- Both away: unassigned, for the admins.
update profiles set absent_until = now() + interval '1 day' where id = '00000000-0000-0000-0000-000000000071';
do $$ begin
  if private.effective_approver('10000000-0000-0000-0000-000000000001') is not null then
    raise exception 'FAIL: an absent delegate is still effective';
  end if;
end $$;
update profiles set absent_until = null;

-- Group B for the page: its approver, no code change.
do $$ declare g uuid; begin
  insert into approval_groups (name, approver_id) values ('Gruppo B', '00000000-0000-0000-0000-000000000072')
  returning id into g;
  update pages set approval_group_id = g where id = '10000000-0000-0000-0000-000000000001';
  if private.effective_approver('10000000-0000-0000-0000-000000000001') <> '00000000-0000-0000-0000-000000000072' then
    raise exception 'FAIL: group B ignored';
  end if;
  -- The default group's people no longer decide this page's approvals.
  if private.task_action_core('00000000-0000-0000-0000-00000000000d',
       (select id from tasks where reel_id = '30000000-0000-0000-0000-000000000001'
           and kind = 'review' and status = 'in_progress'),
       'send_back', null, null, 'app') <> 'not_authorized' then
    raise exception 'FAIL: the default approver decided a group B page';
  end if;
  if private.task_action_core('00000000-0000-0000-0000-000000000072',
       (select id from tasks where reel_id = '30000000-0000-0000-0000-000000000001'
           and kind = 'review' and status = 'in_progress'),
       'send_back', null, null, 'app') <> 'ok' then
    raise exception 'FAIL: group B approver could not decide';
  end if;
end $$;

-- Approval queue: the approver sees the page's approvals, Express first;
-- the delegate too; others nothing.
update profiles set absent_until = null;
update pages set approval_group_id = null where id = '10000000-0000-0000-0000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if (select count(*) from public.approval_queue()) <> 0 then raise exception 'FAIL: member has approvals'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000071', false);
do $$ declare n int; begin
  select count(*) into n from public.approval_queue();
  if n < 1 then raise exception 'FAIL: delegate sees no approvals'; end if;
end $$;
reset role;
update reels set track = 'express' where id = '30000000-0000-0000-0000-000000000002';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
do $$ begin
  if not (select express from public.approval_queue() limit 1) then
    raise exception 'FAIL: Express not first in the queue';
  end if;
end $$;
reset role;

-- Configuration from the UI: admins only.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
do $$ begin
  if public.set_sla_policy('10000000-0000-0000-0000-000000000001', 'batch', 'dubbing', 600) <> 'not_authorized'
     or public.set_approval_group((select id from approval_groups where is_default),
          '00000000-0000-0000-0000-00000000000d', null) <> 'not_authorized' then
    raise exception 'FAIL: a non-admin changed the configuration';
  end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ declare g uuid := (select id from approval_groups where is_default); begin
  if public.set_sla_policy('10000000-0000-0000-0000-000000000001', 'batch', 'dubbing', 600) <> 'ok'
     or public.set_sla_policy('10000000-0000-0000-0000-000000000001', 'batch', 'dubbing', 720) <> 'ok' then
    raise exception 'FAIL: admin could not set a page SLA';
  end if;
  if public.set_sla_policy(null, 'batch', 'dubbing', null) <> 'invalid_input'
     or public.set_sla_policy('10000000-0000-0000-0000-000000000001', 'batch', 'dubbing', 0) <> 'invalid_input' then
    raise exception 'FAIL: bad SLA input accepted';
  end if;
  if public.set_approval_group(g, '00000000-0000-0000-0000-00000000000e', null) <> 'invalid_assignee'
     or public.set_approval_group(g, '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000d') <> 'invalid_input' then
    raise exception 'FAIL: bad approvers accepted';
  end if;
  if public.set_approval_group(g, '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000071') <> 'ok' then
    raise exception 'FAIL: admin could not set the approvers';
  end if;
end $$;
reset role;
do $$ begin
  if private.sla_minutes('10000000-0000-0000-0000-000000000001', 'batch', 'dubbing') <> 720 then
    raise exception 'FAIL: page SLA override not used';
  end if;
  perform private.set_sla_policy('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'batch', 'dubbing', null);
  if private.sla_minutes('10000000-0000-0000-0000-000000000001', 'batch', 'dubbing') <> 2880 then
    raise exception 'FAIL: removing the override did not restore the default';
  end if;
end $$;

rollback;
