-- Fase 1 — access for internal and external accounts (docs/fase1-plan.md
-- §S1 point 3, D3/E1, AC4, AC12).
--
-- Every `using (true)` read becomes "internal, or within what an external may
-- see". All profiles existing at this point are internal, so the Fase 0 code
-- in production sees exactly what it saw before. An external sees only the
-- reels with a task of theirs (visible_reel_ids()), their pages and voice
-- briefs, and the reel comments that are not internal-only; never batches
-- (source_doc_url is the monthly doc), RACI, alerts, DoD, daily updates or
-- other people's profiles.

-------------------------------------------------------------------------------
-- 1. Page membership and reel edits are for internals
-------------------------------------------------------------------------------

create or replace function public.is_page_member(p_page_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_internal() and exists (
    select 1
    from raci_configs rc
    where rc.page_id = p_page_id
      and auth.uid() = any (rc.responsible || rc.approver || rc.consulted)
  );
$$;

-- Externals never edit a reel directly: they propose text changes (S2).
drop policy reels_update_member on reels;
create policy reels_update_member on reels
  for update to authenticated
  using (
    (select public.is_admin())
    or ((select public.is_internal()) and (public.is_page_member(page_id) or public.holds_open_task(id)))
  )
  with check (
    (select public.is_admin())
    or ((select public.is_internal()) and (public.is_page_member(page_id) or public.holds_open_task(id)))
  );

-- RACI members are internal.
create function private.raci_configs_check()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.none_external(new.responsible || new.approver || new.consulted || new.informed) then
    raise exception 'invalid_assignee: RACI members must be internal'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger trg_raci_configs_check
  before insert or update on raci_configs
  for each row execute function private.raci_configs_check();

-------------------------------------------------------------------------------
-- 2. Reads that externals share
-------------------------------------------------------------------------------

drop policy reels_read_auth on reels;
create policy reels_read on reels
  for select to authenticated
  using ((select public.is_internal()) or id = any ((select public.visible_reel_ids())::uuid[]));

drop policy pages_read_auth on pages;
create policy pages_read on pages
  for select to authenticated
  using ((select public.is_internal()) or id = any ((select public.visible_page_ids())::uuid[]));

drop policy voice_briefs_read_auth on voice_briefs;
create policy voice_briefs_read on voice_briefs
  for select to authenticated
  using ((select public.is_internal()) or page_id = any ((select public.visible_page_ids())::uuid[]));

drop policy profiles_read_authenticated on profiles;
create policy profiles_read on profiles
  for select to authenticated
  using ((select public.is_internal()) or id = (select auth.uid()));

-- Comments: an external reads and writes the thread of a visible reel, never
-- an internal-only comment; their own comments can never become internal-only
-- or move to another target.
drop policy comments_read_auth on comments;
create policy comments_read on comments
  for select to authenticated
  using (
    (select public.is_internal())
    or (target_type = 'reel'
        and target_id = any ((select public.visible_reel_ids())::uuid[])
        and not internal_only)
  );

-- Same rule as comments_read, as a function: a policy on comments cannot
-- query comments itself (Postgres reports infinite recursion).
create function public.comment_is_visible(p_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from comments c
     where c.id = p_comment_id
       and (public.is_internal()
            or (c.target_type = 'reel'
                and c.target_id = any (public.visible_reel_ids())
                and not c.internal_only))
  );
$$;

drop policy comments_insert_self on comments;
create policy comments_insert_self on comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      (select public.is_internal())
      or (target_type = 'reel'
          and target_id = any ((select public.visible_reel_ids())::uuid[])
          and internal_only = false
          -- a reply only to a comment the external can see
          and (parent_id is null or public.comment_is_visible(parent_id)))
    )
  );

revoke update on table comments from anon, authenticated;
grant update (body, mentions, internal_only) on table comments to authenticated;

drop policy comments_update_own on comments;
create policy comments_update_own on comments
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (
    author_id = (select auth.uid())
    and (
      (select public.is_internal())
      or (target_type = 'reel'
          and target_id = any ((select public.visible_reel_ids())::uuid[])
          and internal_only = false)
    )
  );

-- Names only (never emails) of the people an external works with: authors of
-- the comments and assignees of the tasks on reels they can see.
create function public.profile_names(p_ids uuid[])
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name
  from profiles p
  where p.id = any (p_ids)
    and (
      public.is_internal()
      or p.id = auth.uid()
      or p.id in (
        select c.author_id from comments c
         where c.target_type = 'reel'
           and c.target_id = any (public.visible_reel_ids())
           and not c.internal_only
        union
        select t.assignee_id from tasks t
         where t.reel_id = any (public.visible_reel_ids())
      )
    );
$$;

-------------------------------------------------------------------------------
-- 3. Internal-only reads
-------------------------------------------------------------------------------

drop policy batches_read_auth on batches;
create policy batches_internal_read on batches
  for select to authenticated using ((select public.is_internal()));

drop policy raci_configs_read_auth on raci_configs;
create policy raci_configs_internal_read on raci_configs
  for select to authenticated using ((select public.is_internal()));

drop policy page_members_read_auth on page_members;
create policy page_members_internal_read on page_members
  for select to authenticated using ((select public.is_internal()));

drop policy reel_assignments_read_auth on reel_assignments;
create policy reel_assignments_internal_read on reel_assignments
  for select to authenticated using ((select public.is_internal()));

drop policy alerts_read_auth on alerts;
create policy alerts_internal_read on alerts
  for select to authenticated using ((select public.is_internal()));

drop policy reel_dod_items_read_auth on reel_dod_items;
create policy reel_dod_items_internal_read on reel_dod_items
  for select to authenticated using ((select public.is_internal()));

drop policy daily_updates_read_auth on daily_updates;
create policy daily_updates_internal_read on daily_updates
  for select to authenticated using ((select public.is_internal()));

drop policy phase_advance_requests_read_auth on phase_advance_requests;
create policy phase_advance_requests_internal_read on phase_advance_requests
  for select to authenticated using ((select public.is_internal()));

-- magic_link_invites stays admin-only (initial schema).

-------------------------------------------------------------------------------
-- 4. Collaborator accounts (admin)
-------------------------------------------------------------------------------

-- Makes a profile internal or external. An admin, a RACI member or an
-- approver cannot become external, nor can a page titular/reserve change to
-- a kind that no longer fits that role.
create function private.set_collaborator(
  p_actor uuid,
  p_user uuid,
  p_account_type account_type,
  p_external_kind external_kind,
  p_drive_email text,
  p_full_name text
)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_profile profiles%rowtype;
  v_drive text := nullif(trim(p_drive_email), '');
begin
  if not private.is_admin_uid(p_actor) then
    return 'not_authorized';
  end if;
  if p_account_type is null
     or (p_account_type = 'internal') <> (p_external_kind is null)
     or (v_drive is not null and v_drive !~ '^[^@\s]+@[^@\s]+$') then
    return 'invalid_input';
  end if;

  select * into v_profile from profiles where id = p_user for update;
  if not found then
    return 'invalid_input';
  end if;

  if p_account_type = 'external' then
    if v_profile.is_admin
       or exists (select 1 from raci_configs rc
                   where p_user = any (rc.responsible || rc.approver || rc.consulted || rc.informed))
       or exists (select 1 from approval_groups g where p_user in (g.approver_id, g.delegate_id))
       or exists (select 1 from pages pg
                   where (p_external_kind <> 'dubber' and p_user in (pg.dubber_titular_id, pg.dubber_reserve_id))
                      or (p_external_kind <> 'animator' and p_user in (pg.animator_titular_id, pg.animator_reserve_id))
                      or (p_external_kind <> 'validator' and p_user = pg.validator_id)) then
      return 'invalid_state';
    end if;
  end if;

  update profiles
     set account_type = p_account_type,
         external_kind = p_external_kind,
         drive_email = coalesce(v_drive, drive_email),
         full_name = coalesce(nullif(trim(p_full_name), ''), full_name)
   where id = p_user;
  return 'ok';
end;
$$;

-- Deactivates a collaborator: no access, no notifications, removed as page
-- titular/reserve/validator. S2 adds the reassignment of their open tasks;
-- the script also bans the auth user.
create function private.offboard_collaborator(p_actor uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_profile profiles%rowtype;
begin
  if not private.is_admin_uid(p_actor) then
    return 'not_authorized';
  end if;
  if p_user is null or p_user = p_actor then
    return 'invalid_input';
  end if;
  select * into v_profile from profiles where id = p_user for update;
  if not found then
    return 'invalid_input';
  end if;
  if v_profile.is_admin then
    return 'invalid_state';
  end if;
  if v_profile.deactivated_at is not null then
    return 'ok';
  end if;

  update profiles set deactivated_at = now() where id = p_user;
  update pages set dubber_titular_id = null where dubber_titular_id = p_user;
  update pages set dubber_reserve_id = null where dubber_reserve_id = p_user;
  update pages set animator_titular_id = null where animator_titular_id = p_user;
  update pages set animator_reserve_id = null where animator_reserve_id = p_user;
  update pages set validator_id = null where validator_id = p_user;
  return 'ok';
end;
$$;

-- Session callers (admin UI, later).
create function public.admin_set_collaborator(
  p_user uuid,
  p_account_type account_type,
  p_external_kind external_kind,
  p_drive_email text default null,
  p_full_name text default null
)
returns text
language sql
security definer
set search_path = public, private
as $$
  select private.set_collaborator(auth.uid(), p_user, p_account_type, p_external_kind, p_drive_email, p_full_name);
$$;

create function public.offboard_collaborator(p_user uuid)
returns text
language sql
security definer
set search_path = public, private
as $$
  select private.offboard_collaborator(auth.uid(), p_user);
$$;

-- Service-role twins with an explicit acting admin, for
-- scripts/fase1-collaborators.ts and the dump rehearsal.
create function public.set_collaborator_as(
  p_actor uuid,
  p_user uuid,
  p_account_type account_type,
  p_external_kind external_kind,
  p_drive_email text default null,
  p_full_name text default null
)
returns text
language sql
security definer
set search_path = public, private
as $$
  select private.set_collaborator(p_actor, p_user, p_account_type, p_external_kind, p_drive_email, p_full_name);
$$;

create function public.offboard_collaborator_as(p_actor uuid, p_user uuid)
returns text
language sql
security definer
set search_path = public, private
as $$
  select private.offboard_collaborator(p_actor, p_user);
$$;

revoke execute on function public.comment_is_visible(uuid) from public, anon, authenticated;
revoke execute on function public.profile_names(uuid[]) from public, anon, authenticated;
revoke execute on function public.admin_set_collaborator(uuid, account_type, external_kind, text, text) from public, anon, authenticated;
revoke execute on function public.offboard_collaborator(uuid) from public, anon, authenticated;
revoke execute on function public.set_collaborator_as(uuid, uuid, account_type, external_kind, text, text) from public, anon, authenticated;
revoke execute on function public.offboard_collaborator_as(uuid, uuid) from public, anon, authenticated;

grant execute on function public.comment_is_visible(uuid) to authenticated, service_role;
grant execute on function public.profile_names(uuid[]) to authenticated, service_role;
grant execute on function public.admin_set_collaborator(uuid, account_type, external_kind, text, text) to authenticated;
grant execute on function public.offboard_collaborator(uuid) to authenticated;
grant execute on function public.set_collaborator_as(uuid, uuid, account_type, external_kind, text, text) to service_role;
grant execute on function public.offboard_collaborator_as(uuid, uuid) to service_role;
revoke execute on all functions in schema private from public, anon, authenticated;
