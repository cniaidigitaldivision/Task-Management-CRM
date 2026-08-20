-- =============================================================================
-- 037 · WHERE THE CLIENT'S PAGES ACTUALLY LIVE — project_platforms.page_url
-- -----------------------------------------------------------------------------
-- Owner, 2026-08-20: *"The social media icons are displaying. Where did you get
-- these page URLs? Did you save them or did you get them at the time of creation?
-- Plus please make them correct logically."*
--
-- ── ⚠️ THE ANSWER WAS: THERE WERE NO URLs ─────────────────────────────────────
-- The icons on the project header came from `project_platforms` — the set of
-- platforms ticked in the New Project form — and nothing more. No Facebook page, no
-- Instagram handle, no TikTok profile was ever stored anywhere. The icons were
-- decoration that LOOKED like links, which is worse than no icons: somebody would
-- eventually click one expecting the client's page.
--
-- This is the column that makes them real.
--
-- ── WHY HERE AND NOT ON `projects` ───────────────────────────────────────────
-- A project has many platforms, so a `facebook_url` / `instagram_url` / … set of
-- columns on `projects` would need a new column every time the division sells a new
-- platform, and eleven mostly-null columns today. The page belongs to the
-- (project, platform) pair, which is exactly what this join table already is.
--
-- ── NOT THE SAME THING AS `task_placements.url` ──────────────────────────────
-- Migration 034 stores the URL of an individual POST. This is the URL of the PAGE
-- that post went on. Both are needed and they answer different questions: "take me
-- to that reel" versus "take me to this client's Instagram".
-- =============================================================================

alter table public.project_platforms
  add column if not exists page_url  text,
  -- The @handle, where the platform has one. Separate from the URL because a
  -- handle is what a human says out loud and what a report prints; deriving it by
  -- parsing the URL would break on every platform's URL format independently.
  add column if not exists handle    text;

comment on column public.project_platforms.page_url is
  'The client''s page or profile on this platform. Null until somebody records it.';
comment on column public.project_platforms.handle is
  'The @handle, where the platform has one. Not derived from page_url.';

-- ── A URL has to be a URL ────────────────────────────────────────────────────
-- Same rule and the same reason as `task_placements`: a header icon that links to
-- "facebook page" instead of a URL is a broken link on a page a client may see.
-- Null stays legal — the page simply has not been recorded yet.
alter table public.project_platforms
  drop constraint if exists project_platforms_page_url_is_url;

alter table public.project_platforms
  add constraint project_platforms_page_url_is_url check (
    page_url is null or page_url ~ '^https?://[^[:space:]]+$'
  );

-- ── An empty string is not a handle ──────────────────────────────────────────
-- Without this, a form that submits a blank field stores '' and every screen has to
-- test for two kinds of nothing.
alter table public.project_platforms
  drop constraint if exists project_platforms_handle_not_blank;

alter table public.project_platforms
  add constraint project_platforms_handle_not_blank check (
    handle is null or length(btrim(handle)) > 0
  );

-- =============================================================================
-- SELF-CHECK
-- -----------------------------------------------------------------------------
-- ⚠️ Runs as `cni_app`, not the migration's own role. A check that runs as
-- `postgres` proves nothing about GRANTs — `postgres` bypasses them — and
-- `/documents` shipped broken exactly that way.
-- =============================================================================
do $$
declare
  v_user     uuid;
  v_project  uuid;
  v_platform uuid;
begin
  select id into v_user from public.users where is_active order by created_at limit 1;
  select id into v_platform from public.platforms where slug = 'facebook';

  if v_user is null or v_platform is null then
    raise notice '037 · no users or platforms yet, skipping the row-level self-check';
    return;
  end if;

  insert into public.projects (name, code, type, status, created_by_id, owner_id)
  values ('037 page url check', 'OTH', 'other', 'planning', v_user, v_user)
  returning id into v_project;

  -- A real URL and a handle are accepted.
  insert into public.project_platforms (project_id, platform_id, page_url, handle)
  values (v_project, v_platform, 'https://facebook.com/naya.marketing', '@naya.marketing');

  -- Prose is not a URL.
  begin
    update public.project_platforms
       set page_url = 'facebook page'
     where project_id = v_project;
    raise exception '037 · "facebook page" was accepted as a URL';
  exception when check_violation then null;
  end;

  -- A blank handle is not a handle.
  begin
    update public.project_platforms
       set handle = '   '
     where project_id = v_project;
    raise exception '037 · a blank handle was accepted';
  exception when check_violation then null;
  end;

  -- Both stay optional — a platform may be managed before anybody records the page.
  update public.project_platforms
     set page_url = null, handle = null
   where project_id = v_project;

  delete from public.project_platforms where project_id = v_project;
  delete from public.projects where id = v_project;

  raise notice '037 · platform pages work: URLs validated, handles kept separate';
end
$$;
