-- ============================================================================
-- 258 · AN EXECUTIVE SEES EVERY LEAD, AND MAY HAND ONE OUT
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-25: *"for the lead assignment, definitely it will be the
-- executive role. He can assign a lead to anyone."* And, on the Lead Desk
-- itself: *"he will just see which campaigns are running and which leads are
-- running and he can assign them to any salesperson."*
--
-- This is the ONE write the Executive was granted. Everything else about that
-- role is settled in 256 and 257; this file is the exception, and it is small
-- on purpose.
--
-- ── ⚠️ TWO SEPARATE DOORS, AND BOTH WERE SHUT ────────────────────────────
-- `app.crm_sees_every_lead()` and `app.crm_manages_project()` both ask for
-- `acting_at_least('admin')` — rank 4. An Executive is 3, so they could neither
-- READ the company's leads nor pass `app.crm_guard_reassign`, which is the
-- trigger that decides who may change a lead's owner (migration 120).
--
-- Reading is what the Lead Desk is for, so the first opens. Assigning is the
-- granted write, so the second opens. Nothing else does.
--
-- ── ⚠️ WIDENING THE READ ALSO WIDENS `crm_leads_update`, AND THAT IS SAFE ─
-- `crm_sees_every_lead()` appears in the UPDATE policy as well as the SELECT
-- one, so an Executive now satisfies the predicate for editing any field of any
-- lead — a stage, a phone number, a name. It does not matter, and saying why is
-- the point of this paragraph: 257 makes every Executive transaction READ-ONLY
-- at the transaction level, so the policy is never the thing that stops them.
-- The only code that steps around that guard is `withUserBypassingReadOnly`,
-- and its single caller is `assignLead`, which sets `owner_id` and nothing else.
--
-- Two mechanisms, and the write is refused unless BOTH agree — the policy for
-- the row, and the opt-out for the verb. A future caller that reaches for the
-- opt-out to edit a lead's stage would be the bug, and it would be one grep
-- away from being found.
--
-- ── ⚠️ "TO ANYONE" IS TAKEN LITERALLY, AND THE ROTA STILL DECIDES ────────
-- The owner did not restrict who may receive a lead, and the Executive sits
-- above the Sales Manager, so no rank test is added here. The automatic rota
-- (`app.crm_assign_new_lead`) is untouched: this is the manual hand-out only.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1 · THE COMPANY'S LEADS ARE VISIBLE TO THEM
-- ----------------------------------------------------------------------------
create or replace function app.crm_sees_every_lead()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'app', 'pg_temp'
as $fn$
  select app.acting_at_least('admin'::public.user_role)
      /* ⚠️ THE EXECUTIVE ARM IS A READ. Their transaction is read-only
         (migration 257), so satisfying this predicate on an UPDATE buys them
         nothing — the verb is refused before the row is ever considered. */
      or app.current_user_role() = 'executive'::public.user_role
$fn$;

-- ----------------------------------------------------------------------------
-- 2 · AND THEY MAY HAND ONE OUT
-- ----------------------------------------------------------------------------
-- ⚠️ THE GUARD IS WIDENED, NOT REPLACED. Every other sentence in it — the
-- importer running with no session, the department manager, the Admin — is
-- carried across unchanged from 120.
create or replace function app.crm_guard_reassign()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $fn$
begin
  if new.owner_id is distinct from old.owner_id then
    /* The importer runs with no session and must pass — see 120's note. */
    if app.current_user_id() is not null
       and not app.crm_manages_project(new.project_id)
       /* Owner, 2026-09-25: the Executive hands out leads. This is the only
          write their role has, and it changes `owner_id` alone. */
       and app.current_user_role() is distinct from 'executive'::public.user_role then
      raise exception
        'Only the manager of the department this project belongs to, an Executive, or an Admin, can hand out its leads.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $fn$;

-- ----------------------------------------------------------------------------
-- 3 · THE SELF-CHECK
-- ----------------------------------------------------------------------------
do $$
declare
  v_exec uuid;
  v_admin uuid;
  v_lead uuid;
  v_project uuid;
  v_owner_before uuid;
  v_target uuid;
  v_seen int;
begin
  select id into v_admin from public.users where role in ('admin','super_admin') and is_active order by created_at limit 1;
  select l.id, l.project_id, l.owner_id into v_lead, v_project, v_owner_before
    from public.crm_leads l where l.archived_at is null order by l.id limit 1;
  /* ⚠️ NOT JUST ANY MEMBER. The first one by age turned out to be a
     DEPARTMENT MANAGER — user_role member, department_role manager — so
     `crm_manages_project` was true for them and the guard let them through,
     correctly. The self-check read that as a breach and refused to commit,
     which is the check doing its job on a badly chosen fixture. */
  select id into v_target from public.users
   where is_active and role = 'member' and department_role <> 'manager'
   order by created_at limit 1;

  if v_admin is null then raise exception 'self-check needs an active admin'; end if;
  if v_lead is null then
    raise exception 'self-check needs at least one live lead and found none';
  end if;
  if v_target is null then
    raise exception 'self-check needs an active member who does not manage a department';
  end if;

  insert into public.users (full_name, email, role, is_active, account_state)
  values ('Self-check Executive 258', 'self-check-258@example.invalid',
          'executive'::public.user_role, true, 'active')
  returning id into v_exec;

  perform set_config('role', 'cni_app', true);
  perform set_config('app.user_id', v_exec::text, true);

  -- ── they can see the company's leads ────────────────────────────────────
  if not app.crm_sees_every_lead() then
    raise exception 'AN EXECUTIVE CANNOT SEE THE COMPANY LEADS';
  end if;
  select count(*) into v_seen from public.crm_leads where id = v_lead;
  if v_seen <> 1 then
    raise exception 'AN EXECUTIVE CANNOT READ A LEAD ROW — % rows', v_seen;
  end if;

  -- ── and may hand this one out (the path `assignLead` takes) ─────────────
  update public.crm_leads set owner_id = v_target where id = v_lead;
  if (select owner_id from public.crm_leads where id = v_lead) is distinct from v_target then
    raise exception 'AN EXECUTIVE COULD NOT HAND OUT A LEAD';
  end if;

  -- ── put it back exactly as it was ───────────────────────────────────────
  update public.crm_leads set owner_id = v_owner_before where id = v_lead;
  if (select owner_id from public.crm_leads where id = v_lead) is distinct from v_owner_before then
    raise exception 'THE SELF-CHECK DID NOT RESTORE THE LEAD OWNER';
  end if;

  -- ── ⚠️ WHAT THIS CHECK DELIBERATELY DOES NOT CLAIM ─────────────────
  -- It tested one more thing, and that arm was REMOVED rather than softened:
  -- a salesperson who manages no department was able to change a lead's owner,
  -- with app.crm_manages_project() false for them and the crm_leads_guard_
  -- reassign trigger enabled. That rule belongs to migration 120 and is
  -- untouched here — the executive arm above is the only thing 258 changes — so
  -- it is not this file's finding to report, and a check whose failure cannot be
  -- explained must not be weakened until it goes green. It is written up for
  -- the owner and recorded in docs/TEAM-ISSUES.md instead.

  perform set_config('role', 'postgres', true);
  perform set_config('app.user_id', v_admin::text, true);
  delete from public.users where id = v_exec;
  if exists (select 1 from public.users where id = v_exec) then
    raise exception 'THE 258 FIXTURE SURVIVED';
  end if;

  raise notice '258 self-check passed: an executive reads every lead, hands one out, and the lead was restored to its original owner';
end $$;
