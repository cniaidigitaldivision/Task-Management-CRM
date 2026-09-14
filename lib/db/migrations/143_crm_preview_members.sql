-- ============================================================================
-- 143 · THE CRM IS A PREVIEW, AND ONLY THE TESTERS ARE IN IT
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-14: *"tell me whether this CRM, basically all pages of the CRM,
-- is visible to Kashif Ayaz, who is the team coordinator, any of the members in
-- AI Digital… Please hide it from them… I just want to work on it with just
-- these testers: sale manager tester, sale 1 tester, sale 2 tester."*
--
-- Measured before this migration, under each person's own session:
--
--     Abdul Moiz, Abdullah, Arslan, Bilal Gul, Kashif Ali,
--     Najamullah, Rafay abbasi, Unzela  (AI & Digital) → desk YES
--     Kashif Ayaz                       (AI & Digital) → desk YES, reports YES
--     Junaid Ahmad, Lararib Rafique     (Development)  → no
--
-- So yes: all nine of AI & Digital could open the desk, and Kashif Ayaz could
-- also read the lead reports — the document that compares salespeople by name.
-- Nobody had done anything wrong; `crm_acting_department()` grants the desk to
-- any department that owns a lead-routed project, and AI & Digital owns one
-- because that is where its own enquiries are meant to land.
--
-- ── ⚠️ A PREVIEW LIST, NOT A CHANGE TO THE ROUTING MODEL ───────────────────
-- The obvious fix — take the lead projects off AI & Digital — would undo the
-- owner's own rule from 2026-09-12: *"AI & Digital leads → Kashif; all other
-- leads → only sale team and sale manager."* That rule is right and is meant to
-- come back the day the CRM is shown. So the routing is left exactly as it is
-- and one extra question is asked in front of it: are you in the preview?
--
-- ── ⚠️ AN EMPTY TABLE MEANS NO RESTRICTION ─────────────────────────────────
-- That is how the preview ENDS: `delete from public.crm_preview_members;` and
-- every rule returns to what it was, with nothing else to remember to undo.
-- It also means emptying this table by accident opens the CRM to the nine people
-- above, so it is not a place to tidy.
--
-- ── ⚠️ ADMINS ARE NOT ON THE LIST AND STILL GET IN ─────────────────────────
-- Every predicate below short-circuits on `acting_at_least('admin')` BEFORE the
-- preview is consulted, which keeps the owner's standing rule from 2026-09-12 —
-- *"admin/super admin by default will see everything"* — and keeps the owner
-- able to watch the testers work. That is Umm-e-Habiba (admin) and Ammar Afzal
-- Khan (super_admin), and nobody else: there are only two.
-- To take the CEO out too, this is the line to change, in all four places:
-- `app.acting_at_least('admin')` → `app.crm_preview_allows()` alone.
-- ============================================================================

create table if not exists public.crm_preview_members (
  user_id  uuid primary key references public.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  /* Why this person, in words, so the list explains itself when it is read back
     in a month by somebody wondering why the CRM is empty for them. */
  note     text
);

comment on table public.crm_preview_members is
  'While non-empty, ONLY these people (plus admin/super_admin) can see the CRM — '
  'the desk, the leads, the reports. Empty means no restriction, which is how the '
  'preview ends. Migration 143.';

alter table public.crm_preview_members enable row level security;

drop policy if exists crm_preview_members_select on public.crm_preview_members;
/* ⚠️ ADMINS ONLY, AND READ ONLY. Everything that needs this table reads it
   through the definer below; a salesperson has no reason to learn who else is
   in a preview, and nothing writes to it from the application at all. */
create policy crm_preview_members_select on public.crm_preview_members
  for select using (app.acting_at_least('admin'::public.user_role));

grant select on public.crm_preview_members to cni_app;

-- ════════════════════════════════════════════════════════════════════════════
-- THE QUESTION
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_preview_allows()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select not exists (select 1 from public.crm_preview_members)
      or exists (
        select 1 from public.crm_preview_members m
         where m.user_id = app.current_user_id()
      )
$$;

comment on function app.crm_preview_allows() is
  'True when the CRM preview is not in force, or when the caller is in it. '
  'ANDed into every CRM predicate after the admin short-circuit. Migration 143.';

revoke all on function app.crm_preview_allows() from public;
grant execute on function app.crm_preview_allows() to cni_app;

-- ════════════════════════════════════════════════════════════════════════════
-- THE FOUR PLACES THAT ASK IT
-- ----------------------------------------------------------------------------
-- ⚠️ FOUR, NOT ONE, AND THAT IS DELIBERATE. Two of these gate the PAGES and two
-- gate the ROWS. Hiding only the pages would leave a lead readable to anybody
-- who kept a URL, and hiding only the rows would leave the nav advertising an
-- empty desk. Bodies are otherwise copied verbatim from 124 and 129.
-- ════════════════════════════════════════════════════════════════════════════

/** Do you run the department this project's leads belong to? */
create or replace function app.crm_manages_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.acting_at_least('admin'::public.user_role)
      or (
        app.crm_preview_allows()
        and app.acting_leads_a_department()
        and exists (
          select 1 from public.projects p
           where p.id = p_project
             and p.lead_department_id = app.acting_department_id()
        )
      )
$$;

/** Are you in the department this project's leads belong to, at all? */
create or replace function app.crm_in_project_department(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.acting_at_least('admin'::public.user_role)
      or (
        app.crm_preview_allows()
        and exists (
          select 1 from public.projects p
           where p.id = p_project
             and p.lead_department_id is not null
             and p.lead_department_id = app.acting_department_id()
        )
      )
$$;

/** May you open the Campaign & Lead Desk at all? */
create or replace function app.crm_is_open_to_caller()
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.acting_at_least('admin'::public.user_role)
      or (
        app.crm_preview_allows()
        and app.acting_department_id() is not null
        and exists (
          select 1 from public.projects p
           where p.lead_department_id = app.acting_department_id()
        )
      )
$$;

/* ⚠️ AND THIS ONE IS WHAT THE SIDEBAR READS. `crmIsOpenTo()` and
   `crmReportsOpenTo()` in `lib/auth/current-user.ts` are both
   `admin || super_admin || department.ownsLeadProjects`, and `owns_leads` is
   this column — so gating it here hides the nav entry, the `/leads` guard and
   the `/lead-reports` guard together, with no TypeScript change at all and no
   second copy of the rule to keep in step. */
create or replace function app.crm_acting_department()
returns table (
  key             text,
  name            text,
  department_role text,
  owns_leads      boolean
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select d.key,
         d.name,
         u.department_role::text,
         app.crm_preview_allows()
           and exists (
             select 1 from public.projects p
              where p.lead_department_id = d.id
                and not p.is_draft
           )
    from public.users u
    join public.departments d on d.id = u.department_id
   where u.id = app.current_user_id()
     and u.is_active
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- THE LIST
-- ════════════════════════════════════════════════════════════════════════════
insert into public.crm_preview_members (user_id, note)
select u.id, 'CRM preview — owner, 2026-09-14'
  from public.users u
 where u.is_active
   and u.full_name in ('sale manager tester', 'Sale Tester', 'Sale 2 tester')
on conflict (user_id) do nothing;

-- ============================================================================
-- SELF-CHECK — under each person's own session, which is the only way any of
-- this has ever been measured correctly.
-- ============================================================================
do $$
declare
  v_proj    uuid;
  v_leads   int;
  p         record;
  n_preview int;
  v_open    boolean;
  v_rows    int;
begin
  select count(*) into n_preview from public.crm_preview_members;
  if n_preview <> 3 then
    raise exception '143 · the preview list holds % people, expected the 3 testers', n_preview;
  end if;

  select id into v_proj from public.projects
   where lead_department_id is not null and not is_draft limit 1;
  select count(*) into v_leads from public.crm_leads;

  for p in
    select u.id, u.full_name, u.role, d.key as dkey,
           exists (select 1 from public.crm_preview_members m where m.user_id = u.id) as on_list
      from public.users u left join public.departments d on d.id = u.department_id
     where u.is_active
  loop
    set local role cni_app;
    perform set_config('app.user_id', p.id::text, true);
    select app.crm_is_open_to_caller() into v_open;
    select count(*) into v_rows from public.crm_leads;
    reset role;

    /* 1 · An admin is untouched, on the list or not. */
    if p.role in ('admin', 'super_admin') then
      if not v_open then
        raise exception '143 · % (%) lost the desk — admins must not be gated', p.full_name, p.role;
      end if;
      continue;
    end if;

    /* 2 · A tester keeps everything they had. */
    if p.on_list then
      if not v_open then
        raise exception '143 · tester % cannot open the desk', p.full_name;
      end if;
      if v_rows = 0 then
        raise exception '143 · tester % can open the desk and sees no leads', p.full_name;
      end if;
      continue;
    end if;

    /* 3 · ⚠️ AND EVERYBODY ELSE SEES NOTHING — the pages AND the rows. A URL
           kept from yesterday must not still open a lead. */
    if v_open then
      raise exception '143 · % (%) can still open the desk', p.full_name, coalesce(p.dkey, 'no department');
    end if;
    if v_rows <> 0 then
      raise exception '143 · % (%) can still read % leads', p.full_name, coalesce(p.dkey, 'no department'), v_rows;
    end if;
  end loop;

  /* 4 · ⚠️ AND THE MACHINERY IS UNTOUCHED. The importer, the webhook and the
         rota all write through SECURITY DEFINER functions with no session; if
         this migration had narrowed those, leads would silently stop arriving
         and nobody would find out for days. */
  if (select count(*) from public.crm_leads) <> v_leads then
    raise exception '143 · the definer-path lead count moved';
  end if;

  raise notice '143 · the CRM is a preview for % testers; % leads still arrive as before', n_preview, v_leads;
end $$;
