-- Fase 0 — security hardening (docs/brain-plan.md).
--
-- 1. Profiles: a user may edit only their own display fields. `is_admin` and
--    the Telegram link can no longer be changed through the API by the user;
--    the bootstrap-admin and Telegram-unlink flows go through SECURITY DEFINER
--    functions instead.
-- 2. Reels: insert/delete become admin-only; updates are limited to admins and
--    page members (R/A/C in any phase of the reel's page), and only on content
--    columns. Phase columns change only through decide_phase_advance().
-- 3. Phase advance: requests can be filed only by the phase's Responsible (or
--    an admin) for the reel's current phase; the requester may only cancel;
--    decisions go through decide_phase_advance(), which also fixes approvers
--    who are not admins being silently blocked by RLS.

-------------------------------------------------------------------------------
-- Helpers used by policies
-------------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false);
$$;

-- p_role: 'responsible' | 'approver' | 'consulted' | 'informed'
create or replace function public.has_raci_role(p_page_id uuid, p_phase pipeline_phase, p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from raci_configs rc
    where rc.page_id = p_page_id
      and rc.phase = p_phase
      and auth.uid() = any (
        case p_role
          when 'responsible' then rc.responsible
          when 'approver' then rc.approver
          when 'consulted' then rc.consulted
          when 'informed' then rc.informed
        end
      )
  );
$$;

-- A page member is anyone Responsible, Approver or Consulted in any phase.
create or replace function public.is_page_member(p_page_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from raci_configs rc
    where rc.page_id = p_page_id
      and auth.uid() = any (rc.responsible || rc.approver || rc.consulted)
  );
$$;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.has_raci_role(uuid, pipeline_phase, text) from public, anon;
revoke execute on function public.is_page_member(uuid) from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.has_raci_role(uuid, pipeline_phase, text) to authenticated, service_role;
grant execute on function public.is_page_member(uuid) to authenticated, service_role;

-------------------------------------------------------------------------------
-- 1. Profiles
-------------------------------------------------------------------------------

revoke update on table profiles from anon, authenticated;
grant update (full_name, daily_reminder_at) on table profiles to authenticated;

-- Promote the caller to admin only while no admin exists (fresh deployments).
create or replace function public.claim_admin_if_first()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;
  -- Serialise concurrent claims so only one user can win.
  perform pg_advisory_xact_lock(hashtext('claim_admin_if_first'));
  if exists (select 1 from profiles where is_admin) then
    return false;
  end if;
  update profiles set is_admin = true where id = v_uid;
  return found;
end;
$$;

create or replace function public.unlink_telegram()
returns void
language sql
security definer
set search_path = public
as $$
  update profiles set telegram_chat_id = null where id = auth.uid();
$$;

revoke execute on function public.claim_admin_if_first() from public, anon;
revoke execute on function public.unlink_telegram() from public, anon;
grant execute on function public.claim_admin_if_first() to authenticated;
grant execute on function public.unlink_telegram() to authenticated;

-------------------------------------------------------------------------------
-- 2. Reels
-------------------------------------------------------------------------------

drop policy if exists reels_write_auth on reels;

create policy reels_insert_admin on reels
  for insert to authenticated
  with check (public.is_admin());

create policy reels_delete_admin on reels
  for delete to authenticated
  using (public.is_admin());

create policy reels_update_member on reels
  for update to authenticated
  using (public.is_admin() or public.is_page_member(page_id))
  with check (public.is_admin() or public.is_page_member(page_id));

-- Identity, placement and phase columns are not user-editable.
revoke update on table reels from anon, authenticated;
grant update (
  title, format, category,
  hook, corpo, chiusura, cta, notes,
  raw_content, parser_warning,
  audio_drive_url, video_drive_url,
  caption, scheduled_at, posted_url
) on table reels to authenticated;

-------------------------------------------------------------------------------
-- 3. Phase advance
-------------------------------------------------------------------------------

drop policy if exists phase_advance_requests_insert_auth on phase_advance_requests;
drop policy if exists phase_advance_requests_update_auth on phase_advance_requests;

create policy phase_advance_requests_insert_responsible on phase_advance_requests
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and status = 'pending'
    and exists (
      select 1
      from reels r
      where r.id = reel_id
        and r.phase = from_phase
        and (public.is_admin() or public.has_raci_role(r.page_id, r.phase, 'responsible'))
    )
  );

-- The requester may only withdraw their own pending request.
create policy phase_advance_requests_cancel_own on phase_advance_requests
  for update to authenticated
  using (requested_by = auth.uid() and status = 'pending')
  with check (requested_by = auth.uid() and status = 'cancelled');

revoke update on table phase_advance_requests from anon, authenticated;
grant update (status, decided_at) on table phase_advance_requests to authenticated;

-- Approve or reject a pending request atomically. Returns 'ok' or an error code
-- matching PhaseAdvanceResult in src/lib/phase-advance/actions.ts.
create or replace function public.decide_phase_advance(
  p_request_id uuid,
  p_decision phase_advance_status,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req phase_advance_requests%rowtype;
  v_reel reels%rowtype;
  v_now timestamptz := now();
begin
  if v_uid is null then
    return 'not_authorized';
  end if;
  if p_decision not in ('approved', 'rejected') then
    return 'invalid_input';
  end if;

  select * into v_req from phase_advance_requests where id = p_request_id for update;
  if not found then
    return 'request_not_found';
  end if;
  if v_req.status <> 'pending' then
    return 'invalid_input';
  end if;

  select * into v_reel from reels where id = v_req.reel_id for update;
  if not found then
    return 'reel_not_found';
  end if;
  -- The reel moved since the request was filed: the request is stale.
  if v_reel.phase <> v_req.from_phase then
    return 'stale_request';
  end if;

  if not (public.is_admin() or public.has_raci_role(v_reel.page_id, v_reel.phase, 'approver')) then
    return 'not_authorized';
  end if;

  -- DoD gate also holds at decision time (items may be unchecked after the request).
  if p_decision = 'approved'
     and v_req.from_phase = 'editing'
     and v_req.to_phase = 'publication'
     and (select count(*) from reel_dod_items d where d.reel_id = v_reel.id)
         < (select count(*) from unnest(enum_range(null::dod_item_key)))
  then
    return 'dod_incomplete';
  end if;

  update phase_advance_requests
     set status = p_decision,
         decided_by = v_uid,
         decided_at = v_now,
         decision_note = p_note
   where id = v_req.id;

  if p_decision = 'approved' then
    update reels
       set phase = v_req.to_phase,
           phase_entered_at = v_now,
           phase_status = 'green'
     where id = v_reel.id;
  end if;

  return 'ok';
end;
$$;

revoke execute on function public.decide_phase_advance(uuid, phase_advance_status, text) from public, anon;
grant execute on function public.decide_phase_advance(uuid, phase_advance_status, text) to authenticated;
