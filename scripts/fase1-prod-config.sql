-- Fase 1 production configuration (release step 8; rehearsed in steps 0a/0b
-- by scripts/db-check/rehearse-dump.sh). Reviewed by the user before use.
--
--   psql "$PROD_DB_URL" -f scripts/fase1-prod-config.sql
--
-- People are resolved by email, never by copied uuids: pg_temp.person()
-- stops everything if an email has no profile, is deactivated, or has the
-- wrong account type / external kind. One transaction: an error leaves no
-- partial configuration.
--
-- Ramp (docs/fase1-plan.md D7): for the first 48 h externals are titulars
-- and reserves on ONE page only; fase1-prod-config-ramp.sql extends them.
-- Escalation and stand-up stay off until step 11.

\set ON_ERROR_STOP on

-- ===== CONFIG: edit, then have it reviewed ==================================
\set approver_email 'CHANGE-ME'
\set delegate_email 'CHANGE-ME'
-- ============================================================================

begin;

create function pg_temp.person(p_email text, p_type account_type, p_kind external_kind default null)
returns uuid
language plpgsql
as $$
declare
  v public.profiles%rowtype;
begin
  select * into v from public.profiles where lower(email) = lower(trim(p_email));
  if not found then
    raise exception 'person %: no profile', p_email;
  end if;
  if v.deactivated_at is not null then
    raise exception 'person %: deactivated', p_email;
  end if;
  if v.account_type <> p_type or v.external_kind is distinct from p_kind then
    raise exception 'person %: is %/%, expected %/%', p_email, v.account_type, v.external_kind, p_type, p_kind;
  end if;
  return v.id;
end;
$$;

-- A page worker: an internal, or the external of that kind.
create function pg_temp.worker(p_email text, p_kind external_kind)
returns uuid
language plpgsql
as $$
declare
  v_type account_type;
begin
  if p_email is null or trim(p_email) = '' then
    return null;
  end if;
  select account_type into v_type from public.profiles where lower(email) = lower(trim(p_email));
  return case when v_type = 'internal' then pg_temp.person(p_email, 'internal')
              else pg_temp.person(p_email, 'external', p_kind) end;
end;
$$;

-- Approver and delegate of the default group ("Tutte le pagine").
update approval_groups
   set approver_id = pg_temp.person(:'approver_email', 'internal'),
       delegate_id = pg_temp.person(:'delegate_email', 'internal')
 where is_default;

-- Pages: validation flag, titular and reserve dubber/animator, validator.
-- One row per page to configure; empty string = nobody. Externals on the
-- ramp page only for the first 48 h.
create temp table page_config (
  code_prefix text primary key,
  requires_validation boolean not null,
  dubber_titular text, dubber_reserve text,
  animator_titular text, animator_reserve text,
  validator text
) on commit drop;

insert into page_config values
  -- ('PP', false, 'dubber1@…', 'dubber2@…', 'animator1@…', 'animator2@…', '')
  ('CHANGE-ME', false, '', '', '', '', '');

do $$
declare
  c record;
  v_page uuid;
begin
  for c in select * from page_config loop
    select id into v_page from pages where code_prefix = c.code_prefix;
    if v_page is null then
      raise exception 'page %: not found', c.code_prefix;
    end if;
    update pages set
      requires_scientific_validation = c.requires_validation,
      dubber_titular_id = pg_temp.worker(c.dubber_titular, 'dubber'),
      dubber_reserve_id = pg_temp.worker(c.dubber_reserve, 'dubber'),
      animator_titular_id = pg_temp.worker(c.animator_titular, 'animator'),
      animator_reserve_id = pg_temp.worker(c.animator_reserve, 'animator'),
      validator_id = pg_temp.worker(c.validator, 'validator')
    where id = v_page;
  end loop;
end $$;

-- Switches: escalation and stand-up off until step 11; Drive off until R2.
select public.set_app_config('escalation_enabled', 'false');
select public.set_app_config('standup_enabled', 'false');
select public.set_app_config('drive_enabled', 'false');

commit;
