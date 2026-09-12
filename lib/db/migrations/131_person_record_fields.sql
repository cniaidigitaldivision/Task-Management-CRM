-- ============================================================================
-- 131 · WHAT THE TEAM FORM SHOULD HAVE BEEN ASKING ALL ALONG
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-12, on adding a team member: *"this form is not properly
-- telling me"* — and, twice: *"nothing will break"*, *"Make sure that it will
-- not disturb the whole system."*
--
-- ── ⚠️ EVERY COLUMN HERE IS NULLABLE, WITH NO DEFAULT, AND THAT IS THE WHOLE
--    SAFETY ARGUMENT ───────────────────────────────────────────────────────
-- PostgreSQL adds a nullable column with no default as a CATALOGUE CHANGE only:
-- no table rewrite, no lock held while rows are touched, instant regardless of
-- size. Every existing row keeps exactly what it has and reads NULL for the
-- rest.
--
-- And nothing existing can notice:
--
--   · `createPerson` inserts an EXPLICIT column list (provisioning.ts), so a new
--     column is not passed and is not missed
--   · every CRM and team query names its columns; none does `select *` into a
--     positional shape
--   · no NOT NULL, so no existing INSERT anywhere becomes invalid
--   · no CHECK on existing data, so no row can suddenly be illegal
--
-- ⚠️ THE ONE THING THAT COULD HAVE BROKEN SOMETHING IS THE FOREIGN KEY, and it
-- is why `reports_to_id` is ON DELETE SET NULL. With the default (NO ACTION) a
-- manager's row could not be deleted while anybody reported to them, and
-- `purgePersonAction` would start failing on a person it used to remove — a
-- feature broken at a distance by a column it never heard of.
--
-- ── ⚠️ AND NO NEW POLICY, BECAUSE NONE IS NEEDED ───────────────────────────
-- `departments_write` is already `app.acting_at_least('admin')` for ALL commands
-- (migration 117), so an Admin can already INSERT and UPDATE departments. The
-- "create a department" button needs code, not permission. Adding a policy here
-- would have been a second rule saying the same thing, and two rules that agree
-- today are two rules that can disagree later.
-- ============================================================================

alter table public.users
  /* ⚠️ FREE TEXT, DELIBERATELY NOT AN ENUM OR A LOOKUP TABLE. Q19: the owner has
     not asked the sales team what they specialise in yet — *"Right now I don't
     know because I'm not a salesperson"* — and agreed the field must not be
     invented meanwhile: *"Please don't do that."* So this holds whatever a human
     types and imposes no taxonomy. It becomes structured only once real answers
     show a real pattern, and a migration can read them to find it. */
  add column if not exists specialisation text,

  /* The working day, for the availability signal in `10-LEAD-ASSIGNMENT.md`.
     ⚠️ `time`, not `timestamptz`: this is "17:30 on any day", not an instant.
     Interpreted in the person's own timezone, which `users.timezone` already
     holds and already defaults to Asia/Karachi. */
  add column if not exists work_starts_at time,
  add column if not exists work_ends_at   time,

  /* Tenure — for giving a new starter a lighter share of leads rather than
     treating a first-week hire identically to somebody with two years. */
  add column if not exists joined_on date,

  /* Who they report to, beyond "whoever in their department is a manager" —
     which breaks the moment a department has two seniors, or somebody reports
     across one. */
  add column if not exists reports_to_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_reports_to_id_fkey'
  ) then
    alter table public.users
      add constraint users_reports_to_id_fkey
      foreign key (reports_to_id) references public.users(id) on delete set null;
  end if;
end $$;

comment on column public.users.specialisation is
  'Free text: what this person handles. NOT an enum — see Q19, the taxonomy is '
  'not known yet and must not be invented. Shown on the team form for '
  'departments that work leads.';
comment on column public.users.work_starts_at is
  'Local working day start, in users.timezone. Feeds the availability signal in '
  'lead assignment — see docs/crm/10-LEAD-ASSIGNMENT.md.';
comment on column public.users.reports_to_id is
  'Their manager. ON DELETE SET NULL so removing a manager never blocks a purge.';

-- ⚠️ Partial, because almost every row is NULL today and will stay that way for
-- anybody outside a lead-working department. A full index would be mostly empty
-- pages the planner still has to walk.
create index if not exists users_reports_to_idx
  on public.users (reports_to_id) where reports_to_id is not null;

-- ============================================================================
-- SELF-CHECK — the point of which is to prove NOTHING CHANGED for what exists.
-- ============================================================================
do $$
declare
  n_before int;
  n_after  int;
  bad      int;
  new_id   uuid;
begin
  select count(*) into n_before from public.users;

  -- 1 · Every new column exists and every one of them is NULLABLE.
  select count(*) into bad
    from information_schema.columns
   where table_schema = 'public' and table_name = 'users'
     and column_name in ('specialisation','work_starts_at','work_ends_at','joined_on','reports_to_id')
     and is_nullable = 'NO';
  if bad > 0 then
    raise exception '131 · % of the new columns are NOT NULL — existing rows cannot satisfy them', bad;
  end if;

  select count(*) into bad
    from information_schema.columns
   where table_schema = 'public' and table_name = 'users'
     and column_name in ('specialisation','work_starts_at','work_ends_at','joined_on','reports_to_id');
  if bad <> 5 then
    raise exception '131 · expected 5 new columns, found %', bad;
  end if;

  -- 2 · ⚠️ NOT ONE EXISTING ROW WAS TOUCHED. A migration that quietly filled in
  --     a default would be a data change dressed as a schema change.
  select count(*) into bad from public.users
   where specialisation is not null or work_starts_at is not null
      or work_ends_at is not null or joined_on is not null
      or reports_to_id is not null;
  if bad > 0 then
    raise exception '131 · % existing rows were given values they did not have', bad;
  end if;

  -- 3 · ⚠️ THE EXISTING INSERT STILL WORKS UNCHANGED. This is the exact column
  --     list `createPerson` uses; if a new column had been made NOT NULL this
  --     is where it would fail, rather than in production on the next invite.
  --
  --     ⚠️ ROLLED BACK THROUGH A SUBTRANSACTION, NOT DELETED. The first version
  --     of this check ended with `delete from public.users` and the database
  --     refused it outright: *"DELETE on users is forbidden: accounts are
  --     deactivated, never deleted"* (BR-007, migration 042). The guard was
  --     right and the probe was wrong. A BEGIN/EXCEPTION block is an implicit
  --     savepoint, so raising inside it undoes the insert and leaves no row —
  --     which is what a probe should do anyway, rather than relying on being
  --     allowed to clean up after itself.
  begin
    insert into public.users (
      full_name, email, phone, role, role_title, account_state, is_active,
      weekly_capacity_points, max_concurrent_tasks, office_team, created_by_id
    ) values (
      '131 self-check', '131-self-check@example.invalid', null, 'member', null,
      'pending_activation', true, 36, 5, 'blue_area', null
    ) returning id into new_id;

    /* Undo it. The message is matched below so a REAL failure still escapes. */
    raise exception 'rollback the 131 probe';
  exception
    when others then
      if sqlerrm <> 'rollback the 131 probe' then
        raise exception '131 · the existing createPerson insert no longer works: %', sqlerrm;
      end if;
  end;

  -- 4 · And the count is exactly what it was.
  select count(*) into n_after from public.users;
  if n_after <> n_before then
    raise exception '131 · user count moved from % to %', n_before, n_after;
  end if;

  -- 5 · Departments already accept an Admin's write, so the button needs no
  --     policy. Asserted rather than assumed, because building a UI against a
  --     permission that does not exist is a whole afternoon.
  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relname = 'departments' and p.polcmd = '*'
  ) then
    raise exception '131 · departments has no write policy — the create button would be refused';
  end if;

  raise notice '131 · five nullable columns added, % existing rows untouched, inserts unchanged', n_before;
end $$;
