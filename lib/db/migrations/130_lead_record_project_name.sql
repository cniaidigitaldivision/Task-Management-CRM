-- ============================================================================
-- 130 · A SALESPERSON CAN OPEN THEIR OWN LEAD — THE FIFTH TIME THIS SHAPE
-- ----------------------------------------------------------------------------
-- 105, 121, 125, 129 — and now the lead record itself. Owner, 2026-09-12:
-- *"when I clicked on it, it showed me a 404 page. According to my observation
-- it was showing that the project actually does not exist."* That reading was
-- exactly right.
--
-- `getCrmLead` reads the lead and its project's name together:
--
--     from public.crm_leads l
--     join public.projects p on p.id = l.project_id     -- ⚠️ INNER
--
-- `projects_select` is `app.project_is_visible(id)`, which needs project
-- MEMBERSHIP. A salesperson is not a member of the project whose leads they
-- work — that is the entire premise of the department routing — so the join
-- matched nothing, `getCrmLead` returned null, and `/leads/[id]` called
-- `notFound()`.
--
-- Measured, as Sale 2 tester, on a lead they own:
--
--     select from crm_leads                  → 1 row   (it is theirs)
--     select from crm_leads join projects    → 0 rows  ← what the app ran
--     select from projects                   → 0 rows  (they see none at all)
--
-- ── ⚠️ SO THE LEAD RECORD HAS NEVER WORKED FOR THE PEOPLE IT IS FOR ─────────
-- Not "worked and then broke". Every lead, every salesperson, since Step 5.
-- The bell told them a lead was theirs, and the link in it 404'd. It survived
-- because an Admin is a member of nothing and visible everything, so every
-- browser check ever made of this screen passed.
--
-- ⚠️ AND `notFound()` IS WHY IT WAS SILENT. `getCrmLead` returns null for both
-- "no such lead" and "not yours", deliberately, so a stranger cannot probe for
-- which ids exist. A third case had crept in — "yours, but its project is
-- invisible" — and it wore the same 404 as the other two.
--
-- ── THE FIX, AND WHY NOT THE OBVIOUS ONE ───────────────────────────────────
-- A LEFT JOIN would return the lead with a null project name, and the record
-- would render "—" where the project belongs on the one screen whose job is to
-- say where a lead came from. Widening `projects_select` to admit a department
-- would hand the sales team the whole Projects area. So the name is read
-- through a definer function that discloses exactly one string, to exactly the
-- people who can already read the lead it belongs to.
-- ============================================================================

create or replace function app.crm_project_name(p_project uuid)
returns text
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select p.name
    from public.projects p
   where p.id = p_project
     /* ⚠️ THE SAME AUDIENCE AS `crm_leads_select`, NOT A WIDER ONE. Whoever may
        read a lead on this project may learn the project's name; nobody else
        learns anything, including whether the id exists. */
     and (app.crm_manages_project(p_project) or app.crm_in_project_department(p_project))
$$;

comment on function app.crm_project_name(uuid) is
  'The name of a project, to anybody who may read its leads. SECURITY DEFINER '
  'because projects_select needs MEMBERSHIP and a salesperson is not a member of '
  'the project whose leads they work — see migration 130.';

revoke all on function app.crm_project_name(uuid) from public;
grant execute on function app.crm_project_name(uuid) to cni_app;

-- ============================================================================
-- SELF-CHECK — under each person's own session, which is the only way any of
-- the five versions of this bug has ever been found.
-- ============================================================================
do $$
declare
  v_member uuid;
  v_admin  uuid;
  v_dev    uuid;
  v_lead   uuid;
  v_proj   uuid;
  v_name   text;
  n        int;
begin
  select l.id, l.project_id, l.owner_id
    into v_lead, v_proj, v_member
    from public.crm_leads l
   where l.owner_id is not null
   limit 1;

  if v_lead is null then
    raise notice '130 · no assigned lead to check against — skipping';
    return;
  end if;

  select id into v_admin from public.users where role = 'admin' and is_active limit 1;
  select u.id into v_dev
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'development' and u.is_active limit 1;

  -- 1 · ⚠️ THE BUG ITSELF: the owner of a lead reads its project's name.
  --     Before this migration the equivalent join returned zero rows.
  set local role cni_app;
  perform set_config('app.user_id', v_member::text, true);
  select app.crm_project_name(v_proj) into v_name;
  reset role;

  if v_name is null then
    raise exception '130 · the owner of a lead still cannot read its project name — the 404 is NOT fixed';
  end if;

  -- 2 · ⚠️ AND THE WHOLE RECORD NOW SURVIVES THE READ. The join was the thing
  --     that killed it, so the check is the query shape the app actually runs.
  set local role cni_app;
  perform set_config('app.user_id', v_member::text, true);
  select count(*) into n
    from public.crm_leads l
   where l.id = v_lead and app.crm_project_name(l.project_id) is not null;
  reset role;

  if n <> 1 then
    raise exception '130 · the lead record reads % rows for its own owner', n;
  end if;

  -- 3 · ⚠️ AND IT MUST STILL SAY NOTHING WHERE THE ANSWER IS NOTHING. A function
  --     that returned the name to everybody would pass every check above and
  --     leak the client list to the whole company.
  if v_dev is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_dev::text, true);
    select app.crm_project_name(v_proj) into v_name;
    reset role;
    if v_name is not null then
      raise exception '130 · somebody in Development can read a project they have no leads on';
    end if;
  end if;

  -- 4 · No session at all learns nothing.
  set local role cni_app;
  perform set_config('app.user_id', '', true);
  select app.crm_project_name(v_proj) into v_name;
  reset role;
  if v_name is not null then
    raise exception '130 · a session with no user is told a project name';
  end if;

  -- 5 · An Admin still reads it, as they always could.
  if v_admin is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_admin::text, true);
    select app.crm_project_name(v_proj) into v_name;
    reset role;
    if v_name is null then
      raise exception '130 · an admin cannot read a project name';
    end if;
  end if;

  raise notice '130 · a salesperson can open their own lead, and Development still cannot';
end $$;
