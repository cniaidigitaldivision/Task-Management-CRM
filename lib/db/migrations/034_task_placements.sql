-- =============================================================================
-- 034 · WHERE A DELIVERABLE ACTUALLY WENT — task_placements
-- -----------------------------------------------------------------------------
-- Owner described the working process on 2026-08-19: a Google Sheet kept by the
-- team coordinator, one row per video, with a Drive link for the raw material,
-- a Drive link for the finished asset, and then a published URL for every place
-- it went — Facebook post, Facebook reel, Instagram post, Instagram reel, TikTok,
-- YouTube.
--
-- *"When I give a report to a super admin, he can click on that link and directly
-- go to that page or that exact post."*
--
-- That sentence is the requirement. A report saying "12 assets published" is a
-- claim; a report where each one is a link to the live post is evidence.
--
-- ── ⚠️ THIS CORRECTS MIGRATION 033 ────────────────────────────────────────────
-- 033 gave a task ONE `platform_id`. The sheet is what shows that to be wrong:
-- a single video becomes a post AND a reel on Facebook, a post AND a reel on
-- Instagram, a TikTok reel and a YouTube video. One asset, six placements, six
-- URLs. A single column holds one of them and silently loses the other five —
-- and the clickable report becomes impossible to build.
--
-- Confirmed by the owner, 2026-08-19: **one cross-posted video is ONE asset.**
-- So the count of assets against a package target comes from `tasks`, and
-- `task_placements` is where it was published. Getting that backwards would
-- inflate every project's progress three- or four-fold.
--
-- Safe to drop `platform_id`: no index references it, no code reads it, and zero
-- rows use it. 033 added it and the UI was never built on top.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · The two Drive links, which are about the WORK rather than publication
-- -----------------------------------------------------------------------------

alter table public.tasks
  /* The sheet's "Google Drive link" — clips, photos, the brief. */
  add column if not exists source_drive_url text,
  /* The sheet's "Reels Drive link" — the finished file. */
  add column if not exists asset_drive_url  text;

comment on column public.tasks.source_drive_url is
  'Raw material for this deliverable. The sheet''s "Google Drive link".';
comment on column public.tasks.asset_drive_url is
  'The finished file. The sheet''s "Reels Drive link". Distinct from a placement '
  'URL: this is where the asset LIVES, a placement is where it was PUBLISHED.';


-- -----------------------------------------------------------------------------
-- 2 · Placements
-- -----------------------------------------------------------------------------

create table if not exists public.task_placements (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks (id)      on delete cascade,
  platform_id  uuid not null references public.platforms (id)  on delete restrict,

  /* ⚠️ content_kind appears on BOTH the task and the placement, and that is not
     duplication. On the task it says what the deliverable IS — a reel. On the
     placement it says what it was published AS on that platform: the same video
     is a "post" in a Facebook feed and a "reel" in Facebook Reels, which are two
     rows, two URLs, and two different things to click. */
  content_kind public.content_kind not null,

  /* The clickable link. The whole reason this table exists. */
  url          text,

  /* Per placement, because they rarely go out together — a reel might post to
     Instagram on Monday and YouTube on Thursday. */
  published_on date,

  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  /* One row per platform per format. Posting the same video twice to Facebook
     Reels is a mistake, not a fact worth recording. */
  constraint task_placements_unique unique (task_id, platform_id, content_kind),

  /* ⚠️ A URL, if given, must be a URL. The value's entire purpose is being
     clicked from a report, and 'done' or 'posted' typed into this box would
     produce a link that goes nowhere — which is worse than an empty cell,
     because the report would look complete. */
  constraint task_placements_url_shape check (
    url is null or url ~ '^https?://[^[:space:]]+$'
  )
);

create index if not exists task_placements_task_idx on public.task_placements (task_id);
create index if not exists task_placements_platform_idx
  on public.task_placements (platform_id, published_on);

comment on table public.task_placements is
  'Every place one deliverable was published, with the link. One cross-posted '
  'video is ONE asset (owner, 2026-08-19) and several placements — so asset '
  'counts come from `tasks`, never from counting rows here.';


-- -----------------------------------------------------------------------------
-- 3 · platform_id goes
-- -----------------------------------------------------------------------------
-- Replaced by the table above. Dropped rather than left in place: a column that
-- looks like it holds the platform, next to a table that actually does, is how
-- somebody later writes a report against the wrong one.

alter table public.tasks drop column if exists platform_id;


-- -----------------------------------------------------------------------------
-- 4 · RLS — placements follow their task
-- -----------------------------------------------------------------------------
-- If you can see the task you can see where it was published; if you can change
-- the task you can record a placement. Reusing `app.task_is_visible` rather than
-- restating the rule, so the two cannot drift.

alter table public.task_placements enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'task_placements_select') then
    create policy task_placements_select on public.task_placements
      for select to cni_app
      using (app.task_is_visible(task_id));
  end if;

  /* Anybody who can see the task may record where it went — the person who
     published it is usually the assignee, not a coordinator, and making them ask
     someone else to paste a link is how the links stop being recorded at all. */
  if not exists (select 1 from pg_policy where polname = 'task_placements_write') then
    create policy task_placements_write on public.task_placements
      for all to cni_app
      using (app.task_is_visible(task_id))
      with check (app.task_is_visible(task_id));
  end if;
end
$$;

grant select, insert, update, delete on public.task_placements to cni_app;
revoke all on public.task_placements from anon, authenticated;

drop trigger if exists task_placements_touch_updated_at on public.task_placements;
create trigger task_placements_touch_updated_at
  before update on public.task_placements
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- 5 · SELF-CHECK
-- -----------------------------------------------------------------------------

do $$
declare
  v_task uuid; v_fb uuid; v_ig uuid; v_member uuid; n int;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='tasks' and column_name='platform_id'
  ) then
    raise exception '034 · tasks.platform_id is still there';
  end if;

  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='tasks'
     and column_name in ('source_drive_url','asset_drive_url');
  if n <> 2 then raise exception '034 · the drive link columns are missing'; end if;

  select id into v_fb from public.platforms where slug = 'facebook';
  select id into v_ig from public.platforms where slug = 'instagram';
  select id into v_task from public.tasks where not is_deleted limit 1;

  if v_task is null then
    raise notice '034 · no task to test placements against; structural checks only';
    return;
  end if;

  -- ONE asset, FOUR placements — the shape 033 could not express.
  insert into public.task_placements (task_id, platform_id, content_kind, url, published_on) values
    (v_task, v_fb, 'static', 'https://facebook.com/p/1', current_date),
    (v_task, v_fb, 'reel',   'https://facebook.com/reel/1', current_date),
    (v_task, v_ig, 'static', 'https://instagram.com/p/1', current_date),
    (v_task, v_ig, 'reel',   'https://instagram.com/reel/1', current_date);

  select count(*) into n from public.task_placements where task_id = v_task;
  if n <> 4 then raise exception '034 · expected 4 placements on one task, got %', n; end if;

  -- The same platform AND format twice is a mistake, not a fact.
  begin
    insert into public.task_placements (task_id, platform_id, content_kind, url)
    values (v_task, v_fb, 'reel', 'https://facebook.com/reel/duplicate');
    raise exception '034 · a duplicate platform+format placement was accepted';
  exception when unique_violation then null;
  end;

  -- ...but the same platform with a DIFFERENT format is legitimate, and the four
  -- rows above already proved it (facebook static + facebook reel).

  -- A URL must be a URL, or the report links somewhere that does not exist.
  begin
    insert into public.task_placements (task_id, platform_id, content_kind, url)
    values (v_task, v_ig, 'story', 'done');
    raise exception '034 · "done" was accepted as a URL';
  exception when check_violation then null;
  end;

  -- An empty URL is fine — the placement is planned, not yet live.
  insert into public.task_placements (task_id, platform_id, content_kind, url)
  values (v_task, v_ig, 'story', null);

  delete from public.task_placements where task_id = v_task;
  raise notice '034 · placements work: one asset, many platforms, links validated';
end
$$;
