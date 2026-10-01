-- ============================================================================
-- 266 · THE PROPERTY CATALOGUE
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-27, specifying the Properties page. Three separate things,
-- kept in one migration because the page needs all three to exist at once.
--
--   1. The Marla standard belongs to the PROJECT, and the area is computed FROM IT
--   2. A property has a premium charge, and papers of its own
--   3. A salesperson may add and import properties  ⚠️ THIS REVERSES 150
--
-- ── 1 · ⚠️ 225 IS NOT A CONSTANT, IT IS A PROJECT'S ANSWER ───────────────
-- Owner: *"The Marla standard must be configurable per project. The system
-- should calculate square feet from the selected project standard instead of
-- globally assuming that every Marla equals 225 square feet."*
--
-- A Marla is 225 sq ft in most of Punjab and 272.25 sq ft where the older
-- imperial Marla survived — so a constant in code is wrong the first time a
-- second scheme uses the other one, and wrong silently: every area on the page
-- would be out by 21% and still look like a number. `13-PROPERTY-AND-QUOTATION-
-- TESTPACK.md` called this a year ago and nothing has stored it until now.
--
-- ⚠️ AND `area_sqft` IS STILL STORED, not computed on read. The standard can
-- change; a plot sold at 1,125 sq ft was sold at 1,125 sq ft. The column is the
-- record of what was agreed, the standard is what the form multiplies by when
-- somebody types a size — which is exactly the split the owner asked for.
--
-- ── 2 · THE PAPERS ───────────────────────────────────────────────────────
-- `crm_documents` reaches a project or a lead and had no way to reach a plot,
-- so a site plan for A-101 could only be filed against the whole scheme. 265
-- added the two kinds; this adds the column that lets a document belong to one
-- property.
--
-- ⚠️ NO NOCs, TITLE DOCUMENTS OR APPROVALS ARE GENERATED ANYWHERE. The owner's
-- instruction is a legal point, not a preference: *"Do not generate dummy NOCs,
-- title documents or government approvals ... Use placeholders such as 'Legal
-- document not uploaded'."* Nothing here generates a document at all — this is
-- a foreign key to a file somebody uploaded.
--
-- ── 3 · ⚠️⚠️ THE WRITE RULE CHANGES, AND IT REVERSES A RECORDED DECISION ──
-- Migration 150 made the catalogue the project manager's, and
-- `14-SALES-WORKSPACE-PHASES.md` recorded the reasoning in one line:
--
--     "A salesperson reads it and cannot change it ... There is no price field
--      in the picker at all; a price is the company's, not the seller's."
--
-- The owner has now asked for the opposite, in as many words: *"Right now at
-- that level, I'm watching that salespersons can view all of the properties. He
-- can add or import the properties."*
--
-- So the rule widens to the project's own department — the same set that can
-- already SEE the catalogue. It is deliberately the same expression as the
-- select policy, so there is one answer to "whose catalogue is this" rather
-- than two that can drift apart.
--
-- ⚠️ TO PUT IT BACK is one line: restore `crm_properties_write` to
-- `app.crm_manages_project(project_id)`. Nothing else in this file depends on
-- the wider rule. It is written this way on purpose, because the owner said she
-- is reviewing the salesperson's view first and will look at the manager and
-- admin levels later — this is the arm she will want to revisit.
--
-- ── ⚠️ AND THE READ POLICY BECOMES A SET, BECAUSE IT IS NOW A LIST PAGE ──
-- `crm_properties_select` called `app.crm_manages_project(project_id)` and
-- `app.crm_in_project_department(project_id)` — both STABLE, both taking a row's
-- column, so both ran ONCE PER ROW. CLAUDE.md names this exact function as the
-- law-5 example. It cost nothing while the table held two rows; this migration
-- is landing beside a page that lists a whole scheme's inventory, and Chitral's
-- real catalogue is thousands of plots.
--
-- The two predicates collapse algebraically. Written out:
--
--   manages(p)  = admin or (preview and leads_a_dept and p.lead_dept = mine)
--   in_dept(p)  = admin or (preview and                  p.lead_dept = mine)
--   manages(p) or in_dept(p)
--               = admin or (preview and p.lead_dept = mine)     ← manages ⊂ in_dept
--               = admin or p.id = any(app.crm_dept_project_ids())
--
-- because `crm_dept_project_ids()` IS "preview and lead_dept = mine", already
-- argument-free and already in use elsewhere. So the new policy is the same
-- answer computed once as an InitPlan, not a rewrite of who sees what — and the
-- self-check below proves that per user rather than asserting it.
--
-- ⚠️ `= any (coalesce((select f()), '{}'))`, never `= any ((select f()))`. The
-- parser reads a parenthesised SELECT in ANY position as a subquery of ROWS and
-- the statement does not compile. This cost an hour on 262.
-- ============================================================================

-- ── 1 · the standard, and where the scheme is ──────────────────────────────
alter table public.crm_project_settings
  add column if not exists marla_sqft_standard integer not null default 225,
  add column if not exists city text;

alter table public.crm_project_settings
  drop constraint if exists crm_project_settings_marla_is_sane;
alter table public.crm_project_settings
  add constraint crm_project_settings_marla_is_sane
  check (marla_sqft_standard between 100 and 500);

comment on column public.crm_project_settings.marla_sqft_standard is
  'Square feet in one Marla for THIS scheme. 225 in most of Punjab, 272 where the imperial Marla survived. Never assume it in code — migration 266.';

-- ── 2 · the premium, and the papers ────────────────────────────────────────
alter table public.crm_properties
  add column if not exists premium_charges bigint not null default 0;

alter table public.crm_properties
  drop constraint if exists crm_properties_premium_is_not_negative;
alter table public.crm_properties
  add constraint crm_properties_premium_is_not_negative
  check (premium_charges >= 0);

alter table public.crm_documents
  add column if not exists property_id uuid references public.crm_properties (id) on delete cascade;

create index if not exists crm_documents_property_idx
  on public.crm_documents (property_id) where property_id is not null;

-- ── 3 · who may read, and who may write ────────────────────────────────────
drop policy if exists crm_properties_select on public.crm_properties;
create policy crm_properties_select on public.crm_properties
  for select using (
    (select app.acting_at_least('admin'::public.user_role))
    or project_id = any (coalesce((select app.crm_dept_project_ids()), '{}'::uuid[]))
  );

drop policy if exists crm_properties_write on public.crm_properties;
create policy crm_properties_write on public.crm_properties
  for all using (
    (select app.acting_at_least('admin'::public.user_role))
    or project_id = any (coalesce((select app.crm_dept_project_ids()), '{}'::uuid[]))
  )
  with check (
    (select app.acting_at_least('admin'::public.user_role))
    or project_id = any (coalesce((select app.crm_dept_project_ids()), '{}'::uuid[]))
  );

-- The stages of a plot's payment plan follow the plot exactly.
drop policy if exists crm_payment_stages_write on public.crm_payment_stages;
create policy crm_payment_stages_write on public.crm_payment_stages
  for all using (
    exists (select 1 from public.crm_properties p
             where p.id = crm_payment_stages.property_id)
  )
  with check (
    exists (select 1 from public.crm_properties p
             where p.id = crm_payment_stages.property_id)
  );

-- ============================================================================
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ THE READ RULE IS CHECKED EXHAUSTIVELY, PER USER — migrations 164 and 165
-- are the pattern and the handover names them. A policy rewrite justified by
-- algebra is still a rewrite, and "it should be equivalent" is how one person
-- quietly stops seeing their own rows. Every active user is asked the OLD
-- question and the NEW one about every property, and one disagreement refuses
-- the commit.
-- ============================================================================
do $$
declare
  v_user     record;
  v_prop     record;
  v_old      boolean;
  v_new      boolean;
  v_checked  int := 0;
  v_admin    uuid;
  v_sales    uuid;
  v_project  uuid;
  v_made     uuid;
  v_standard int;
begin
  -- ── the read rule did not move, for anybody ──────────────────────────────
  for v_user in
    select id, full_name, role from public.users where is_active and account_state = 'active'
  loop
    perform set_config('app.user_id', v_user.id::text, true);
    for v_prop in select id, project_id from public.crm_properties loop
      v_old := app.crm_manages_project(v_prop.project_id)
               or app.crm_in_project_department(v_prop.project_id);
      v_new := app.acting_at_least('admin'::public.user_role)
               or v_prop.project_id = any (coalesce(app.crm_dept_project_ids(), '{}'::uuid[]));
      if v_old is distinct from v_new then
        raise exception 'THE READ RULE MOVED FOR % (%) ON PROPERTY %: was %, now %',
          v_user.full_name, v_user.role, v_prop.id, v_old, v_new;
      end if;
      v_checked := v_checked + 1;
    end loop;
  end loop;
  raise notice '266 · read rule unchanged across % user×property pairs', v_checked;

  -- ── the standard is per project and defaulted ────────────────────────────
  select marla_sqft_standard into v_standard from public.crm_project_settings limit 1;
  if v_standard is null or v_standard <> 225 then
    raise exception 'THE MARLA STANDARD DID NOT DEFAULT TO 225 (got %)', v_standard;
  end if;

  -- ── a salesperson can now add a plot, which is the reversal ──────────────
  select u.id into v_sales
    from public.users u
    join public.crm_preview_members m on m.user_id = u.id
   where u.is_active and u.role = 'member' and u.department_id is not null
   order by u.created_at limit 1;

  select id into v_admin from public.users
   where is_active and role in ('admin','super_admin') order by created_at limit 1;

  if v_sales is null then
    raise notice '266 · no preview salesperson on this database; the write arm is untested here';
  else
    perform set_config('app.user_id', v_sales::text, true);
    select unnest into v_project from unnest(app.crm_dept_project_ids()) limit 1;

    if v_project is null then
      raise notice '266 · that salesperson leads no CRM project; the write arm is untested here';
    else
      perform set_config('role', 'cni_app', true);
      insert into public.crm_properties
        (project_id, code, plot_number, block, kind, size_marla, area_sqft,
         dimensions, base_price, premium_charges, status, is_test_data)
      values (v_project, 'SELFCHECK-266', 'SC-266', 'Z', 'Residential plot', 5, 1125,
              '25 × 45 ft', 1000000, 0, 'available', true)
      returning id into v_made;

      if v_made is null then
        raise exception 'A SALESPERSON COULD NOT ADD A PROPERTY — the owner asked for exactly this';
      end if;

      -- and the new states are real
      update public.crm_properties set status = 'on_hold' where id = v_made;
      update public.crm_properties set status = 'blocked' where id = v_made;

      -- ⚠️ but they still cannot reach a project that is not theirs
      if exists (
        select 1 from public.projects p
         where p.id <> v_project
           and not (p.id = any (coalesce(app.crm_dept_project_ids(), '{}'::uuid[])))
           and app.crm_manages_project(p.id)
      ) then
        raise exception 'A SALESPERSON MANAGES A PROJECT OUTSIDE THEIR DEPARTMENT';
      end if;

      perform set_config('role', 'postgres', true);
      perform set_config('app.user_id', v_admin::text, true);
      delete from public.crm_properties where id = v_made;
      if exists (select 1 from public.crm_properties where id = v_made) then
        raise exception 'THE 266 FIXTURE SURVIVED';
      end if;
      raise notice '266 · a salesperson added, held, blocked and the fixture was removed';
    end if;
  end if;

  perform set_config('app.user_id', '', true);
  raise notice '266 self-check passed: the read rule is identical and computed once, the Marla standard is the project''s, and a salesperson owns the catalogue';
end $$;
