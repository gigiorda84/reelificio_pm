-- Fase 1 model: state mapping, state/phase sync, locked columns, account
-- types, SLA arithmetic, effective approver (docs/fase1-plan.md §S1).

-- The 10 rows of state_raci_phase (table D2) and the 6-phase round trip.
do $$ declare v_bad text; begin
  select string_agg(s::text, ', ') into v_bad
  from (values
    ('idea'::reel_state, 'research_prescript'::pipeline_phase),
    ('bozza', 'script_writing'), ('revisione', 'script_writing'),
    ('validazione', 'scientific_validation'), ('confermato', 'dubbing'),
    ('doppiaggio', 'dubbing'), ('animazione', 'editing'),
    ('approvazione_finale', 'editing'), ('programmato', 'publication'),
    ('pubblicato', 'publication')
  ) as m(s, p)
  where public.state_raci_phase(m.s) is distinct from m.p;
  if v_bad is not null then raise exception 'FAIL: state_raci_phase wrong for %', v_bad; end if;
  if (select count(*) from unnest(enum_range(null::reel_state))) <> 10 then
    raise exception 'FAIL: reel_state should have 10 values';
  end if;

  select string_agg(p::text, ', ') into v_bad
  from unnest(array['research_prescript', 'scientific_validation', 'script_writing',
                    'dubbing', 'editing', 'publication']::pipeline_phase[]) p
  where public.state_raci_phase(private.legacy_phase_to_state(p, null)) <> p;
  if v_bad is not null then raise exception 'FAIL: round trip broken for %', v_bad; end if;

  if private.legacy_phase_to_state('qc', null) <> 'approvazione_finale'
     or private.legacy_phase_to_state('published', null) <> 'pubblicato'
     or private.legacy_phase_to_state('editing', now()) <> 'pubblicato' then
    raise exception 'FAIL: deprecated phases or published_at not mapped';
  end if;
end $$;

-- Seed reels got their state from the insert trigger.
do $$ begin
  if (select state from reels where id = '30000000-0000-0000-0000-000000000001') <> 'bozza'
     or (select state from reels where id = '30000000-0000-0000-0000-000000000002') <> 'animazione' then
    raise exception 'FAIL: insert did not derive state from phase';
  end if;
end $$;

-- State drives phase (the engine path, S2).
update reels set state = 'confermato', state_entered_at = now() - interval '1 day',
                 phase_entered_at = now() - interval '1 day'
 where id = '30000000-0000-0000-0000-000000000001';
do $$ declare r reels%rowtype; begin
  select * into r from reels where id = '30000000-0000-0000-0000-000000000001';
  if r.phase <> 'dubbing' then raise exception 'FAIL: state did not move phase (%).', r.phase; end if;
end $$;
update reels set state = 'doppiaggio' where id = '30000000-0000-0000-0000-000000000001';
do $$ declare r reels%rowtype; begin
  select * into r from reels where id = '30000000-0000-0000-0000-000000000001';
  if r.state_entered_at < now() - interval '1 minute' then
    raise exception 'FAIL: state_entered_at not stamped';
  end if;
  -- confermato → doppiaggio stays in the dubbing macro-phase.
  if r.phase <> 'dubbing' or r.phase_entered_at > now() - interval '1 hour' then
    raise exception 'FAIL: phase_entered_at moved without a macro-phase change';
  end if;
end $$;

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

-- script_rev counts real edits of the script blocks only.
do $$ declare v0 int; v1 int; v2 int; begin
  select script_rev into v0 from reels where id = '30000000-0000-0000-0000-000000000002';
  update reels set hook = hook, caption = 'altro' where id = '30000000-0000-0000-0000-000000000002';
  select script_rev into v1 from reels where id = '30000000-0000-0000-0000-000000000002';
  update reels set hook = 'Nuovo hook' where id = '30000000-0000-0000-0000-000000000002';
  select script_rev into v2 from reels where id = '30000000-0000-0000-0000-000000000002';
  if v1 <> v0 or v2 <> v0 + 1 then
    raise exception 'FAIL: script_rev % → % → %', v0, v1, v2;
  end if;
end $$;

-- A reel in final approval is not buffer: its macro-phase is editing.
update reels set state = 'approvazione_finale' where id = '30000000-0000-0000-0000-000000000002';
do $$ begin
  if exists (select 1 from public.active_reel_counts() where phase = 'publication') then
    raise exception 'FAIL: approvazione_finale counted as buffer';
  end if;
end $$;

-- Users cannot write the engine's columns or tables, admins included.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ declare c text; begin
  foreach c in array array['state', 'track', 'state_entered_at', 'script_rev', 'phase'] loop
    begin
      execute format('update reels set %I = %I where id = %L', c, c, '30000000-0000-0000-0000-000000000001');
      raise exception 'FAIL: admin wrote reels.% directly', c;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    insert into tasks (reel_id, kind, status, assignee_id)
    values ('30000000-0000-0000-0000-000000000001', 'writing', 'assigned', auth.uid());
    raise exception 'FAIL: user inserted a task';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into job_outbox (kind) values ('notify');
    raise exception 'FAIL: user inserted a job';
  exception when insufficient_privilege then null;
  end;
  begin
    update app_config set value = 'true' where key = 'drive_enabled';
    raise exception 'FAIL: user wrote app_config';
  exception when insufficient_privilege then null;
  end;
  begin
    update profiles set account_type = 'external' where id = auth.uid();
    raise exception 'FAIL: user wrote account_type';
  exception when insufficient_privilege then null;
  end;
end $$;

-- set_app_config: admins only, booleans only.
do $$ begin
  if public.set_app_config('standup_enabled', 'true') <> 'ok'
     or public.set_app_config('standup_enabled', '"yes"') <> 'invalid_input'
     or public.set_app_config('nope', 'true') <> 'invalid_input' then
    raise exception 'FAIL: set_app_config as admin';
  end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if public.set_app_config('standup_enabled', 'false') <> 'not_authorized' then
    raise exception 'FAIL: set_app_config as a member';
  end if;
  -- The member reads none of app_config (admin only).
  if (select count(*) from app_config) <> 0 then
    raise exception 'FAIL: member reads app_config';
  end if;
end $$;
reset role;

-- New accounts: external unless the service role says internal in
-- raw_app_meta_data; raw_user_meta_data is never trusted.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'claims@example.test', '{"account_type":"internal"}', '{}'),
  ('00000000-0000-0000-0000-0000000000f2', 'staff@example.test', '{}', '{"account_type":"internal"}');
do $$ begin
  if (select account_type from profiles where id = '00000000-0000-0000-0000-0000000000f1') <> 'external' then
    raise exception 'FAIL: raw_user_meta_data made a user internal';
  end if;
  if (select account_type from profiles where id = '00000000-0000-0000-0000-0000000000f2') <> 'internal' then
    raise exception 'FAIL: raw_app_meta_data internal ignored';
  end if;
  begin
    update profiles set is_admin = true where id = '00000000-0000-0000-0000-0000000000f1';
    raise exception 'FAIL: an external became admin';
  exception when check_violation then null;
  end;
end $$;

-- On a fresh environment the first admin claim makes the profile internal.
update profiles set is_admin = false;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
do $$ begin
  if not public.claim_admin_if_first() then raise exception 'FAIL: first claim refused'; end if;
end $$;
reset role;
do $$ begin
  if (select (is_admin, account_type)::text from profiles where id = '00000000-0000-0000-0000-0000000000f1')
     <> '(t,internal)' then
    raise exception 'FAIL: first admin is not internal';
  end if;
end $$;
update profiles set is_admin = (id = '00000000-0000-0000-0000-00000000000a');

-- One Telegram chat, one person.
update profiles set telegram_chat_id = '4242' where id = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  update profiles set telegram_chat_id = '4242' where id = '00000000-0000-0000-0000-00000000000c';
  raise exception 'FAIL: duplicate telegram_chat_id accepted';
exception when unique_violation then null;
end $$;

-- Page roles: kind must fit, titular differs from reserve and across roles.
do $$ begin
  update pages set dubber_titular_id = '00000000-0000-0000-0000-00000000000e'
   where id = '10000000-0000-0000-0000-000000000001';
  begin
    update pages set animator_titular_id = '00000000-0000-0000-0000-00000000000e'
     where id = '10000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: a dubber became animator titular';
  exception when check_violation then null;
  end;
  begin
    update pages set dubber_reserve_id = '00000000-0000-0000-0000-00000000000e'
     where id = '10000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: titular = reserve accepted';
  exception when check_violation then null;
  end;
  begin
    update pages set animator_titular_id = '00000000-0000-0000-0000-00000000000b',
                     dubber_titular_id = '00000000-0000-0000-0000-00000000000b'
     where id = '10000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: same titular for dubbing and animation';
  exception when check_violation then null;
  end;
end $$;

-- add_sla: Batch skips the weekend (Rome), Express is real time, DST safe.
do $$ begin
  -- Friday 2026-10-09 18:00 Rome + 24 h Batch = Monday 18:00 Rome.
  if private.add_sla('2026-10-09 18:00 Europe/Rome', 1440, 'batch') <> '2026-10-12 18:00 Europe/Rome'::timestamptz then
    raise exception 'FAIL: batch Friday + 24h = %', private.add_sla('2026-10-09 18:00 Europe/Rome', 1440, 'batch');
  end if;
  -- Saturday start counts from Monday 00:00.
  if private.add_sla('2026-10-10 11:00 Europe/Rome', 60, 'batch') <> '2026-10-12 01:00 Europe/Rome'::timestamptz then
    raise exception 'FAIL: batch from Saturday';
  end if;
  if private.add_sla('2026-10-09 18:00 Europe/Rome', 1440, 'express') <> '2026-10-10 18:00 Europe/Rome'::timestamptz then
    raise exception 'FAIL: express + 24h';
  end if;
  -- DST ends Sunday 2026-10-25: Express keeps 24 real hours, Batch keeps
  -- the Rome wall clock on Monday.
  if private.add_sla('2026-10-24 12:00 Europe/Rome', 1440, 'express') <> '2026-10-25 11:00 Europe/Rome'::timestamptz then
    raise exception 'FAIL: express across DST';
  end if;
  if private.add_sla('2026-10-23 18:00 Europe/Rome', 1440, 'batch') <> '2026-10-26 18:00 Europe/Rome'::timestamptz then
    raise exception 'FAIL: batch across DST';
  end if;
end $$;

-- sla_minutes: page override, else the global default.
insert into sla_policies (page_id, track, step, minutes)
values ('10000000-0000-0000-0000-000000000001', 'batch', 'dubbing', 600);
do $$ begin
  if private.sla_minutes('10000000-0000-0000-0000-000000000001', 'batch', 'dubbing') <> 600
     or private.sla_minutes('10000000-0000-0000-0000-000000000001', 'batch', 'animation') <> 4320
     or private.sla_minutes(null, 'express', 'audio_approval') <> 30 then
    raise exception 'FAIL: sla_minutes';
  end if;
end $$;

-- Effective approver: approver, delegate when the approver is away, nobody
-- when both are; a page in another group uses that group.
update approval_groups set approver_id = '00000000-0000-0000-0000-00000000000d',
                           delegate_id = '00000000-0000-0000-0000-00000000000a'
 where is_default;
do $$ declare g uuid; begin
  if private.effective_approver('10000000-0000-0000-0000-000000000001') <> '00000000-0000-0000-0000-00000000000d' then
    raise exception 'FAIL: approver not chosen';
  end if;
  update profiles set absent_until = now() + interval '3 days' where id = '00000000-0000-0000-0000-00000000000d';
  if private.effective_approver('10000000-0000-0000-0000-000000000001') <> '00000000-0000-0000-0000-00000000000a' then
    raise exception 'FAIL: delegate not chosen while the approver is away';
  end if;
  update profiles set absent_until = now() + interval '3 days' where id = '00000000-0000-0000-0000-00000000000a';
  if private.effective_approver('10000000-0000-0000-0000-000000000001') is not null then
    raise exception 'FAIL: expected no approver when both are away';
  end if;
  update profiles set absent_until = null;
  insert into approval_groups (name, approver_id) values ('Gruppo B', '00000000-0000-0000-0000-00000000000b')
  returning id into g;
  update pages set approval_group_id = g where id = '10000000-0000-0000-0000-000000000001';
  if private.effective_approver('10000000-0000-0000-0000-000000000001') <> '00000000-0000-0000-0000-00000000000b' then
    raise exception 'FAIL: page group B ignored';
  end if;
  begin
    update approval_groups set delegate_id = '00000000-0000-0000-0000-00000000000e' where id = g;
    raise exception 'FAIL: external delegate accepted';
  exception when check_violation then null;
  end;
end $$;

rollback;
