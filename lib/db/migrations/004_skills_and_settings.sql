-- ============================================================================
-- CNI CRM — MIGRATION 004 · SKILLS, PROFICIENCY, SYSTEM SETTINGS
-- ----------------------------------------------------------------------------
-- Creates:  skills · user_skills · system_settings
--
-- Specification:  docs/04-DATA-MODEL.md §2
--                 docs/19-MASTER-SPECIFICATION-REGISTRY.md §5, §6, §9a
--                 docs/20-IMPLEMENTATION-CONTRACTS.md §9 step 2.5
--                 FR-012, FR-017, FR-055
--
-- ⛔ Never edit an applied migration (doc 20 §7).
--
-- No starter skill data here. doc 20 §9 puts the starter library in STEP 6
-- (6.1) with the team-management UI that maintains it, and T-105c makes it
-- editable — seeding it now would put ~35 rows in a migration where they can
-- never be corrected without another migration.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1 · skills — the library
-- ----------------------------------------------------------------------------
-- FR-017. `keywords` is what makes FR-055 possible: when a task has no tagged
-- skills, the assignment engine falls back to matching the task title and
-- description against these words. Without it, an untagged task scores every
-- candidate identically and the recommendation is noise.

create table public.skills (
  id           uuid primary key default gen_random_uuid(),

  slug         text not null,
  label        text not null,
  category     text,

  -- e.g. {video, reel, edit, premiere, footage} for video-editing.
  keywords     text[] not null default '{}',

  -- Retirement, not deletion. A skill in use cannot be deleted (the
  -- user_skills foreign key below restricts it), and it should not be:
  -- removing it would rewrite the history of who was capable of what.
  -- Registry §9a records this as an addition to doc 04 §2.
  is_active    boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint skills_slug_shaped
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint skills_label_present
    check (length(btrim(label)) between 1 and 80)
);

create unique index skills_slug_key on public.skills (slug);

create index skills_active_idx on public.skills (label) where is_active;

-- "Which skills mention this word?" — the FR-055 keyword fallback.
create index skills_keywords_idx on public.skills using gin (keywords);

create trigger skills_touch_updated_at
  before update on public.skills
  for each row execute function app.touch_updated_at();

comment on table public.skills is
  'FR-017. The editable skills library. Retired via is_active, never deleted while in use.';
comment on column public.skills.keywords is
  'Fallback text matching for tasks with no tagged skills (FR-055).';


-- ----------------------------------------------------------------------------
-- 2 · user_skills — who can do what, and how well
-- ----------------------------------------------------------------------------
-- doc 04 §2: "This is what makes assignment intelligent." Proficiency is the
-- difference between "can help" and "is the right person", and it is the
-- heaviest single factor in the score (skill = 0.38, registry C-06).
--
-- Members can read only their own rows (ADR-003). Only Admin+ may set them
-- (doc 03 "Set capacity, skills, max concurrent tasks") — self-assessed
-- proficiency would make the assignment engine a popularity contest.

create table public.user_skills (
  user_id      uuid not null references public.users (id)  on delete cascade,
  -- RESTRICT, not CASCADE: deleting a skill must not silently erase the record
  -- of who held it. Retire the skill instead (skills.is_active).
  skill_id     uuid not null references public.skills (id) on delete restrict,

  -- 5 = expert · 3 = capable · 1 = can help
  proficiency  integer not null,
  is_primary   boolean not null default false,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  primary key (user_id, skill_id),

  constraint user_skills_proficiency_range
    check (proficiency between 1 and 5)
);

-- One headline specialty per person.
create unique index user_skills_one_primary_per_user_idx
  on public.user_skills (user_id)
  where is_primary;

-- "Who can do video editing?" — the candidate query the assignment engine
-- opens with (doc 04 §4).
create index user_skills_skill_idx
  on public.user_skills (skill_id, proficiency desc);

create trigger user_skills_touch_updated_at
  before update on public.user_skills
  for each row execute function app.touch_updated_at();

comment on table public.user_skills is
  'FR-012. Proficiency 1–5 per person per skill. Set by Admin+ only (doc 03); '
  'readable by the owner and by Coordinator+ (ADR-003).';


-- ----------------------------------------------------------------------------
-- 3 · system_settings — OVERRIDES ONLY
-- ----------------------------------------------------------------------------
-- doc 19 §5 lists 33 settings with defaults. Those defaults live in
-- lib/domain/constants.ts (SYSTEM_DEFAULTS) and are NOT duplicated here.
--
-- This table holds only what somebody has deliberately changed:
--
--     getSetting(key)  =  stored override  ??  SYSTEM_DEFAULTS[key]
--
-- Seeding the defaults would put the same 33 values in three places — doc 19
-- §5, constants.ts, and this table — with nothing keeping them equal, which is
-- precisely the drift doc 20 §3 exists to prevent. Registry §9a, C-16.
--
-- A useful consequence: adding a setting needs no migration, and an empty
-- table means "everything is at its documented default", which is a much
-- easier thing to verify than 33 rows.

create table public.system_settings (
  key            text primary key,
  value          jsonb not null,

  -- Who changed it, and when. Every settings change is also written to
  -- audit_log (doc 16 §10); these columns make the current state
  -- self-explanatory without a join.
  updated_by_id  uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint system_settings_key_shaped
    check (key ~ '^[a-z][a-z0-9_]*$')
);

create trigger system_settings_touch_updated_at
  before update on public.system_settings
  for each row execute function app.touch_updated_at();

comment on table public.system_settings is
  'Overrides only. Unset keys fall back to SYSTEM_DEFAULTS in lib/domain/constants.ts. '
  'Key list: doc 19 §5. Registry C-16 / §9a for why nothing is seeded.';
comment on column public.system_settings.value is
  'jsonb so one table holds numbers, booleans, strings and lists without a type column. '
  'Shape is validated per key by Zod at layer 3.';
