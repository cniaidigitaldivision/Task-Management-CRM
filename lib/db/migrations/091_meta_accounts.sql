-- ============================================================================
-- 091 · META ACCOUNTS AND THE METRIC CATALOGUE — owner, 2026-09-04
-- ----------------------------------------------------------------------------
-- The first of three migrations behind the Trend & Engagement Studio. See
-- docs/meta-integration/ for the whole picture; this file creates the link
-- between a Taskly project and a real Facebook Page or Instagram account, plus
-- the catalogue of metric names we are allowed to collect.
--
-- ── ⚠️ WHY A NEW TABLE AND NOT COLUMNS ON `project_platforms` ───────────────
-- `project_platforms` already carries `handle` and `page_url`, and both are NULL
-- on every row in the database including AI & Digital Division's — the join
-- point was built and never filled in. It was tempting to just fill it.
--
-- Two reasons not to. A project may have a platform row and no Meta link at all
-- (the owner was explicit that internal tool-development projects have no social
-- media and must keep working exactly as they do). And one project may
-- eventually hold several accounts on the same platform. Both are awkward as
-- nullable columns on a table that means something else, and neither is awkward
-- as its own table.
--
-- `project_platforms` is therefore left completely untouched by this migration.
--
-- ── ⚠️ NO TOKEN COLUMN, DELIBERATELY ───────────────────────────────────────
-- Verified 2026-09-04: `META_SYSTEM_USER_TOKEN` is of type SYSTEM_USER and NEVER
-- EXPIRES. Instagram calls use it directly. Facebook Page insights refuse it —
-- `(#190) This method must be called with a Page Access Token` — and need a page
-- token, which is DERIVED per request from the system user token.
--
-- So there is nothing to store. A stored page token would be an encrypted secret
-- that has to be kept fresh, in exchange for saving one cheap API call. The
-- token lives in the environment and nowhere else.
-- ============================================================================

create table if not exists public.meta_accounts (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id)  on delete cascade,
  platform_id       uuid not null references public.platforms(id) on delete restrict,

  -- ⚠️ THE NUMERIC ID IS THE IDENTITY, NEVER THE URL OR THE HANDLE. A page's
  -- vanity slug and an Instagram username can both be changed by their owner at
  -- any moment, and a link keyed on either would break silently — the sync would
  -- simply start returning nothing for a client who is still posting. The object
  -- id never changes.
  meta_object_id    text not null,
  username          text,
  display_name      text,
  profile_picture   text,
  permalink         text,

  -- Last known totals, refreshed every sync. Denormalised on purpose: a card
  -- showing "245K followers" should not have to scan the daily series to find
  -- the most recent row.
  followers         integer,
  media_count       integer,

  is_active         boolean     not null default true,
  linked_at         timestamptz not null default now(),
  linked_by_id      uuid references public.users(id) on delete set null,
  last_synced_at    timestamptz,
  last_error        text,
  last_error_at     timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- One Taskly row per real Meta object. Re-linking the same page to a second
  -- project is a mistake, not a feature.
  constraint meta_accounts_object_unique unique (meta_object_id),

  -- An error and its timestamp travel together or not at all.
  constraint meta_accounts_error_pair check (
    (last_error is null and last_error_at is null) or
    (last_error is not null and last_error_at is not null)
  )
);

create index if not exists meta_accounts_project_idx  on public.meta_accounts (project_id) where is_active;
create index if not exists meta_accounts_platform_idx on public.meta_accounts (platform_id);

comment on table public.meta_accounts is
  'A Facebook Page or Instagram account linked to a Taskly project (091). Holds '
  'no access token: the system user token lives in the environment and page '
  'tokens are derived per request. See docs/meta-integration/.';


-- ════════════════════════════════════════════════════════════════════════════
-- THE METRIC CATALOGUE
-- ----------------------------------------------------------------------------
-- ⚠️ THIS TABLE IS THE REASON THE METRICS TABLE CAN BE NARROW, and it earns its
-- keep on the first day. Tested against v26.0 on 2026-09-04, these four Facebook
-- metrics are ALREADY DEAD and every one of them appears in current tutorials:
--
--     page_impressions · page_impressions_unique · page_fans · page_fan_adds
--
-- They fail with `(#100) The value must be a valid insights metric`, which reads
-- like a typo rather than a deprecation. When the next one dies, the fix is
-- `is_active = false` on one row — never a migration, and never a lost column of
-- history.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.meta_metric_catalogue (
  metric_key   text primary key,
  platform     text    not null check (platform in ('facebook', 'instagram')),
  label        text    not null,
  format       text    not null default 'integer'
                 check (format in ('integer', 'percent', 'decimal')),
  -- How the value is fetched. The Graph API is not consistent about this and the
  -- difference is invisible until a call fails, so it is recorded per metric:
  --   'series'      period=day, read from values[]
  --   'total_value' needs metric_type=total_value, read from total_value.value
  --   'profile'     not an insight at all — a field on the object itself
  fetch_mode   text    not null default 'series'
                 check (fetch_mode in ('series', 'total_value', 'profile')),
  sort_order   integer not null default 100,
  is_active    boolean not null default true,
  notes        text
);

comment on table public.meta_metric_catalogue is
  'Every metric the sync may collect, with how to fetch it (091). Verified '
  'against Graph API v26.0 on 2026-09-04 — see '
  'docs/meta-integration/01-VERIFIED-API-FACTS.md.';

-- ── The verified set. Every row below returned a real number in testing. ────
insert into public.meta_metric_catalogue
  (metric_key, platform, label, format, fetch_mode, sort_order, notes) values
  -- Facebook. All require a PAGE access token.
  ('page_follows',              'facebook',  'Followers',        'integer', 'series',      10, 'Total followers. Replaces the retired page_fans.'),
  ('page_daily_follows_unique', 'facebook',  'New follows',      'integer', 'series',      20, 'New follows that day.'),
  ('page_views_total',          'facebook',  'Page views',       'integer', 'series',      30, null),
  ('page_post_engagements',     'facebook',  'Engagements',      'integer', 'series',      40, null),
  ('page_video_views',          'facebook',  'Video views',      'integer', 'series',      50, null),

  -- Instagram. The system user token works directly.
  ('reach',                     'instagram', 'Reach',            'integer', 'series',      10, 'One of only two IG metrics that work WITHOUT metric_type.'),
  ('views',                     'instagram', 'Views',            'integer', 'total_value', 20, 'Replaces the retired impressions.'),
  ('profile_views',             'instagram', 'Profile views',    'integer', 'total_value', 30, null),
  ('accounts_engaged',          'instagram', 'Accounts engaged', 'integer', 'total_value', 40, null),
  ('total_interactions',        'instagram', 'Interactions',     'integer', 'total_value', 50, null),
  ('likes',                     'instagram', 'Likes',            'integer', 'total_value', 60, null),
  ('comments',                  'instagram', 'Comments',         'integer', 'total_value', 70, null),
  ('shares',                    'instagram', 'Shares',           'integer', 'total_value', 80, null),
  ('saves',                     'instagram', 'Saves',            'integer', 'total_value', 90, null),

  -- ⚠️ NOT AN INSIGHT. `follower_count` returned ZERO values in testing, almost
  -- certainly the same privacy floor that empties follower_demographics below
  -- 100 followers. The profile field is always readable, so the follower total
  -- is snapshotted from the object itself every run — and once stored daily it
  -- becomes the history Meta will not sell us.
  ('followers_count',           'instagram', 'Followers',        'integer', 'profile',      5, 'Profile field, not an insight. follower_count returns nothing on small accounts.')
on conflict (metric_key) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- ⚠️ VISIBILITY IS DELEGATED TO `app.project_is_visible`, NOT REIMPLEMENTED.
-- A client's follower numbers are exactly as sensitive as the project they
-- belong to, and a second implementation of that rule is how two screens come to
-- disagree about who may see a client's data.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.meta_accounts        enable row level security;
alter table public.meta_metric_catalogue enable row level security;

drop policy if exists meta_accounts_select on public.meta_accounts;
create policy meta_accounts_select on public.meta_accounts
  for select using (app.project_is_visible(project_id));

-- ⚠️ WRITES ARE ADMIN-ONLY AND THERE IS NO UPDATE OR DELETE POLICY FOR ANYBODY
-- ELSE. Linking a page decides whose numbers appear against which client, which
-- is an administrative act. The sync job writes through a SECURITY DEFINER
-- function in 093 and does not rely on these.
drop policy if exists meta_accounts_write on public.meta_accounts;
create policy meta_accounts_write on public.meta_accounts
  for all
  using      (app.acting_at_least('admin'::public.user_role))
  with check (app.acting_at_least('admin'::public.user_role));

-- The catalogue is a public vocabulary, not data about anybody. Everyone signed
-- in may read it; nobody may write it outside a migration.
drop policy if exists meta_catalogue_select on public.meta_metric_catalogue;
create policy meta_catalogue_select on public.meta_metric_catalogue
  for select using (app.current_user_id() is not null);

grant select on public.meta_accounts, public.meta_metric_catalogue to cni_app;
grant insert, update, delete on public.meta_accounts to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ IT TOUCHES NO LIVE ROW, and that is a requirement rather than good manners.
-- Migration 082's self-check borrowed a real person and cleaned up with a DELETE
-- keyed on TODAY's date — which would have destroyed a genuine attendance row
-- had that person scanned in that morning. This one creates its own project,
-- asserts against it, and removes exactly what it made.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin    uuid;
  v_platform uuid;
  v_project  uuid;
  v_account  uuid;
  v_before   bigint;
  v_after    bigint;
  n          integer;
begin
  select count(*) into v_before from public.projects;

  select id into v_admin from public.users where role in ('super_admin','admin') and is_active limit 1;
  select id into v_platform from public.platforms where slug = 'facebook' limit 1;

  if v_admin is null or v_platform is null then
    raise notice '091 · no admin or no facebook platform row; tables are in place, self-check skipped';
    return;
  end if;

  perform set_config('app.user_id', v_admin::text, true);

  -- ⚠️ THREE COLUMNS, THREE CORRECTIONS, ALL FOUND BY THE MIGRATION REFUSING TO
  -- COMMIT. `type` not `project_type`; `code` is NOT NULL with no default; and
  -- `projects_code_format` demands EXACTLY three uppercase letters, so a
  -- descriptive 'SELFCHK091' is rejected. 'OTH' matches the type and is already
  -- shared by other rows — codes are per-type reference prefixes, not unique.
  insert into public.projects (name, type, code, created_by_id, owner_id)
  values ('091 self-check — delete me', 'other', 'OTH', v_admin, v_admin)
  returning id into v_project;

  insert into public.meta_accounts (project_id, platform_id, meta_object_id, username, followers, linked_by_id)
  values (v_project, v_platform, '091-SELFCHECK-OBJECT', 'selfcheck', 42, v_admin)
  returning id into v_account;

  -- 1 · The unique constraint actually stops a page being linked twice.
  begin
    insert into public.meta_accounts (project_id, platform_id, meta_object_id, linked_by_id)
    values (v_project, v_platform, '091-SELFCHECK-OBJECT', v_admin);
    raise exception '091 · the same Meta object was linked TWICE — the unique constraint is not working';
  exception when unique_violation then
    null;
  end;

  -- 2 · The error pair cannot be half-set.
  begin
    update public.meta_accounts set last_error = 'only half' where id = v_account;
    raise exception '091 · an error was stored with no timestamp — the check constraint is not working';
  exception when check_violation then
    null;
  end;

  -- 3 · The catalogue carries the verified metrics, and none of the dead ones.
  select count(*) into n from public.meta_metric_catalogue where is_active;
  if n < 15 then
    raise exception '091 · the catalogue holds only % active metrics; expected the 15 verified ones', n;
  end if;

  select count(*) into n from public.meta_metric_catalogue
   where metric_key in ('page_impressions','page_impressions_unique','page_fans','page_fan_adds');
  if n > 0 then
    raise exception '091 · % metric(s) dead in v26.0 are in the catalogue — the sync would fail on them', n;
  end if;

  -- 4 · Every Instagram metric needing metric_type is recorded as such. Getting
  --     this wrong is the (#100) error that reads like a typo.
  select count(*) into n from public.meta_metric_catalogue
   where platform = 'instagram' and metric_key in ('views','profile_views','likes','total_interactions')
     and fetch_mode <> 'total_value';
  if n > 0 then
    raise exception '091 · % IG metric(s) are not marked total_value and would be fetched wrongly', n;
  end if;

  -- 5 · Deleting a project takes its Meta links with it, rather than orphaning.
  delete from public.projects where id = v_project;
  if exists (select 1 from public.meta_accounts where id = v_account) then
    raise exception '091 · the Meta account outlived its project — the cascade is not working';
  end if;

  select count(*) into v_after from public.projects;
  if v_after <> v_before then
    raise exception '091 · project count changed from % to % — the self-check leaked a row', v_before, v_after;
  end if;

  raise notice '091 · meta_accounts and the metric catalogue are in place';
end $$;
