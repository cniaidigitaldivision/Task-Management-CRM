-- ============================================================================
-- 105 · A REMARK SHOWS WHO WROTE IT — owner, 2026-09-08
-- ----------------------------------------------------------------------------
-- *"in the remarks modal, I was testing when I click as a team member… you are
-- showing that as a former member. I don't know who is a former member. For
-- example as a team member, if I am watching it, I don't know."*
--
-- ── THE CAUSE, WHICH IS NOT IN THE REMARKS FEATURE AT ALL ───────────────────
-- `users_select` reads:
--
--     id = app.current_user_id() OR app.acting_at_least('team_coordinator')
--
-- so a Team MEMBER can see exactly one row in `public.users` — their own.
-- `listProjectRemarks` left-joins `users` for the author's name, and under a
-- Member's session that join produced NULL for everybody except themselves. The
-- UI renders a null author as "Former member", which is the right label for a
-- deleted account and a lie for a colleague sitting across the room.
--
-- ⚠️ NOTE WHAT DID *NOT* GO WRONG. No remark leaked, and no policy was too
-- tight in the security sense — a Member is not supposed to browse the staff
-- table. The failure is that a correct restriction on ONE table silently
-- degraded a feature on another, and it degraded into a plausible-looking
-- sentence rather than an error. That is the recurring shape in this codebase:
-- RLS fails closed, and closed reads as "no data" rather than "not allowed".
--
-- ── ⚠️ WHY A SECURITY DEFINER READER AND NOT A WIDER `users_select` ─────────
-- Widening the policy so Members can read the staff table would fix the modal
-- and hand every Member the whole directory — emails, roles, everything the
-- table holds — to solve a problem about four fields on a remark. This function
-- discloses exactly the author of a remark the caller can ALREADY read, and
-- nothing else: it takes one project id, refuses outright unless
-- `app.project_is_visible` says yes, and returns the name, picture and role of
-- people who chose to write on that project.
--
-- The same reasoning as migration 103's refusal of a general secret reader: the
-- narrow function that answers one question beats the broad permission that
-- answers it along with a hundred others.
--
-- ⚠️ AND THE VISIBILITY CHECK IS INSIDE, BECAUSE DEFINER BYPASSES RLS. Without
-- the guard below, this function would hand a project's whole conversation to
-- anybody who could guess a project id — the exact hole a SECURITY DEFINER
-- function exists to avoid opening.
-- ============================================================================

create or replace function app.project_remarks_with_authors(p_project_id uuid)
returns table (
  id                 uuid,
  body               text,
  created_at         timestamptz,
  author_id          uuid,
  author_name        text,
  author_avatar_url  text,
  author_role        public.user_role
)
language plpgsql
security definer
set search_path = public, app, pg_temp
stable
as $$
begin
  /* ⚠️ THE WHOLE SECURITY OF THIS FUNCTION. RLS is bypassed below, so the
     caller's right to read this project is checked here, once, against the same
     predicate `project_remarks_select` uses. A caller who cannot see the project
     gets an empty set — the same answer the table itself would have given. */
  if not app.project_is_visible(p_project_id) then
    return;
  end if;

  return query
    select r.id, r.body, r.created_at,
           r.author_id,
           u.full_name,
           u.avatar_url,
           u.role
      from public.project_remarks r
      left join public.users u on u.id = r.author_id
     where r.project_id = p_project_id
     order by r.created_at;
end;
$$;

comment on function app.project_remarks_with_authors(uuid) is
  'A project''s remarks with each author''s name, picture and role (105). '
  'SECURITY DEFINER because users_select hides the staff table from Members; '
  'checks app.project_is_visible itself, and discloses nothing else about them.';

grant execute on function app.project_remarks_with_authors(uuid) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ RUNS AS `cni_app` UNDER A MEMBER'S SESSION, because a Member is the only
-- person for whom this was ever broken. Checking it as an Admin would pass
-- against the old code too and prove nothing — which is exactly how the bug
-- reached the owner.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_member   uuid;
  v_author   uuid;
  v_project  uuid;
  v_remark   uuid;
  v_name     text;
  v_role     public.user_role;
  n          integer;
begin
  /* A Member who is actually on a project, and somebody senior to write the
     remark — the pair the bug needs. */
  select m.user_id, m.project_id into v_member, v_project
    from public.project_members m
    join public.users u on u.id = m.user_id
   where u.role = 'member' and u.is_active
   limit 1;

  select id into v_author from public.users
   where role in ('admin', 'super_admin') and is_active order by created_at limit 1;

  if v_member is null or v_author is null then
    raise notice '105 · no member-on-a-project to check against; function created untested';
    return;
  end if;

  insert into public.project_remarks (project_id, author_id, body)
  values (v_project, v_author, '105 self-check — removed by this migration')
  returning id into v_remark;

  set local role cni_app;
  perform set_config('app.user_id', v_member::text, true);

  -- 1 · ⚠️ THE BUG ITSELF. Through the raw join a Member sees a null name.
  select u.full_name into v_name
    from public.project_remarks r
    left join public.users u on u.id = r.author_id
   where r.id = v_remark;

  if v_name is not null then
    raise exception
      '105 · a Member can now read users directly — this function is redundant and users_select must be re-examined';
  end if;

  -- 2 · Through the function, the same Member sees the author.
  select author_name, author_role into v_name, v_role
    from app.project_remarks_with_authors(v_project)
   where id = v_remark;

  if v_name is null then
    raise exception '105 · a Member still cannot see who wrote a remark';
  end if;
  if v_role is null then
    raise exception '105 · the author''s role is missing, so the modal cannot label them';
  end if;

  -- 3 · ⚠️ AND IT DISCLOSES NOTHING ABOUT A PROJECT THE CALLER CANNOT SEE.
  select count(*) into n
    from app.project_remarks_with_authors(
      (select p.id from public.projects p
        where not exists (select 1 from public.project_members m
                           where m.project_id = p.id and m.user_id = v_member)
          and not p.is_draft
        limit 1)
    );
  if n <> 0 then
    raise exception '105 · the reader returned remarks for a project the caller cannot see';
  end if;

  reset role;

  delete from public.project_remarks where id = v_remark;

  raise notice '105 · a Member sees the author of a remark, and only on projects they can see';
end $$;
