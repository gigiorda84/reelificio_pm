-- Fase 1 — production configuration from the UI (docs/fase1-plan.md §S3).
-- SLA policies and approval groups have no write grant for users: admins
-- change them through these functions (pages are written directly by admins
-- under the existing policy; the role-fit trigger checks titulars).

-- Sets an SLA. p_page_id null = the global default (it can change, never
-- disappear); a page row overrides it, and p_minutes null removes the
-- override. Applies to tasks created from now on.
create function private.set_sla_policy(
  p_actor uuid, p_page_id uuid, p_track reel_track, p_step sla_step, p_minutes integer
)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.is_admin_uid(p_actor) then return 'not_authorized'; end if;
  if p_track is null or p_step is null or (p_minutes is not null and p_minutes <= 0)
     or (p_page_id is null and p_minutes is null) then
    return 'invalid_input';
  end if;
  if p_minutes is null then
    delete from sla_policies where page_id = p_page_id and track = p_track and step = p_step;
    return 'ok';
  end if;
  insert into sla_policies (page_id, track, step, minutes)
  values (p_page_id, p_track, p_step, p_minutes)
  on conflict (page_id, track, step) do update set minutes = excluded.minutes, updated_at = now();
  return 'ok';
end;
$$;

-- Approver and delegate of a group (internals; the group trigger refuses
-- externals). Open approvals stay where they are: absence moves them.
create function private.set_approval_group(p_actor uuid, p_group_id uuid, p_approver uuid, p_delegate uuid)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.is_admin_uid(p_actor) then return 'not_authorized'; end if;
  if p_approver is not null and p_approver = p_delegate then return 'invalid_input'; end if;
  if not private.none_external(array[p_approver, p_delegate]) then return 'invalid_assignee'; end if;
  update approval_groups set approver_id = p_approver, delegate_id = p_delegate where id = p_group_id;
  if not found then return 'invalid_input'; end if;
  return 'ok';
end;
$$;

-- The caller's approval queue (/approvazioni, nav badge): open approvals
-- assigned to them, or on pages whose group has them as approver or
-- delegate (validation only to its assignee). Express first, then deadline.
create function public.approval_queue()
returns table (task_id uuid, reel_id uuid, kind task_kind, due_at timestamptz, express boolean)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.reel_id, t.kind, t.due_at, r.track = 'express'
  from tasks t
  join reels r on r.id = t.reel_id
  where public.is_internal()
    and t.status in ('unassigned', 'assigned', 'in_progress')
    and t.kind in ('review', 'validation', 'audio_approval', 'final_approval')
    and (
      t.assignee_id = auth.uid()
      or (t.kind <> 'validation' and exists (
            select 1 from approval_groups g
             where g.id = coalesce(
                     (select pg.approval_group_id from pages pg where pg.id = r.page_id),
                     (select d.id from approval_groups d where d.is_default))
               and auth.uid() in (g.approver_id, g.delegate_id)))
    )
  order by (r.track = 'express') desc, t.due_at nulls last;
$$;

-- The reel's effective approver, for messages the app sends with the service
-- role (a comment by an external goes to them, I8).
create function public.reel_approver(p_reel_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select private.effective_approver(r.page_id) from reels r where r.id = p_reel_id;
$$;

create function public.set_sla_policy(p_page_id uuid, p_track reel_track, p_step sla_step, p_minutes integer)
returns text language sql security definer set search_path = public, private as $$
  select private.set_sla_policy(auth.uid(), p_page_id, p_track, p_step, p_minutes);
$$;

create function public.set_approval_group(p_group_id uuid, p_approver uuid, p_delegate uuid)
returns text language sql security definer set search_path = public, private as $$
  select private.set_approval_group(auth.uid(), p_group_id, p_approver, p_delegate);
$$;

revoke execute on function public.approval_queue() from public, anon, authenticated;
revoke execute on function public.set_sla_policy(uuid, reel_track, sla_step, integer) from public, anon, authenticated;
revoke execute on function public.set_approval_group(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reel_approver(uuid) from public, anon, authenticated;
grant execute on function public.reel_approver(uuid) to service_role;
grant execute on function public.approval_queue() to authenticated;
grant execute on function public.set_sla_policy(uuid, reel_track, sla_step, integer) to authenticated;
grant execute on function public.set_approval_group(uuid, uuid, uuid) to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
