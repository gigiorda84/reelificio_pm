-- Fase 1 (S3) — the send-back note reaches whoever reworks the task.
--
-- A reworked task points to the one it replaces (previous_task_id), usually
-- the approver's: an external cannot read that row (tasks_read), so the note
-- explaining why the work came back never reached them. This returns only
-- that note, only to an internal or to the holder of the task.

create function public.task_previous_note(p_task_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.decision_note
  from tasks t
  join tasks p on p.id = t.previous_task_id
  where t.id = p_task_id
    and (public.is_internal()
         or (t.assignee_id = auth.uid() and t.reel_id = any (public.visible_reel_ids())));
$$;

revoke execute on function public.task_previous_note(uuid) from public, anon, authenticated;
grant execute on function public.task_previous_note(uuid) to authenticated;
