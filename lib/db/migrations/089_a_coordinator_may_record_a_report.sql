-- ============================================================================
-- 089 · A COORDINATOR MAY RECORD A REPORT
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-03: *"in the team coordinator when I try to generate a report,
-- it shows me an error like 'could not be recorded'. The report was generated
-- but could not be recorded while this error is coming on the team
-- coordinator."*
--
-- Exactly what was happening, and the wording of the error was the clue: the
-- report WAS computed and composed. Only the row would not save.
--
-- ── ⚠️ TWO RULES THAT DISAGREED ABOUT THE SAME ACTION ───────────────────────
--   `generateProjectReportAction` gates on `project.edit`, which the matrix
--   grants to Team Coordinator:  M('allow', 'allow', 'allow', 'deny')
--   `project_reports_insert` (038) demands `app.acting_at_least('admin')`
--
-- So a Coordinator passed the application check, did all the work — figures,
-- content, poster, upload — and was refused at the last statement. The comment
-- above the action even says "Admin and above… migration 038's insert policy is
-- the boundary; this is the courtesy", which describes a boundary the courtesy
-- does not match. One of the two had to move.
--
-- ── WHY THE POLICY MOVES, AND NOT THE ACTION ────────────────────────────────
-- Narrowing the action to Admin would have been the smaller edit and the wrong
-- one. Kashif is the Team Coordinator and runs every client project in this
-- division: a project report is his working document, and asking an Admin to
-- press the button for him makes the Admin a bottleneck on a routine task. The
-- owner's message is a request to let him do it, not a request to hide it.
--
-- ⚠️ AND NO WIDER THAN THAT. `project_is_visible` and
-- `created_by_id = current_user_id()` both stay, so a Coordinator may record a
-- report only for a project they can already see and only in their own name. A
-- Member is still refused — they cannot edit a project either, and the two
-- should not disagree again.
--
-- DELETE moves with INSERT for the same reason: regenerating a report replaces
-- the previous row, so a Coordinator who may create one must be able to replace
-- it, or their second press fails where the first succeeded.
-- ============================================================================

drop policy if exists project_reports_insert on public.project_reports;

create policy project_reports_insert on public.project_reports
  for insert to cni_app
  with check (
    app.acting_at_least('team_coordinator'::public.user_role)
    and app.project_is_visible(project_id)
    and created_by_id = app.current_user_id()
  );

drop policy if exists project_reports_delete on public.project_reports;

create policy project_reports_delete on public.project_reports
  for delete to cni_app
  using (app.acting_at_least('team_coordinator'::public.user_role));

-- ── SELF-CHECK ──────────────────────────────────────────────────────────────
-- ⚠️ A real insert as a real Coordinator, then removed. The bug was that the
-- statement was refused, so nothing short of running one proves it is not.
do $$
declare
  v_coord   uuid;
  v_member  uuid;
  v_project uuid;
  v_id      uuid := gen_random_uuid();
  v_left    integer;
begin
  select id into v_coord  from public.users where role = 'team_coordinator' and is_active limit 1;
  select id into v_member from public.users where role = 'member' and is_active limit 1;
  select id into v_project from public.projects where status = 'active' limit 1;

  if v_coord is null or v_project is null then
    raise notice '089: no coordinator or project to test with; assertions skipped';
    return;
  end if;

  perform set_config('role', 'cni_app', true);
  perform set_config('app.user_id', v_coord::text, true);

  /* ⚠️ EVERY NOT-NULL COLUMN, read off information_schema rather than
     discovered one failure at a time — the first two runs of this check died on
     period_label and then on summary, which is a probe testing the row rather
     than the policy. Required here: project_id, kind, period_start, period_end,
     period_label, summary, model, created_by_id — plus `content`, which is not
     NOT NULL but is demanded by the `project_reports_renderable` check: a row
     must carry either content or an image or there is nothing to render. */
  insert into public.project_reports
    (id, project_id, kind, period_start, period_end, period_label,
     summary, model, content, created_by_id)
  values (v_id, v_project, 'today', current_date, current_date, '089 self-check',
          '089 self-check', 'self-check', '{}'::jsonb, v_coord);

  select count(*) into v_left from public.project_reports where id = v_id;
  if v_left <> 1 then
    raise exception '089: a coordinator still cannot record a report';
  end if;

  -- ⚠️ And may replace it, or regenerating would fail where generating worked.
  delete from public.project_reports where id = v_id;
  select count(*) into v_left from public.project_reports where id = v_id;
  if v_left <> 0 then
    raise exception '089: a coordinator cannot replace their own report';
  end if;

  -- A Member is still refused: they cannot edit a project either.
  if v_member is not null then
    perform set_config('app.user_id', v_member::text, true);
    begin
      insert into public.project_reports
        (id, project_id, kind, period_start, period_end, period_label,
         summary, model, content, created_by_id)
      values (gen_random_uuid(), v_project, 'today', current_date, current_date,
              '089 self-check', '089 self-check', 'self-check', '{}'::jsonb, v_member);
      raise exception '089: a member recorded a report';
    exception
      when insufficient_privilege then null;  -- the policy held
    end;
  end if;

  raise notice '089: a coordinator records and replaces a report; a member still cannot';
end $$;
