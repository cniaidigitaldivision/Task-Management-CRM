-- ============================================================================
-- 093 · THE SYNC LOG AND THE ONLY WAY TO WRITE — owner, 2026-09-04
-- ----------------------------------------------------------------------------
-- 091 linked the accounts, 092 made the tables the numbers live in — and gave
-- them NO insert policy for anybody. This file supplies the one path that may
-- write them, and the record of what each run did.
--
-- ── ⚠️ WHY A SECURITY DEFINER FUNCTION AND NOT AN INSERT POLICY ─────────────
-- The same shape the attendance terminal already uses (`app.record_device_scan`,
-- migration 078), for the same reason. These figures go in front of clients. If
-- an INSERT policy existed, then anybody the policy admitted could write a
-- follower count by hand, and a falsified number is indistinguishable from a
-- synced one once it is in the table.
--
-- So there is no policy. There is one function, it is the only thing that can
-- write, and it is the only thing that needs auditing.
--
-- ── ⚠️ ONE LOG ROW PER ACCOUNT, NOT PER RUN ────────────────────────────────
-- A sync covering five accounts where one client has revoked access must record
-- four successes and one NAMED failure. A single run-level row can only say
-- "partial" and leaves somebody opening five clients' pages to find out which
-- one broke. This is the table the Settings & Sync tab reads.
-- ============================================================================

create table if not exists public.meta_sync_runs (
  id              uuid primary key default gen_random_uuid(),
  meta_account_id uuid references public.meta_accounts(id) on delete cascade,

  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  outcome         text not null default 'running'
                    check (outcome in ('running', 'ok', 'partial', 'failed')),

  days_written    integer not null default 0,
  posts_written   integer not null default 0,
  error           text,

  -- Which slice was asked for, so a gap in the series can be explained later.
  window_from     date,
  window_to       date
);

create index if not exists meta_sync_runs_account_idx
  on public.meta_sync_runs (meta_account_id, started_at desc);

-- ⚠️ A partial index, not a plain one. "Show me what is broken" is the only
-- query this table is asked at speed, and it is a tiny fraction of the rows.
create index if not exists meta_sync_runs_failures_idx
  on public.meta_sync_runs (started_at desc) where outcome in ('failed', 'partial');

comment on table public.meta_sync_runs is
  'One row per account per sync attempt (093). Per-account rather than per-run '
  'so a single revoked client page is a named failure, not an unattributed '
  '"partial".';


-- ════════════════════════════════════════════════════════════════════════════
-- THE WRITER
-- ----------------------------------------------------------------------------
-- Takes one account and a JSON payload the sync assembled, and lands the lot in
-- a single transaction. Called by app/api/meta-sync — nothing else.
--
--   p_metrics  [{ "on_date": "2026-09-01", "metric_key": "reach", "value": 31 }]
--   p_posts    [{ "meta_post_id": "...", "posted_at": "...", "caption": "...",
--                 "permalink": "...", "metrics": { "reach": 500, "likes": 12 } }]
--
-- ⚠️ ALL OR NOTHING. Half a day's metrics written and the posts abandoned would
-- leave the Studio drawing a graph that disagrees with the post list beneath it,
-- with nothing to show the two came from different moments.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.record_meta_sync(
  p_account_id uuid,
  p_metrics    jsonb default '[]'::jsonb,
  p_posts      jsonb default '[]'::jsonb,
  p_followers  integer default null,
  p_media_count integer default null,
  p_window_from date default null,
  p_window_to   date default null
)
returns table (run_id uuid, days_written integer, posts_written integer)
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_run    uuid;
  v_days   integer := 0;
  v_posts  integer := 0;
  r        jsonb;
  v_post   uuid;
  v_m      jsonb;
begin
  if not exists (select 1 from public.meta_accounts where id = p_account_id) then
    raise exception 'No Meta account with id %.', p_account_id
      using errcode = 'no_data_found';
  end if;

  insert into public.meta_sync_runs (meta_account_id, window_from, window_to)
  values (p_account_id, p_window_from, p_window_to)
  returning id into v_run;

  -- ── The daily series. Upserted, because the cron re-reads recent days and
  --    Meta revises them for a day or two after the fact.
  for r in select * from jsonb_array_elements(coalesce(p_metrics, '[]'::jsonb))
  loop
    insert into public.meta_metric_days (meta_account_id, on_date, metric_key, value, fetched_at)
    values (p_account_id,
            (r->>'on_date')::date,
            r->>'metric_key',
            (r->>'value')::numeric,
            now())
    on conflict (meta_account_id, on_date, metric_key)
      do update set value = excluded.value, fetched_at = now();
    v_days := v_days + 1;
  end loop;

  -- ── Posts, and their metrics.
  for r in select * from jsonb_array_elements(coalesce(p_posts, '[]'::jsonb))
  loop
    insert into public.meta_posts
      (meta_account_id, meta_post_id, posted_at, caption, media_type,
       media_product_type, permalink, thumbnail_url, updated_at)
    values
      (p_account_id,
       r->>'meta_post_id',
       (r->>'posted_at')::timestamptz,
       r->>'caption',
       r->>'media_type',
       r->>'media_product_type',
       r->>'permalink',
       r->>'thumbnail_url',
       now())
    on conflict (meta_account_id, meta_post_id) do update
      set caption            = excluded.caption,
          media_type         = excluded.media_type,
          media_product_type = excluded.media_product_type,
          permalink          = excluded.permalink,
          thumbnail_url      = excluded.thumbnail_url,
          updated_at         = now()
    returning id into v_post;

    v_m := r->'metrics';
    if v_m is not null and jsonb_typeof(v_m) = 'object' then
      -- ⚠️ `nullif(x, 'null')::integer` throughout, never `coalesce(x, 0)`. A
      -- metric the platform does not report must stay NULL — Facebook reports no
      -- `saves`, and writing 0 would tell a reader nobody saved the post.
      insert into public.meta_post_metrics
        (meta_post_id, reach, views, likes, comments, shares, saves, total_interactions, fetched_at)
      values
        (v_post,
         nullif(v_m->>'reach','')::integer,
         nullif(v_m->>'views','')::integer,
         nullif(v_m->>'likes','')::integer,
         nullif(v_m->>'comments','')::integer,
         nullif(v_m->>'shares','')::integer,
         nullif(v_m->>'saves','')::integer,
         nullif(v_m->>'total_interactions','')::integer,
         now())
      on conflict (meta_post_id) do update
        set reach              = excluded.reach,
            views              = excluded.views,
            likes              = excluded.likes,
            comments           = excluded.comments,
            shares             = excluded.shares,
            saves              = excluded.saves,
            total_interactions = excluded.total_interactions,
            fetched_at         = now();
    end if;

    v_posts := v_posts + 1;
  end loop;

  -- ── The account's own headline totals, and a successful sync clears any
  --    error left by a previous failure. The pair must move together or the
  --    check constraint from 091 refuses the row.
  update public.meta_accounts
     set followers      = coalesce(p_followers, followers),
         media_count    = coalesce(p_media_count, media_count),
         last_synced_at = now(),
         last_error     = null,
         last_error_at  = null,
         updated_at     = now()
   where id = p_account_id;

  update public.meta_sync_runs
     set finished_at   = now(),
         outcome       = 'ok',
         days_written  = v_days,
         posts_written = v_posts
   where id = v_run;

  return query select v_run, v_days, v_posts;
end $$;

comment on function app.record_meta_sync is
  'The only path that writes Meta figures (093). All-or-nothing, upserts '
  'everything, and clears the account error on success. Called by '
  'app/api/meta-sync and nothing else.';


-- ── Recording a failure, without pretending it was a success ────────────────
create or replace function app.record_meta_sync_failure(
  p_account_id uuid,
  p_error      text
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare v_run uuid;
begin
  insert into public.meta_sync_runs (meta_account_id, finished_at, outcome, error)
  values (p_account_id, now(), 'failed', left(coalesce(p_error, 'unknown'), 2000))
  returning id into v_run;

  -- ⚠️ The error is written onto the ACCOUNT too, not only the log. The Studio
  -- shows "last synced 6 hours ago" from the account row; without this a client
  -- whose access was revoked would look merely stale rather than broken, and
  -- nobody would go looking in the log.
  update public.meta_accounts
     set last_error    = left(coalesce(p_error, 'unknown'), 2000),
         last_error_at = now(),
         updated_at    = now()
   where id = p_account_id;

  return v_run;
end $$;


-- ── Visibility ──────────────────────────────────────────────────────────────
alter table public.meta_sync_runs enable row level security;

drop policy if exists meta_sync_runs_select on public.meta_sync_runs;
create policy meta_sync_runs_select on public.meta_sync_runs
  for select using (
    exists (select 1 from public.meta_accounts a
             where a.id = meta_sync_runs.meta_account_id
               and app.project_is_visible(a.project_id))
  );

grant select on public.meta_sync_runs to cni_app;
grant execute on function app.record_meta_sync(uuid, jsonb, jsonb, integer, integer, date, date) to cni_app;
grant execute on function app.record_meta_sync_failure(uuid, text) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin uuid; v_ig uuid; v_project uuid; v_account uuid;
  v_before bigint; v_after bigint;
  r record; n integer; v_saves integer; v_err text;
begin
  select count(*) into v_before from public.projects;

  select id into v_admin from public.users where role in ('super_admin','admin') and is_active limit 1;
  select id into v_ig    from public.platforms where slug = 'instagram' limit 1;
  if v_admin is null or v_ig is null then
    raise notice '093 · no admin or platform row; function is in place, self-check skipped';
    return;
  end if;

  perform set_config('app.user_id', v_admin::text, true);

  insert into public.projects (name, type, code, created_by_id, owner_id)
  values ('093 self-check — delete me', 'other', 'OTH', v_admin, v_admin)
  returning id into v_project;

  insert into public.meta_accounts (project_id, platform_id, meta_object_id, linked_by_id, last_error, last_error_at)
  values (v_project, v_ig, '093-SELFCHECK-OBJECT', v_admin, 'a previous failure', now())
  returning id into v_account;

  -- ── 1 · A real payload lands.
  select * into r from app.record_meta_sync(
    v_account,
    '[{"on_date":"2026-09-01","metric_key":"reach","value":31},
      {"on_date":"2026-09-02","metric_key":"reach","value":44}]'::jsonb,
    '[{"meta_post_id":"P1","posted_at":"2026-09-01T10:00:00Z","caption":"hello",
       "permalink":"https://example.test/p/1",
       "metrics":{"reach":500,"likes":12,"saves":null}}]'::jsonb,
    16, 49, date '2026-09-01', date '2026-09-02');

  if r.days_written <> 2 or r.posts_written <> 1 then
    raise exception '093 · wrote % days and % posts, expected 2 and 1', r.days_written, r.posts_written;
  end if;

  -- ── 2 · ⚠️ A NULL METRIC STAYED NULL. Facebook reports no `saves`; a 0 here
  --        would tell a reader nobody saved the post.
  select saves into v_saves from public.meta_post_metrics m
    join public.meta_posts p on p.id = m.meta_post_id
   where p.meta_account_id = v_account;
  if v_saves is not null then
    raise exception '093 · an unreported metric was stored as %, not null', v_saves;
  end if;

  -- ── 3 · Success cleared the previous error.
  select last_error into v_err from public.meta_accounts where id = v_account;
  if v_err is not null then
    raise exception '093 · a successful sync left the old error in place: %', v_err;
  end if;

  -- ── 4 · Re-running the identical payload corrects rather than duplicates.
  perform app.record_meta_sync(
    v_account,
    '[{"on_date":"2026-09-01","metric_key":"reach","value":99}]'::jsonb,
    '[]'::jsonb, 16, 49, date '2026-09-01', date '2026-09-01');

  select count(*) into n from public.meta_metric_days
   where meta_account_id = v_account and on_date = date '2026-09-01';
  if n <> 1 then
    raise exception '093 · re-running produced % rows for one day', n;
  end if;

  -- ── 5 · A failure is recorded on the account, not only in the log.
  perform app.record_meta_sync_failure(v_account, 'access revoked by the client');
  select last_error into v_err from public.meta_accounts where id = v_account;
  if v_err is null then
    raise exception '093 · a failure did not reach the account row — it would look merely stale';
  end if;

  select count(*) into n from public.meta_sync_runs
   where meta_account_id = v_account and outcome = 'failed';
  if n <> 1 then
    raise exception '093 · expected one failed run, found %', n;
  end if;

  delete from public.projects where id = v_project;
  select count(*) into v_after from public.projects;
  if v_after <> v_before then
    raise exception '093 · project count went from % to %', v_before, v_after;
  end if;

  raise notice '093 · the writer upserts, keeps nulls null, clears and records errors';
end $$;
