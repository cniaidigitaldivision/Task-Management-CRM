-- ============================================================================
-- 092 · THE DAILY SERIES AND THE POSTS — owner, 2026-09-04
-- ----------------------------------------------------------------------------
-- Where the numbers actually live. 091 created the link to a Meta account and
-- the catalogue of what may be collected; this creates the three tables the sync
-- writes into and the Studio reads from.
--
-- ── ⚠️ THE DAILY SERIES IS NARROW, THE POST METRICS ARE WIDE ────────────────
-- The inconsistency is deliberate, and each side is shaped by how it changes.
--
-- `meta_metric_days` is NARROW — a row per metric rather than a column per
-- metric. Meta retires metrics faster than a schema can follow: four Facebook
-- metrics that appear in every current tutorial were found DEAD in v26.0 on the
-- day this was written. A wide table needs a migration each time that happens
-- and loses the column's history with it. A narrow one needs a catalogue row set
-- to `is_active = false`, and every figure already collected stays queryable.
--
-- `meta_post_metrics` is WIDE. Its metric set is small, stable, identical across
-- both platforms, and always read as a whole row to draw one card. Making it
-- narrow would buy flexibility nothing needs and cost a pivot on every read.
--
-- ── ⚠️ EVERY WRITE IS AN UPSERT, AND THAT IS LOAD-BEARING ───────────────────
-- The cron re-reads the last several days on every pass, because Meta revises
-- recent figures for a day or two after the fact. Without a primary key that
-- absorbs a repeat, a two-hourly sync would multiply every row by twelve a day.
-- Both `meta_metric_days` and `meta_posts` are keyed so a re-read CORRECTS the
-- row rather than duplicating it.
-- ============================================================================

-- ── The daily time series ───────────────────────────────────────────────────
create table if not exists public.meta_metric_days (
  meta_account_id uuid    not null references public.meta_accounts(id) on delete cascade,
  on_date         date    not null,
  -- No foreign key to the catalogue on purpose: a metric Meta retires is
  -- deactivated there, and a hard reference would either block that or cascade
  -- away the history the deactivation exists to preserve.
  metric_key      text    not null,
  value           numeric not null,
  fetched_at      timestamptz not null default now(),

  primary key (meta_account_id, on_date, metric_key)
);

-- The Studio always asks "this account, this date range", in that order.
create index if not exists meta_metric_days_range_idx
  on public.meta_metric_days (meta_account_id, on_date desc);

comment on table public.meta_metric_days is
  'One row per account, per day, per metric (092). Narrow so a metric Meta '
  'retires costs a catalogue row rather than a migration. Upserted on its '
  'primary key, because the sync re-reads recent days.';


-- ── Posts, pulled from Meta ─────────────────────────────────────────────────
--
-- ⚠️ THIS TABLE IS WHY THE HARDEST PROBLEM IN THE ORIGINAL PLAN DISAPPEARED.
-- docs/META-INTEGRATION-PLAN.md §5.5 agonised over matching a URL somebody had
-- pasted into a task back to a Meta post id, and concluded it was unreliable for
-- Instagram. It is moot: posts are pulled FROM Meta, so the id, the permalink
-- and the thumbnail all arrive together in the same response. Verified 2026-09-04.
create table if not exists public.meta_posts (
  id                 uuid primary key default gen_random_uuid(),
  meta_account_id    uuid not null references public.meta_accounts(id) on delete cascade,
  meta_post_id       text not null,

  posted_at          timestamptz not null,
  caption            text,
  media_type         text,   -- IMAGE | VIDEO | CAROUSEL_ALBUM
  media_product_type text,   -- FEED | REELS | STORY
  permalink          text,   -- ⚠️ the click-through target for the Studio
  thumbnail_url      text,

  -- ⚠️ NULLABLE, AND IT STAYS NULLABLE. The optional reverse link to the Taskly
  -- task that produced this post, matched later on date. It is an enrichment for
  -- the cadence-vs-outcome summary and NEVER a requirement: the Studio works
  -- completely with every one of these null, and nothing may fail because a
  -- match was not found.
  task_id            uuid references public.tasks(id) on delete set null,

  first_seen_at      timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint meta_posts_unique unique (meta_account_id, meta_post_id)
);

create index if not exists meta_posts_account_time_idx
  on public.meta_posts (meta_account_id, posted_at desc);
create index if not exists meta_posts_task_idx
  on public.meta_posts (task_id) where task_id is not null;

comment on table public.meta_posts is
  'Posts pulled from Meta, with their permalink and thumbnail (092). task_id is '
  'an optional link back to the Taskly task and is never required.';


-- ── Per-post numbers ────────────────────────────────────────────────────────
create table if not exists public.meta_post_metrics (
  meta_post_id       uuid primary key references public.meta_posts(id) on delete cascade,
  reach              integer,
  views              integer,
  likes              integer,
  comments           integer,
  shares             integer,
  saves              integer,
  total_interactions integer,
  fetched_at         timestamptz not null default now()
);

-- ⚠️ EVERY COLUMN IS NULLABLE, AND THAT IS NOT LAZINESS. The two platforms
-- return different subsets — `saves` is Instagram-only, and a Facebook post
-- carries no `views` for a still image. NULL means "this platform does not
-- report it", which a zero would misrepresent as "nobody did it". The Studio
-- must render a dash for null and a 0 only for a real zero.

comment on table public.meta_post_metrics is
  'Per-post figures (092). Nullable throughout: the platforms report different '
  'subsets, and null means "not reported", never zero.';


-- ════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY — visibility follows the account, which follows the project
-- ════════════════════════════════════════════════════════════════════════════

alter table public.meta_metric_days  enable row level security;
alter table public.meta_posts        enable row level security;
alter table public.meta_post_metrics enable row level security;

-- ⚠️ EVERY POLICY REACHES THROUGH `meta_accounts` TO `app.project_is_visible`
-- rather than restating the rule. One definition of "may this person see this
-- client's numbers", in 091, referenced everywhere.
drop policy if exists meta_metric_days_select on public.meta_metric_days;
create policy meta_metric_days_select on public.meta_metric_days
  for select using (
    exists (select 1 from public.meta_accounts a
             where a.id = meta_metric_days.meta_account_id
               and app.project_is_visible(a.project_id))
  );

drop policy if exists meta_posts_select on public.meta_posts;
create policy meta_posts_select on public.meta_posts
  for select using (
    exists (select 1 from public.meta_accounts a
             where a.id = meta_posts.meta_account_id
               and app.project_is_visible(a.project_id))
  );

drop policy if exists meta_post_metrics_select on public.meta_post_metrics;
create policy meta_post_metrics_select on public.meta_post_metrics
  for select using (
    exists (select 1 from public.meta_posts p
              join public.meta_accounts a on a.id = p.meta_account_id
             where p.id = meta_post_metrics.meta_post_id
               and app.project_is_visible(a.project_id))
  );

-- ⚠️ NO INSERT, UPDATE OR DELETE POLICY ON ANY OF THE THREE, FOR ANY ROLE.
-- These tables are written by the sync job and by nothing else. 093 adds a
-- SECURITY DEFINER function for it. A person editing a follower count by hand
-- would be falsifying a client-facing figure, and there is no legitimate reason
-- for the interface to offer it.
grant select on public.meta_metric_days, public.meta_posts, public.meta_post_metrics to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK — builds its own project, asserts, and removes exactly what it made
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin   uuid;
  v_fb      uuid;
  v_project uuid;
  v_account uuid;
  v_post    uuid;
  v_before  bigint;
  v_after   bigint;
  v_value   numeric;
  n         integer;
begin
  select count(*) into v_before from public.projects;

  select id into v_admin from public.users where role in ('super_admin','admin') and is_active limit 1;
  select id into v_fb    from public.platforms where slug = 'facebook' limit 1;
  if v_admin is null or v_fb is null then
    raise notice '092 · no admin or platform row; tables are in place, self-check skipped';
    return;
  end if;

  perform set_config('app.user_id', v_admin::text, true);

  insert into public.projects (name, type, code, created_by_id, owner_id)
  values ('092 self-check — delete me', 'other', 'OTH', v_admin, v_admin)
  returning id into v_project;

  insert into public.meta_accounts (project_id, platform_id, meta_object_id, linked_by_id)
  values (v_project, v_fb, '092-SELFCHECK-OBJECT', v_admin)
  returning id into v_account;

  -- ── 1 · THE UPSERT. The assertion this file exists for: a two-hourly cron
  --        re-reading the same day must CORRECT the row, never add a second.
  insert into public.meta_metric_days (meta_account_id, on_date, metric_key, value)
  values (v_account, date '2026-09-01', 'page_follows', 100);

  insert into public.meta_metric_days (meta_account_id, on_date, metric_key, value)
  values (v_account, date '2026-09-01', 'page_follows', 118)
  on conflict (meta_account_id, on_date, metric_key)
    do update set value = excluded.value, fetched_at = now();

  select count(*), max(value) into n, v_value
    from public.meta_metric_days
   where meta_account_id = v_account and on_date = date '2026-09-01';

  if n <> 1 then
    raise exception '092 · re-reading one day produced % rows — a 2-hourly sync would multiply history', n;
  end if;
  if v_value <> 118 then
    raise exception '092 · the re-read did not correct the value; it is still %', v_value;
  end if;

  -- ── 2 · The same for posts.
  insert into public.meta_posts (meta_account_id, meta_post_id, posted_at, caption, permalink)
  values (v_account, '092-POST-1', now(), 'first read', 'https://example.test/p/1')
  returning id into v_post;

  insert into public.meta_posts (meta_account_id, meta_post_id, posted_at, caption, permalink)
  values (v_account, '092-POST-1', now(), 'second read, caption edited', 'https://example.test/p/1')
  on conflict (meta_account_id, meta_post_id)
    do update set caption = excluded.caption, updated_at = now();

  select count(*) into n from public.meta_posts where meta_account_id = v_account;
  if n <> 1 then
    raise exception '092 · re-reading one post produced % rows', n;
  end if;

  -- ── 3 · Post metrics accept nulls, because the platforms differ.
  insert into public.meta_post_metrics (meta_post_id, reach, likes, saves)
  values (v_post, 500, 12, null);

  select saves into v_value from public.meta_post_metrics where meta_post_id = v_post;
  if v_value is not null then
    raise exception '092 · a null metric was coerced to a value — "not reported" would read as zero';
  end if;

  -- ── 4 · Deleting the account takes the whole tree with it.
  delete from public.meta_accounts where id = v_account;
  select count(*) into n from public.meta_metric_days where meta_account_id = v_account;
  if n <> 0 then
    raise exception '092 · % metric rows outlived their account', n;
  end if;
  if exists (select 1 from public.meta_post_metrics where meta_post_id = v_post) then
    raise exception '092 · post metrics outlived their post';
  end if;

  delete from public.projects where id = v_project;

  select count(*) into v_after from public.projects;
  if v_after <> v_before then
    raise exception '092 · project count went from % to % — the self-check leaked', v_before, v_after;
  end if;

  raise notice '092 · the series upserts, posts upsert, nulls survive, cascades hold';
end $$;
