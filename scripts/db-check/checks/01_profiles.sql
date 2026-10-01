-- Profiles: no self-promotion to admin, no hijacking of the Telegram link.

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);

do $$ begin
  begin
    update profiles set is_admin = true where id = auth.uid();
    raise exception 'FAIL: a user set their own is_admin';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$ begin
  begin
    update profiles set telegram_chat_id = '123456' where id = auth.uid();
    raise exception 'FAIL: a user set their own telegram_chat_id';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$ declare n int; begin
  update profiles set full_name = 'Nome Nuovo', daily_reminder_at = '17:30' where id = auth.uid();
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: own display fields not editable (% rows)', n; end if;
end $$;

do $$ declare n int; begin
  update profiles set full_name = 'Altro' where id <> auth.uid();
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: edited % other profiles', n; end if;
end $$;

do $$ begin
  if public.claim_admin_if_first() then
    raise exception 'FAIL: claimed admin while an admin exists';
  end if;
end $$;

-- unlink_telegram clears only the caller's link.
reset role;
update profiles set telegram_chat_id = '999' where id in (
  '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000b');
set role authenticated;
select public.unlink_telegram();
reset role;
do $$ begin
  if (select telegram_chat_id from profiles where id = '00000000-0000-0000-0000-00000000000c') is not null then
    raise exception 'FAIL: unlink_telegram did not clear the caller';
  end if;
  if (select telegram_chat_id from profiles where id = '00000000-0000-0000-0000-00000000000b') is null then
    raise exception 'FAIL: unlink_telegram cleared another user';
  end if;
end $$;

-- With no admin left, exactly one user can claim the role.
update profiles set is_admin = false;
set role authenticated;
do $$ begin
  if not public.claim_admin_if_first() then raise exception 'FAIL: first claim refused'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if public.claim_admin_if_first() then raise exception 'FAIL: second claim accepted'; end if;
end $$;

reset role;
rollback;
