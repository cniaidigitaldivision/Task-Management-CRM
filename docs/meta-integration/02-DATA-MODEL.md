# 🗄️ DATA MODEL — proposed, nothing built

> **Status: proposed.** No migration written, no table created. The database is
> untouched. Migration numbers start at **091** (090 is the last applied).
>
> Read `01-VERIFIED-API-FACTS.md` first — several decisions here exist because of
> what the API actually returned.

---

## 1 · The five tables

```
project_platforms  (EXISTS — extended, not replaced)
      │
      ├── meta_accounts          one row per FB Page / IG account
      │        │
      │        ├── meta_metric_days      the daily time series
      │        ├── meta_posts            posts pulled from Meta
      │        │      └── meta_post_metrics   per-post numbers
      │        └── meta_sync_runs        what the cron did, and what failed
```

---

## 2 · `project_platforms` — extended, not replaced

It already exists with `project_id`, `platform_id`, `handle`, `page_url` — and
`handle` and `page_url` are **null on every row**, including AI & Digital
Division's Facebook and Instagram rows. The join point was built and never
filled.

Nothing is added here. **The Meta identity goes in `meta_accounts`** so a project
platform can exist without a Meta link (a project with no social media, which the
owner explicitly wants left alone) and so one project can hold several accounts
later.

---

## 3 · `meta_accounts`

```sql
create table public.meta_accounts (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  platform_id       uuid not null references public.platforms(id),

  -- ⚠️ THE IDENTITY IS THE NUMERIC ID, NEVER THE URL. A page's vanity slug can
  -- be changed by its owner at any time and would silently break the link.
  meta_object_id    text not null,          -- FB page id, or IG user id
  username          text,                   -- @handle, for humans
  display_name      text,
  profile_picture   text,
  permalink         text,

  -- Last known totals, refreshed each sync. Cheap to read for a card.
  followers         integer,
  media_count       integer,

  is_active         boolean not null default true,
  linked_at         timestamptz not null default now(),
  linked_by_id      uuid references public.users(id),
  last_synced_at    timestamptz,
  last_error        text,
  last_error_at     timestamptz,

  unique (meta_object_id)
);
```

⚠️ **No token column.** Instagram uses `META_SYSTEM_USER_TOKEN` from the
environment; the Facebook Page token is **derived per request** from it. Storing
a derived token would mean an encrypted secret in a table that has to be kept
fresh, for no benefit — the system user token never expires
(`01-VERIFIED-API-FACTS.md`), so the derivation always works.

---

## 4 · `meta_metric_days` — narrow, deliberately

```sql
create table public.meta_metric_days (
  meta_account_id  uuid not null references public.meta_accounts(id) on delete cascade,
  on_date          date not null,
  metric_key       text not null,
  value            numeric not null,
  primary key (meta_account_id, on_date, metric_key)
);
```

⚠️ **Narrow (a row per metric), not wide (a column per metric), and this is the
single most important schema decision here.** The reconnaissance found four
Facebook metrics already dead in v26.0 — `page_impressions`,
`page_impressions_unique`, `page_fans`, `page_fan_adds`. A wide table needs a
migration every time Meta does that. A narrow one needs a row in a catalogue.

The upsert is idempotent on its primary key, so re-running a sync for a day that
already exists corrects it instead of duplicating it — which matters because the
cron re-reads recent days on every pass.

### `meta_metric_catalogue`

```sql
create table public.meta_metric_catalogue (
  metric_key   text primary key,     -- 'page_follows', 'views', 'reach'
  platform     text not null,        -- 'facebook' | 'instagram'
  label        text not null,        -- 'Followers', 'Views'
  format       text not null,        -- 'integer' | 'percent' | 'decimal'
  sort_order   integer not null,
  is_active    boolean not null default true
);
```

Seeded from `01-VERIFIED-API-FACTS.md` §2–3. **A metric Meta retires is
`is_active = false` — never a delete**, so history already collected stays
readable and the graphs covering that period do not develop holes.

---

## 5 · `meta_posts` and `meta_post_metrics`

```sql
create table public.meta_posts (
  id                 uuid primary key default gen_random_uuid(),
  meta_account_id    uuid not null references public.meta_accounts(id) on delete cascade,
  meta_post_id       text not null,
  posted_at          timestamptz not null,
  caption            text,
  media_type         text,          -- IMAGE | VIDEO | CAROUSEL_ALBUM
  media_product_type text,          -- FEED | REELS | STORY
  permalink          text,          -- ⚠️ the click-through target
  thumbnail_url      text,
  task_id            uuid references public.tasks(id) on delete set null,
  unique (meta_account_id, meta_post_id)
);

create table public.meta_post_metrics (
  meta_post_id_fk    uuid primary key references public.meta_posts(id) on delete cascade,
  reach              integer,
  views              integer,
  likes              integer,
  comments           integer,
  shares             integer,
  saves              integer,
  total_interactions integer,
  fetched_at         timestamptz not null default now()
);
```

⚠️ **Post metrics ARE wide, unlike the daily series, and the inconsistency is
intentional.** The per-post metric set is small, stable and identical across both
platforms, and it is always read as a whole row for a card. The daily series is
the one that churns.

### The `task_id` link — nullable, and stays nullable

The original plan agonised over matching a pasted URL back to a Meta post
(`META-INTEGRATION-PLAN.md` §5.5). **That problem is gone**: we pull posts *from*
Meta, so the ID and permalink arrive together.

`task_id` is the *optional* reverse link — "this Meta post is the task Moiz
finished on Tuesday" — matched by comparing `meta_posts.posted_at` against
`task_placements.published_on`. It is a **convenience, never a requirement**. The
Studio works fully with every `task_id` null; the link only enriches the
cadence-vs-outcome summary. Nothing must ever fail because a match was not found.

---

## 6 · `meta_sync_runs`

```sql
create table public.meta_sync_runs (
  id               uuid primary key default gen_random_uuid(),
  meta_account_id  uuid references public.meta_accounts(id) on delete cascade,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  outcome          text not null,      -- 'ok' | 'partial' | 'failed'
  days_written     integer default 0,
  posts_written    integer default 0,
  error            text
);
```

⚠️ **One row per account per run, not one per run.** A five-account sync where
one page has had its access revoked must record four successes and one named
failure. A single run-level row can only say "partial" and leaves somebody
guessing which client is broken — which is exactly the state the Settings & Sync
tab exists to make visible.

---

## 7 · Security

Follows the existing patterns rather than inventing new ones:

- **RLS on every table**, mirroring project visibility. If you cannot see the
  project, you cannot see its Meta numbers.
- Writes only from the sync job, through a `SECURITY DEFINER` function in schema
  `app`, exactly as the attendance terminal writes
  (`app.record_device_scan`).
- ⚠️ **Reference `app.project_is_visible` rather than re-deriving visibility.** A
  second implementation of a visibility rule is how two screens come to disagree
  about who may see a client's numbers.
- No token is stored (§3).

---

## 8 · Migration order, when the time comes

| # | File | Contains |
|---|---|---|
| 091 | `091_meta_accounts.sql` | `meta_accounts` + `meta_metric_catalogue` + seed |
| 092 | `092_meta_metrics.sql` | `meta_metric_days`, `meta_posts`, `meta_post_metrics` |
| 093 | `093_meta_sync_runs.sql` | `meta_sync_runs` + the writer function + RLS |

Each with a self-check in the same transaction, as every migration here does.

⚠️ **The self-check must not borrow a real project or write to a live date.**
Migration 082's did, and it deletes the borrowed person's attendance row for
*today* — see `MEMORY` note *"Migration self-checks can eat live rows"*. Use a
throwaway row and assert a fingerprint over the touched table before and after.
