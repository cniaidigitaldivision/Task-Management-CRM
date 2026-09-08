-- ============================================================================
-- 104 · REMARKS ON A PROJECT — owner, 2026-09-08
-- ----------------------------------------------------------------------------
-- *"On the individual project detail page there is no remarks option… it should
-- properly pop up like a proper chat that shows which remarks are added by
-- which person, like a super admin added these remarks about this project or
-- any important information about that. For example Kashif, a team member, can
-- add any remarks on that project there."*
--
-- ── ⚠️ WHY THIS IS NOT `task_comments` WITH A NULL TASK ─────────────────────
-- The obvious shortcut — hang a comment off a project by making `task_id`
-- nullable — breaks the one thing that table's RLS is built on. A task comment
-- is visible to whoever can see the TASK, checked through `app.task_is_visible`;
-- a row with no task has nothing for that predicate to answer about, so it would
-- either be visible to everyone or to nobody depending on how the null fell
-- through. Every read of that table would then need to know which kind of row it
-- was looking at. A separate table with its own predicate is smaller than the
-- conditional that would otherwise spread through both features.
--
-- ── ⚠️ AND IT REUSES `app.project_is_visible`, WHICH ALREADY DECIDES THIS ────
-- `projects_select` is `app.project_is_visible(id)` and `project_members_select`
-- is the same function. Remarks answer to it too, so a remark can never be
-- readable by somebody who cannot open the project it is about — and when that
-- rule changes, it changes in one place. Writing a bespoke predicate here is how
-- two rules meant to be the same drift apart.
--
-- ── ⚠️ WITHDRAWING A REMARK IS A REAL DELETE, AND THAT WAS NOT THE FIRST PLAN
-- The first version of this file had a `deleted_at` column, a SELECT policy
-- reading `deleted_at is null and app.project_is_visible(project_id)`, and an
-- UPDATE policy so an author could set the timestamp. It does not work, and the
-- reason is worth recording because the same shape is tempting for the next
-- table:
--
--   PostgreSQL applies SELECT policies to the NEW row of an UPDATE. A row
--   therefore cannot be updated into invisibility — the soft delete failed with
--   "new row violates row-level security policy" even though the UPDATE policy's
--   own WITH CHECK was satisfied. Reproduced in isolation on a scratch table
--   carrying exactly these three policies before this file was rewritten.
--
-- So the choice was: move the `deleted_at` filter out of the policy and into
-- every query — one forgotten `where` and a withdrawn remark reappears — or make
-- withdrawal a DELETE. A deleted remark being genuinely gone is both simpler and
-- unforgettable, and there is no audit interest in text somebody retracted from
-- their own note.
-- ============================================================================

create table if not exists public.project_remarks (
  id          uuid primary key default gen_random_uuid(),

  project_id  uuid not null references public.projects(id) on delete cascade,

  /* ⚠️ NULLABLE, AND `on delete set null` RATHER THAN CASCADE. A remark records
     what was said about the project; deleting the person who said it must not
     delete the note itself, or a departure silently rewrites the project's
     history. The UI renders a null author as "Former member". */
  author_id   uuid references public.users(id) on delete set null,

  body        text not null check (length(trim(body)) between 1 and 4000),

  created_at  timestamptz not null default now()
);

comment on table public.project_remarks is
  'Notes people leave on a project (104). Visible to whoever can see the '
  'project, via app.project_is_visible — the same predicate projects_select uses.';

/* Reading a thread is always "this project, oldest first". A plain index on
   project_id would leave the sort as a separate step on a busy project. */
create index if not exists project_remarks_thread_idx
  on public.project_remarks (project_id, created_at);


-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.project_remarks enable row level security;

drop policy if exists project_remarks_select on public.project_remarks;
create policy project_remarks_select on public.project_remarks
  for select using (app.project_is_visible(project_id));

/* ⚠️ `author_id = app.current_user_id()` IS THE POINT OF THIS POLICY. Without
   it anybody who can post could post AS somebody else — the same rule
   `activity_log` enforces on `actor_id`, and for the same reason: a note whose
   author cannot be trusted is worse than no note at all. */
drop policy if exists project_remarks_insert on public.project_remarks;
create policy project_remarks_insert on public.project_remarks
  for insert with check (
    app.project_is_visible(project_id)
    and author_id = app.current_user_id()
  );

/* Withdraw your own; an Admin may remove anybody's. ⚠️ THERE IS NO UPDATE
   POLICY, DELIBERATELY. A remark that can be rewritten after somebody has acted
   on it is not a record of what was said, so the only ways out are leaving it
   or removing it. */
drop policy if exists project_remarks_delete on public.project_remarks;
create policy project_remarks_delete on public.project_remarks
  for delete using (
    app.project_is_visible(project_id)
    and (author_id = app.current_user_id() or app.acting_at_least('admin'::public.user_role))
  );

grant select, insert, delete on public.project_remarks to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ RUNS AS `cni_app` WITH A REAL SESSION. A migration executes as the schema
-- owner and bypasses RLS entirely, which is how a check passes while proving
-- nothing (094 did exactly that). Everything below is asserted through the
-- policies, from inside a session that has an identity.
--
-- ⚠️ AND IT REMOVES ITS OWN ROW BY ID, NEVER BY PREDICATE. Migration 082 ate a
-- live attendance row with a `delete … where on_date = current_date` meant to
-- clean up after itself. The id is captured on insert and that one id is what
-- goes.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin    uuid;
  v_other    uuid;
  v_project  uuid;
  v_remark   uuid;
  n          integer;
begin
  select id into v_admin from public.users
   where role = 'super_admin' and is_active order by created_at limit 1;
  select id into v_project from public.projects
   where not is_draft order by created_at limit 1;

  if v_admin is null or v_project is null then
    raise notice '104 · no user or project to check against; policies created untested';
    return;
  end if;

  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);

  -- 1 · A remark can be written, and read back, through the policies.
  insert into public.project_remarks (project_id, author_id, body)
  values (v_project, v_admin, '104 self-check — removed by this migration')
  returning id into v_remark;

  select count(*) into n from public.project_remarks where id = v_remark;
  if n <> 1 then
    raise exception '104 · a remark was written and could not be read back';
  end if;

  -- 2 · ⚠️ POSTING UNDER SOMEBODY ELSE'S NAME IS REFUSED. The check that makes
  --     an author trustworthy; without it the whole feature is anonymous.
  select id into v_other from public.users
   where id <> v_admin and is_active limit 1;

  if v_other is not null then
    begin
      insert into public.project_remarks (project_id, author_id, body)
      values (v_project, v_other, '104 self-check — must not be accepted');
      raise exception '104 · a remark was accepted under somebody else''s name';
    exception when insufficient_privilege then
      null;
    end;
  end if;

  -- 3 · The author can withdraw their own, and it is then gone.
  delete from public.project_remarks where id = v_remark;

  select count(*) into n from public.project_remarks where id = v_remark;
  if n <> 0 then
    raise exception '104 · a withdrawn remark is still readable';
  end if;

  reset role;

  -- ⚠️ BY ID, and belt-and-braces: step 3 already removed it under RLS. If that
  -- ever stops being true, this leaves nothing behind. See the header note.
  delete from public.project_remarks where id = v_remark;

  raise notice '104 · remarks are visible with the project, attributable, and withdrawable';
end $$;
