-- =============================================================================
-- 038 · GENERATED REPORTS, KEPT — project_reports
-- -----------------------------------------------------------------------------
-- Owner, 2026-08-20: *"I want that to generate a report always in PDF format… give
-- all the summary to the ChatGPT API. Give a proper pre-written prompt that always
-- includes the summary and logo. Tell it to generate an image for this report. Once it
-- is generated put that image in a PDF so that PDF can be viewed and downloaded."*
--
-- ── ⚠️ WHY A ROW AT ALL, RATHER THAN GENERATING ON EVERY VIEW ─────────────────
-- Measured: one `gpt-image-1` call takes 42 seconds and 6,240 output tokens. Generating
-- on every view would mean a 42-second wait and a fresh charge each time somebody
-- reopens a report they already have — and two views of "August 2026" would return two
-- DIFFERENT posters, because the model is not deterministic. A client asking "which
-- one did you send me?" would have no answer.
--
-- So the image is generated once, stored, and this row remembers it. The PDF is
-- assembled from the stored image on demand, which is fast and free.
--
-- ── ⚠️ THE SUMMARY IS STORED WITH IT ─────────────────────────────────────────
-- `summary` is the exact text handed to the model, and `figures` the exact numbers it
-- was given. Kept because a generated image cannot be audited: months later, the only
-- way to answer "was this poster right?" is to compare it against what the CRM
-- actually said at the time. Without these the PDF is an unverifiable artefact.
--
-- ── WHAT IS NOT STORED ───────────────────────────────────────────────────────
-- The PDF itself. It is a deterministic wrapper around the image plus our own logo and
-- footer, so keeping it would be a second copy that could drift from the first.
-- =============================================================================

create table if not exists public.project_reports (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,

  -- Which report this is. Text rather than an enum: the set is decided by
  -- lib/domain/report-periods.ts and adding a sixth kind should not need a migration.
  kind          text not null,
  period_start  date not null,
  period_end    date not null,
  -- "August 2026", "18–24 Aug 2026". Stored so a list can be read without recomputing
  -- a label from a kind and two dates.
  period_label  text not null,

  -- The generated poster, in the private bucket.
  image_path    text not null,
  image_bytes   integer,

  -- ⚠️ The audit trail for an image nobody can grep. See the header.
  summary       text not null,
  figures       jsonb not null default '{}'::jsonb,
  -- Which model drew it, so a change in output has an explanation later.
  model         text not null,

  created_by_id uuid not null references public.users(id) on delete restrict,
  created_at    timestamptz not null default now(),

  constraint project_reports_period_ordered check (period_end >= period_start),
  constraint project_reports_kind_known check (
    kind in ('today', 'yesterday', 'week', 'month', 'year')
  ),
  constraint project_reports_image_path_not_blank check (length(btrim(image_path)) > 0)
);

comment on table public.project_reports is
  'One generated report poster per (project, period, attempt). The PDF is assembled from image_path on demand.';
comment on column public.project_reports.summary is
  'The exact text given to the image model. Kept so the poster can be audited against what the CRM said.';
comment on column public.project_reports.figures is
  'The exact figures given to the model, as they were computed.';

-- The list on a project page is "newest first for this project".
create index if not exists project_reports_project_created_idx
  on public.project_reports (project_id, created_at desc);

-- =============================================================================
-- ROW-LEVEL SECURITY
-- -----------------------------------------------------------------------------
-- A report is a view of a project, so it inherits the project's visibility exactly.
-- `app.project_is_visible` already encodes that rule (extended by migration 033 to
-- consult project_members), and reusing it means a report can never be visible to
-- somebody who cannot open the project it describes.
-- =============================================================================
alter table public.project_reports enable row level security;

grant select, insert, delete on public.project_reports to cni_app;

drop policy if exists project_reports_select on public.project_reports;
create policy project_reports_select on public.project_reports
  for select to cni_app
  using (app.project_is_visible(project_id));

drop policy if exists project_reports_insert on public.project_reports;
create policy project_reports_insert on public.project_reports
  for insert to cni_app
  with check (
    -- Generating a report costs money, so it is Admin-and-above — the same floor as
    -- editing the project. Checked in the action too; this is the boundary.
    app.acting_at_least('admin'::public.user_role)
    and app.project_is_visible(project_id)
    and created_by_id = app.current_user_id()
  );

drop policy if exists project_reports_delete on public.project_reports;
create policy project_reports_delete on public.project_reports
  for delete to cni_app
  using (app.acting_at_least('admin'::public.user_role));

-- ⚠️ No UPDATE policy and no grant. A generated report is a record of what was sent to
-- a client; editing its summary after the fact would destroy the only thing that makes
-- the image auditable. Wrong report: delete it and generate again.

-- =============================================================================
-- SELF-CHECK
-- -----------------------------------------------------------------------------
-- ⚠️ Runs as `cni_app`. A check running as `postgres` bypasses table GRANTs and proves
-- nothing about them — `/documents` shipped broken exactly that way.
-- =============================================================================
do $$
declare
  v_admin   uuid;
  v_member  uuid;
  v_project uuid;
  v_report  uuid;
  n         integer;
begin
  select id into v_admin from public.users
   where role in ('admin', 'super_admin') and is_active order by role limit 1;
  select id into v_member from public.users
   where role = 'member' and is_active limit 1;

  if v_admin is null then
    raise notice '038 · no admin yet, skipping the row-level self-check';
    return;
  end if;

  insert into public.projects (name, code, type, status, created_by_id, owner_id)
  values ('038 report check', 'OTH', 'other', 'planning', v_admin, v_admin)
  returning id into v_project;

  -- ── As the Admin: may insert ──────────────────────────────────────────────
  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);

  insert into public.project_reports
    (project_id, kind, period_start, period_end, period_label,
     image_path, summary, model, created_by_id)
  values (v_project, 'month', '2026-08-01', '2026-08-31', 'August 2026',
          'project-reports/x.png', 'A summary', 'gpt-image-1', v_admin)
  returning id into v_report;

  select count(*) into n from public.project_reports where id = v_report;
  if n <> 1 then raise exception '038 · the admin could not read back their own report'; end if;

  -- An out-of-order period is refused.
  begin
    insert into public.project_reports
      (project_id, kind, period_start, period_end, period_label,
       image_path, summary, model, created_by_id)
    values (v_project, 'month', '2026-08-31', '2026-08-01', 'Backwards',
            'project-reports/y.png', 'A summary', 'gpt-image-1', v_admin);
    raise exception '038 · a backwards period was accepted';
  exception when check_violation then null;
  end;

  -- An unknown kind is refused.
  begin
    insert into public.project_reports
      (project_id, kind, period_start, period_end, period_label,
       image_path, summary, model, created_by_id)
    values (v_project, 'fortnight', '2026-08-01', '2026-08-14', 'Two weeks',
            'project-reports/z.png', 'A summary', 'gpt-image-1', v_admin);
    raise exception '038 · an unknown kind was accepted';
  exception when check_violation then null;
  end;

  -- ⚠️ UPDATE is refused outright — no policy and no grant. This is the check that
  -- proves the audit trail cannot be rewritten.
  begin
    update public.project_reports set summary = 'rewritten' where id = v_report;
    raise exception '038 · a generated report summary was rewritten';
  exception when insufficient_privilege then null;
  end;

  -- ── As a Member: may not insert ───────────────────────────────────────────
  if v_member is not null then
    perform set_config('app.user_id', v_member::text, true);
    begin
      insert into public.project_reports
        (project_id, kind, period_start, period_end, period_label,
         image_path, summary, model, created_by_id)
      values (v_project, 'today', current_date, current_date, 'Today',
              'project-reports/m.png', 'A summary', 'gpt-image-1', v_member);
      raise exception '038 · a member generated a report';
    exception when insufficient_privilege then null;
    end;
  end if;

  reset role;
  delete from public.project_reports where project_id = v_project;
  delete from public.projects where id = v_project;

  raise notice '038 · report records work: admin-only, append-only, periods validated';
end
$$;
