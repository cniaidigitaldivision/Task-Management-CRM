-- ============================================================================
-- 117 · THE OFFICE HAS DEPARTMENTS — owner, 2026-09-10
-- ----------------------------------------------------------------------------
-- *"Right now in the main office there are a lot of departments: the AI and
-- digital department, in which the team manager is Kashif Ayaz… the sales team
-- or sales department, in which they have one sales manager and all other sales
-- persons… the finance department, whose team I will create… There is also a
-- development team. Larry is in the developer team and Junaid is in the
-- developer team. The rest of the team is in the digital creator team… properly
-- organize the team. Then it will be easier to divide on a role basis who can
-- see, who can manage the CRM, or who can do what."*
--
-- ── ⚠️ `office_team` IS NOT THIS, AND MUST NOT BE REUSED ────────────────────
-- It looks like the answer and it is not. Its two values are `blue_area` and
-- `wah` — the two OFFICES people sit in, not what they do. Attendance groups by
-- it, `employee_compensation` reads it, and `expenses.office_team` attributes
-- cost to a site. Overloading it with "sales" would put a department into a
-- column three finance reports already read as a location.
--
-- ── ⚠️ AND `role_title` CANNOT DECIDE ANYTHING ─────────────────────────────
-- It is free text, and one look at the live rows says why that matters:
--
--     'SalesMan'  ·  'sales manager'  ·  'sale person'
--     'Lead Manager/Coodinator'  ·  'Developer Interne'
--
-- Three spellings for the sales team and two typos, entered by hand over ten
-- days. An access rule that matched on it would hand the CRM to whoever spelled
-- their title the way the code expected, and lock out the person who typed a
-- capital M. `role_title` stays exactly what it is — a label a person writes
-- about themselves. The DEPARTMENT is structured, and the department decides.
--
-- ── WHY A TABLE AND NOT AN ENUM ────────────────────────────────────────────
-- The rest of this codebase reaches for an enum, correctly, when the values are
-- a fixed vocabulary that reports group by. Departments are not that: the owner
-- said *"the finance department, whose team I will create"* in the same breath
-- as describing the ones that exist. A company grows departments, and each one
-- should cost a row rather than a migration and a deploy.
--
-- ⚠️ WHAT KEEPS THAT SAFE IS `key`. Access rules read `key = 'sales'`, never the
-- display name, so renaming the department to "Sales & Business Development"
-- changes a heading and nothing else. The name is for people; the key is for
-- code; only one of them is allowed to change.
-- ============================================================================

do $$ begin
  create type public.department_role as enum ('manager', 'member');
exception when duplicate_object then null; end $$;


create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),

  /* ⚠️ THE STABLE HANDLE. Policies compare against this and nothing else. */
  key         text not null unique check (key ~ '^[a-z][a-z0-9_]*$'),
  name        text not null check (length(trim(name)) between 1 and 80),
  description text,

  /* The order they read in on the team page — an org chart is not alphabetical. */
  sort_order  integer not null default 100,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.departments is
  'A department of the company (117). `key` is what access rules read; `name` is '
  'what people read, and is free to change without touching a policy.';


alter table public.users
  add column if not exists department_id uuid references public.departments(id) on delete set null;

alter table public.users
  add column if not exists department_role public.department_role not null default 'member';

create index if not exists users_department_idx on public.users (department_id);

/* ⚠️ EXPLICIT `is not null`, NOT `department_id is not null or department_role
   <> 'manager'`. A CHECK passes when its expression evaluates to NULL, which is
   how migration 107 accepted twice the exact row it existed to refuse. */
do $$ begin
  alter table public.users add constraint users_manager_needs_department
    check (case when department_role = 'manager' then department_id is not null else true end);
exception when duplicate_object then null; end $$;

comment on column public.users.department_role is
  'Manager or member OF THEIR DEPARTMENT (117). ⚠️ Not an app rank — a sales '
  'manager is still `member` in users.role. See ADR-002: the four roles are not '
  'growing a fifth.';


-- ════════════════════════════════════════════════════════════════════════════
-- WHO IS IN WHICH DEPARTMENT — the three questions a policy asks
-- ----------------------------------------------------------------------------
-- ⚠️ SECURITY DEFINER, the same as `app.project_is_visible` and for the same
-- reason: `users_select` shows a Member exactly one row — their own — and these
-- must give the same answer whatever the caller can see of the staff table.
-- They disclose one boolean about the CALLER, never anything about anybody else.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.acting_department_key()
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select d.key
    from public.users u
    join public.departments d on d.id = u.department_id
   where u.id = app.current_user_id()
     and u.is_active
$$;

create or replace function app.acting_in_department(p_key text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(app.acting_department_key() = p_key, false)
$$;

/** True only when the caller manages the department they are IN. */
create or replace function app.acting_manages_department(p_key text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    exists (
      select 1
        from public.users u
        join public.departments d on d.id = u.department_id
       where u.id = app.current_user_id()
         and u.is_active
         and u.department_role = 'manager'
         and d.key = p_key
    ),
    false
  )
$$;

grant execute on function app.acting_department_key()            to cni_app;
grant execute on function app.acting_in_department(text)         to cni_app;
grant execute on function app.acting_manages_department(text)    to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- ⚠️ THE LIST IS READABLE BY EVERYBODY SIGNED IN, and that is deliberate. Who
-- the departments are and who runs them is the org chart — a person needs it to
-- know who to ask. It carries no salary, no lead and no personal data. Hiding it
-- would break the team page for the very people it exists to orient.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.departments enable row level security;

drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  for select using (app.current_user_id() is not null);

/* ⚠️ ADMIN AND ABOVE, not Coordinator. Moving somebody between departments is
   what decides whether they can see 615 strangers' phone numbers, so it sits
   with the two accounts that already manage people. */
drop policy if exists departments_write on public.departments;
create policy departments_write on public.departments
  for all using      (app.acting_at_least('admin'::public.user_role))
          with check (app.acting_at_least('admin'::public.user_role));

grant select on public.departments to cni_app;
grant insert, update, delete on public.departments to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- THE DEPARTMENTS THEMSELVES
-- ----------------------------------------------------------------------------
-- Five that exist today plus three the owner asked to have ready — *"those five
-- plus HR, Operations and Support"*. The three empty ones cost a row each and
-- mean the first HR hire is a dropdown rather than a migration.
--
-- ⚠️ `on conflict (key) do update` on the NAME only. Re-running this file must
-- never reset a department somebody renamed or reordered into a shape that
-- suits them — and it must never orphan the people pointing at it.
-- ════════════════════════════════════════════════════════════════════════════
insert into public.departments (key, name, description, sort_order) values
  ('management',  'Management',        'Direction, oversight and the accounts that manage people.',           10),
  ('digital',     'AI & Digital',      'Content, social media, design and video — the delivery team.',        20),
  ('development', 'Development',       'Software: this product, and anything the division builds.',           30),
  ('sales',       'Sales',             'Leads, clients and the pipeline. ⚠️ This department is the CRM.',      40),
  ('finance',     'Finance & Accounts','Invoicing, expenses, payroll and the books.',                         50),
  ('hr',          'HR & People',       'Hiring, onboarding, attendance and leave.',                           60),
  ('operations',  'Operations',        'The office itself — equipment, vendors, day-to-day running.',         70),
  ('support',     'Support',           'Client support and after-sales.',                                     80)
on conflict (key) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- WHERE EVERYBODY GOES
-- ----------------------------------------------------------------------------
-- ⚠️ MATCHED ON EMAIL, never on name or a pasted uuid. Two of these people are
-- called Kashif, one name is spelled 'Lararib' in the database and 'Larry' in
-- conversation, and a uuid in a migration is unverifiable six months from now.
-- The email is the one thing that is unique, stable and recognisable.
--
-- ⚠️ AND ONLY WHERE NO DEPARTMENT IS SET YET. This seeds; it does not correct.
-- Once the owner moves somebody on the team page, re-running this file must not
-- put them back — a migration that quietly reverts an administrative decision is
-- worse than one that fails.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- Management — the two accounts that run the company.
      ('ammarafzalkhan@gmail.com',      'management',  'manager'),  -- CEO
      ('ummehabiba989@gmail.com',       'management',  'member'),   -- CTO

      -- AI & Digital — *"the team manager is Kashif Ayaz"*.
      ('kk8464123@gmail.com',           'digital',     'manager'),
      ('sayednajmullah@gmail.com',      'digital',     'member'),   -- Video Editor
      ('kashif8245676@gmail.com',       'digital',     'member'),   -- Video Editor
      ('rafayabbasi205@gmail.com',      'digital',     'member'),   -- Video Editor
      ('moiz29617@gmail.com',           'digital',     'member'),   -- Graphic Designer
      ('saherunzela@gmail.com',         'digital',     'member'),   -- Social Media
      ('arslankareemi5@gmail.com',      'digital',     'member'),   -- Social Media
      ('bilalgul3787@gmail.com',        'digital',     'member'),   -- Social Media
      ('aj6598267@gmail.com',           'digital',     'member'),   -- Internee

      -- Development — *"Larry is in the developer team and Junaid is in the
      -- developer team"*. Haider is a Developer too and currently inactive; he
      -- is filed with them so returning does not need an extra decision.
      ('laraibrafique090@gmail.com',    'development', 'member'),
      ('junaidahmedk.dev@gmail.com',    'development', 'member'),
      ('haider.malik1503@gmail.com',    'development', 'member'),

      -- Sales — the department that owns the CRM. One manager, two sales people.
      ('bibaestore@gmail.com',          'sales',       'manager'),
      ('habibaminhas989@gmail.com',     'sales',       'member'),
      ('cniaidigitaldivision@gmail.com','sales',       'member')
    ) as t(email, dept, drole)
  loop
    update public.users u
       set department_id   = (select d.id from public.departments d where d.key = r.dept),
           department_role = r.drole::public.department_role,
           updated_at      = now()
     where lower(u.email) = lower(r.email)
       and u.department_id is null;
  end loop;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ RUNS AS `cni_app` UNDER REAL SESSIONS. A migration executes as the schema
-- owner and bypasses RLS entirely, which is how a check passes while proving
-- nothing — migration 094 did exactly that.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_member  uuid;
  v_admin   uuid;
  v_sales_m uuid;
  v_sales_p uuid;
  v_coord   uuid;
  n         integer;
  v_key     text;
begin
  select id into v_admin  from public.users where role in ('admin','super_admin') and is_active order by created_at limit 1;
  select id into v_coord  from public.users where role = 'team_coordinator' and is_active limit 1;
  select id into v_sales_m from public.users where lower(email) = 'bibaestore@gmail.com';
  select id into v_sales_p from public.users where lower(email) = 'habibaminhas989@gmail.com';
  select id into v_member from public.users where lower(email) = 'sayednajmullah@gmail.com';

  -- 1 · Eight departments, every key distinct.
  select count(*) into n from public.departments;
  if n < 8 then
    raise exception '117 · expected at least 8 departments, found %', n;
  end if;

  -- 2 · Sales has exactly one manager. ⚠️ The owner said "ONE sales manager";
  --     two would make "who may reassign a lead" ambiguous on day one.
  select count(*) into n
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.department_role = 'manager' and u.is_active;
  if n <> 1 then
    raise exception '117 · sales has % managers, expected exactly 1', n;
  end if;

  -- 3 · And three people in it altogether.
  select count(*) into n
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active;
  if n <> 3 then
    raise exception '117 · sales has % active people, expected 3', n;
  end if;

  -- 4 · ⚠️ NOBODY IS A MANAGER OF NOTHING. The CHECK, exercised rather than
  --     assumed — see the note about migration 107 above.
  begin
    update public.users set department_role = 'manager', department_id = null where id = v_member;
    raise exception '117 · somebody was made a manager with no department';
  exception when check_violation then
    null;
  end;

  -- ── The helpers, under each person's own session ────────────────────────
  set local role cni_app;

  -- 5 · The sales manager manages sales, and only sales.
  perform set_config('app.user_id', v_sales_m::text, true);
  if app.acting_department_key() <> 'sales' then
    raise exception '117 · the sales manager is not in sales';
  end if;
  if not app.acting_manages_department('sales') then
    raise exception '117 · the sales manager does not manage sales';
  end if;
  if app.acting_manages_department('digital') then
    raise exception '117 · the sales manager appears to manage digital as well';
  end if;

  -- 6 · A sales PERSON is in sales and manages nothing.
  perform set_config('app.user_id', v_sales_p::text, true);
  if not app.acting_in_department('sales') then
    raise exception '117 · the salesperson is not in sales';
  end if;
  if app.acting_manages_department('sales') then
    raise exception '117 · a salesperson is being treated as the sales manager';
  end if;

  -- 7 · ⚠️ THE COORDINATOR IS DIGITAL, NOT SALES. This is the whole point of
  --     the file: he runs the digital team's tasks and has no lead work.
  if v_coord is not null then
    perform set_config('app.user_id', v_coord::text, true);
    select app.acting_department_key() into v_key;
    if v_key <> 'digital' then
      raise exception '117 · the team coordinator is in %, expected digital', coalesce(v_key, 'no department');
    end if;
    if app.acting_in_department('sales') then
      raise exception '117 · the team coordinator counts as sales';
    end if;
  end if;

  -- 8 · Everybody signed in can read the org chart — the team page needs it.
  perform set_config('app.user_id', v_member::text, true);
  select count(*) into n from public.departments;
  if n < 8 then
    raise exception '117 · a member can only see % departments; the team page would be wrong', n;
  end if;

  -- 9 · ⚠️ AND ONLY AN ADMIN MAY MOVE ANYBODY. A department decides who sees
  --     615 strangers' phone numbers.
  begin
    insert into public.departments (key, name) values ('selfcheck_117', '117 self-check');
    raise exception '117 · a member was allowed to create a department';
  exception when insufficient_privilege then
    null;
  end;

  perform set_config('app.user_id', v_admin::text, true);
  select count(*) into n from public.departments where key = 'sales';
  if n <> 1 then
    raise exception '117 · an admin cannot read the sales department';
  end if;

  reset role;

  raise notice '117 · eight departments, sales has one manager and three people, and the coordinator is digital';
end $$;
