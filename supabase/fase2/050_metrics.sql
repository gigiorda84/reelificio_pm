-- Fase 2 S7 — Script Lab metrics for admins (docs/fase2-plan.md S7,
-- AC22–AC25). One read-only function, months in Europe/Rome. Re-runnable
-- (functions and grants only): S6 extends it with `costs` and the Script
-- Lab split of `sendback` once ai_runs and ai_generations exist (030).
--
-- Sections, for the months of [p_from, p_to) (both the first of a month):
--   sendback   — reels by month of their first review (reviews made by the
--                R1 reconcile, origin `migration`, left out): arrived,
--                decided (a review approved or sent back) and sent back (at
--                least one review `sent_back`). Target ≤ 1 in 5 decided.
--   batches    — batches by month (coalesce(period, month of the first
--                reel's code, private._code_month)) and origin, with their
--                reels.
--   bibles     — active pages and how many bibles are complete (tone,
--                characters, duration, at least one CTA: bibleCompleteness
--                in src/lib/bible/schema.ts). Today's state, not by month.
--   authors    — reels by month of their first `writing` delivery, per
--                author (the assignee of that task).
--   provenance — reels by month of their last `writing` delivery, with
--                reel_script_provenance (S4): mixed, bases and blocks by
--                model, manual edits after the mix.

create or replace function private.script_lab_metrics(p_actor uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_lo timestamptz;
  v_hi timestamptz;
  v_sendback jsonb;
  v_batches jsonb;
  v_bibles jsonb;
  v_authors jsonb;
  v_provenance jsonb;
begin
  if not coalesce(private.is_admin_uid(p_actor), false) then
    raise exception 'script_lab_metrics: admins only' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from >= p_to or p_to > p_from + interval '25 months'
     or extract(day from p_from) <> 1 or extract(day from p_to) <> 1 then
    raise exception 'script_lab_metrics: invalid period' using errcode = '22023';
  end if;
  v_lo := p_from::timestamp at time zone 'Europe/Rome';
  v_hi := p_to::timestamp at time zone 'Europe/Rome';

  with review as (
    select t.reel_id, t.created_at, t.status, t.id
      from tasks t
     where t.kind = 'review' and t.origin <> 'migration'
  ), cohort as (
    select f.month,
           exists (select 1 from review s where s.reel_id = f.reel_id and s.status in ('approved', 'sent_back')) as decided,
           exists (select 1 from review s where s.reel_id = f.reel_id and s.status = 'sent_back') as sent_back
      from (select distinct on (reel_id) reel_id, created_at,
                   to_char(created_at at time zone 'Europe/Rome', 'YYYY-MM') as month
              from review order by reel_id, created_at, id) f
     where f.created_at >= v_lo and f.created_at < v_hi
  )
  select coalesce(jsonb_agg(jsonb_build_object('month', month, 'arrived', arrived, 'decided', decided,
                                               'sent_back', sent_back)
                            order by month), '[]')
    into v_sendback
    from (select month, count(*) as arrived, count(*) filter (where decided) as decided,
                 count(*) filter (where sent_back) as sent_back
            from cohort group by month) x;

  with batch_month as (
    select b.origin,
           coalesce(b.period, (
             select private._code_month(r.code, b.created_at)
               from reels r where r.batch_id = b.id
              order by r.ordinal, r.created_at limit 1)) as month,
           (select count(*) from reels r where r.batch_id = b.id) as reels
      from batches b
  )
  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(month, 'YYYY-MM'), 'origin', origin,
                                               'batches', batches, 'reels', reels)
                            order by month, origin), '[]')
    into v_batches
    from (select month, origin, count(*) as batches, sum(reels) as reels
            from batch_month
           where month >= date_trunc('month', p_from)::date and month < p_to
           group by month, origin) x;

  with page_gaps as (
    select p.id, p.name,
           array_remove(array[
             -- Any whitespace, like trim() in bibleCompleteness.
             case when coalesce(b.tone, '') ~ '^[[:space:]]*$' then 'tone' end,
             case when coalesce(b.characters, '') ~ '^[[:space:]]*$' then 'characters' end,
             case when b.duration_min_s is null or b.duration_max_s is null then 'duration' end,
             case when coalesce(cardinality(b.allowed_ctas), 0) = 0 then 'cta' end
           ], null) as missing
      from pages p
      left join page_bibles b on b.page_id = p.id
     where p.active
  )
  select jsonb_build_object(
           'active_pages', count(*),
           'complete', count(*) filter (where cardinality(missing) = 0),
           'pages', coalesce(jsonb_agg(jsonb_build_object('page_id', id, 'name', name, 'missing', to_jsonb(missing))
                                       order by name, id), '[]'))
    into v_bibles
    from page_gaps;

  with first_delivery as (
    select distinct on (t.reel_id) t.reel_id, t.assignee_id, t.closed_at
      from tasks t
     where t.kind = 'writing' and t.status = 'delivered'
     order by t.reel_id, t.closed_at, t.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('month', x.month, 'author_id', x.assignee_id,
                                               'name', pr.full_name, 'reels', x.reels)
                            order by x.month, x.reels desc, pr.full_name), '[]')
    into v_authors
    from (select to_char(closed_at at time zone 'Europe/Rome', 'YYYY-MM') as month, assignee_id,
                 count(*) as reels
            from first_delivery
           where closed_at >= v_lo and closed_at < v_hi
           group by 1, 2) x
    left join profiles pr on pr.id = x.assignee_id;

  with last_delivery as (
    select t.reel_id, max(t.closed_at) as closed_at
      from tasks t
     where t.kind = 'writing' and t.status = 'delivered'
     group by t.reel_id
  ), cohort as (
    select to_char(l.closed_at at time zone 'Europe/Rome', 'YYYY-MM') as month,
           public.reel_script_provenance(l.reel_id) as p
      from last_delivery l
     where l.closed_at >= v_lo and l.closed_at < v_hi
  ), mixed as (
    select month, p from cohort where jsonb_typeof(p -> 'blocks') = 'object'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'month', m.month,
           'delivered', m.delivered,
           'mixed', m.mixed,
           'edited_after_mix', m.edited,
           'bases', coalesce((select jsonb_object_agg(k, n) from (
                      select coalesce(x.p ->> 'base_model', 'manuale') as k, count(*) as n
                        from mixed x where x.month = m.month group by 1) b), '{}'),
           'blocks', coalesce((select jsonb_object_agg(k, n) from (
                      select e.value #>> '{}' as k, count(*) as n
                        from mixed x, jsonb_each(x.p -> 'blocks') e
                       where x.month = m.month group by 1) b), '{}'))
           order by m.month), '[]')
    into v_provenance
    from (select c.month, count(*) as delivered,
                 count(*) filter (where jsonb_typeof(c.p -> 'blocks') = 'object') as mixed,
                 count(*) filter (where (c.p ->> 'edited_after_mix')::boolean) as edited
            from cohort c group by c.month) m;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'sendback', v_sendback,
    'batches', v_batches,
    'bibles', v_bibles,
    'authors', v_authors,
    'provenance', v_provenance);
end;
$$;

create or replace function public.script_lab_metrics(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public, private, pg_temp as $$
  select private.script_lab_metrics(auth.uid(), p_from, p_to);
$$;

revoke execute on function public.script_lab_metrics(date, date) from public, anon, authenticated;
grant execute on function public.script_lab_metrics(date, date) to authenticated, service_role;

revoke execute on all functions in schema private from public, anon, authenticated;
