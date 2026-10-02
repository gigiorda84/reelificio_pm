-- Fase 1 — task engine fix: no reliance on the order of timestamps that can
-- tie. Every task closed or created in one transaction shares now(), so
-- "the last closed task" was ambiguous inside a transaction (found by the
-- staging smoke run: schedule_reel then failed its derived-state check).

-- Without an open task the state no longer depends on which closed task is
-- "last": a delivered scheduling task means programmato (nothing follows it
-- but the publication).
create or replace function private.derived_state(p_reel_id uuid)
returns reel_state
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r reels%rowtype;
  t tasks%rowtype;
begin
  select * into r from reels where id = p_reel_id;
  if r.published_at is not null then
    return 'pubblicato';
  end if;

  select * into t from tasks
   where reel_id = p_reel_id and status in ('unassigned', 'assigned', 'in_progress');
  if found then
    return case t.kind
      when 'writing' then 'bozza'
      when 'review' then 'revisione'
      when 'validation' then 'validazione'
      when 'dubbing' then case
        when exists (select 1 from tasks d where d.reel_id = p_reel_id and d.kind = 'dubbing'
                      and d.accepted_at is not null) then 'doppiaggio'
        else 'confermato' end
      when 'audio_approval' then 'doppiaggio'
      when 'animation' then 'animazione'
      when 'final_approval' then 'approvazione_finale'
      when 'scheduling' then 'programmato'
    end::reel_state;
  end if;

  if exists (select 1 from tasks where reel_id = p_reel_id and kind = 'scheduling' and status = 'delivered') then
    return 'programmato';
  end if;
  if not exists (select 1 from tasks where reel_id = p_reel_id) then
    return case
      when r.state = 'pubblicato' then 'pubblicato'
      when r.state = 'programmato' and r.scheduled_at is not null then 'programmato'
      else 'idea' end::reel_state;
  end if;
  return null;
end;
$$;

-- attempt grows by one per kind on a reel: it breaks timestamp ties.
create or replace function private._last_assignee(p_reel_id uuid, p_kind task_kind, p_statuses task_status[])
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.assignee_id from tasks t
   where t.reel_id = p_reel_id and t.kind = p_kind and t.status = any (p_statuses)
     and t.assignee_id is not null
   order by coalesce(t.closed_at, t.created_at) desc, t.attempt desc
   limit 1;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
