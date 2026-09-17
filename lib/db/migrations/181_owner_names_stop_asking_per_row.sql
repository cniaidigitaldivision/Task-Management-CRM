-- ============================================================================
-- 181 · THE OWNER-NAMES READER STOPS ASKING PER ROW
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17: *"it is taking a lot of time to render… when I close that and
-- open some other row, it is again taking time to load… How can I manage 2,000,
-- 3,000 leads a day with this type of lazy system?"*
--
-- Measured as Sahad, statement by statement, every query the drawer runs:
--
--   every read of crm_leads, messages, notes, quotations …   0.06 – 3.3 ms
--   app.crm_lead_owners()                                   966 ms   ← this
--
-- And the drawer calls it THREE times — the owner's name, the thread's senders,
-- the related records' names — so roughly 2.9 of the 3.4 seconds one drawer took
-- was this one function. The list page calls it too, on every render.
--
-- ── ⚠️ THE SAME BUG LAW 5 NAMES, IN THE ONE PLACE 164/165 DID NOT REACH ─────
-- 121's body scans every lead and calls `app.crm_manages_project(l.project_id)`
-- and `app.crm_in_project_department(l.project_id)` for EACH ROW — a STABLE
-- function taking a row's column, which Postgres cannot hoist. 164 and 165 fixed
-- exactly this in `crm_leads_select` and left this reader, which restates the
-- same rule, on the per-row form. At 671 leads it is a second; at 200,000 it
-- would be minutes, on every drawer.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
-- The predicate becomes 165's policy word for word — computed ONCE as InitPlans,
-- tested per row as a constant. 164 proved that form identical to the per-row
-- one for every active user; this migration proves it again for THIS function,
-- because "it was fine last time" is not evidence.
-- ============================================================================

-- ── 1 · Record the old answer for every active user, before touching it ─────
create temp table _181_before (user_id uuid, owner_id uuid, full_name text, avatar_url text)
  on commit drop;

do $$
declare
  u record;
begin
  for u in select id from public.users where is_active loop
    perform set_config('app.user_id', u.id::text, true);
    insert into _181_before
      select u.id, o.id, o.full_name, o.avatar_url from app.crm_lead_owners() o;
  end loop;
end $$;

-- ── 2 · The rewrite ─────────────────────────────────────────────────────────
create or replace function app.crm_lead_owners()
returns table (id uuid, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select u.id, u.full_name, u.avatar_url
    from public.users u
   where u.id in (
     select l.owner_id
       from public.crm_leads l
      where l.owner_id is not null
        and (
          (select app.crm_sees_every_lead())
          or (
            /* coalesce: see 165 — without it ANY reads the subquery as a set. */
            l.project_id = any (coalesce((select app.crm_dept_project_ids()), '{}'::uuid[]))
            and (
              (select app.crm_manages_own_department())
              or l.owner_id = (select app.current_user_id())
            )
          )
        )
   )
$$;

comment on function app.crm_lead_owners() is
  'Names of the owners of leads the caller can see. 121''s rule in 165''s argument-free form — one evaluation, not one per lead. 181.';

-- ── 3 · Prove it: identical for every active user, and actually faster ───────
do $$
declare
  u        record;
  moved    int;
  checked  int := 0;
  t0       timestamptz;
  took     interval;
begin
  for u in select id, full_name from public.users where is_active loop
    perform set_config('app.user_id', u.id::text, true);

    select count(*) into moved from (
      (select owner_id, full_name, avatar_url from _181_before where user_id = u.id
       except
       select o.id, o.full_name, o.avatar_url from app.crm_lead_owners() o)
      union all
      (select o.id, o.full_name, o.avatar_url from app.crm_lead_owners() o
       except
       select owner_id, full_name, avatar_url from _181_before where user_id = u.id)
    ) diff;

    if moved <> 0 then
      raise exception '181 · % would see % different owner name(s) — refusing to commit',
        u.full_name, moved;
    end if;
    checked := checked + 1;
  end loop;

  -- The timing, as the person with the widest view (it is the slowest case).
  perform set_config('app.user_id',
    (select id::text from public.users where is_active and role = 'super_admin' limit 1), true);
  t0 := clock_timestamp();
  perform count(*) from app.crm_lead_owners();
  took := clock_timestamp() - t0;
  if took > interval '100 milliseconds' then
    raise exception '181 · still slow: % for one call', took;
  end if;

  raise notice '181 · owner names identical for all % active users; one call now takes %',
    checked, took;
end $$;
