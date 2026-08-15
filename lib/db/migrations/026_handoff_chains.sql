-- =============================================================================
-- 026 · HANDOFF CHAINS — doc 12 E-004, owner rule R4a
-- =============================================================================
-- *"Kashif finishes the reel → the system automatically creates 'Schedule reel
--  across Meta + TikTok' and assigns it to Yusra using the smart engine."*
--
-- Doc 12 calls E-004 "possibly the single highest-value idea in this document
-- for your specific team", and the reason is in its own sentence: that handoff
-- currently lives in somebody's head and drops when they are busy.
--
-- ── THIS IS NOT THE WORKFLOW ENGINE FROM THE REFERENCE ───────────────────────
-- R4 said workflow automation was not to be built. R4a narrows the reversal to
-- exactly this, and the carve-out is a security boundary rather than a scope
-- preference: the reference editor's nodes are Shell Script, HTTP Request and
-- Web Hook — arbitrary code execution and outbound SSRF inside a system whose
-- whole design is row-level security, least privilege and an encrypted vault.
--
-- ⛔ A node here creates a TASK. It can do nothing else, and there is deliberately
--    no column in which a command, a URL or a payload could be stored. If a
--    future migration adds one, that is a new threat model, not a new feature.
--
-- ── THE FOUR DECISIONS THIS SCHEMA ENCODES (owner, 2026-08-15) ───────────────
--   1. A chain belongs to a PROJECT TYPE. The pipeline is a property of the kind
--      of work, not of one project, so "every Client retainer runs edit → design
--      → ads" is written once. Five types, so at most five live chains.
--   2. A step fires when a task reaches DONE. The literal reading of E-004, and
--      the one state `tasks_completed_at_matches_status` already makes coherent,
--      so it cannot fire twice for one completion.
--   3. The SMART ENGINE picks the assignee. A node stores a required SKILL, not
--      a person — so it keeps working when somebody leaves, and it respects
--      capacity instead of dropping work on whoever is already at their limit.
--   4. NO VERSIONING. A chain is configuration, like system settings: edit it and
--      the next completion uses the new shape. Tasks already created are ordinary
--      tasks by then and are unaffected.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · THE CHAIN
-- -----------------------------------------------------------------------------
create table if not exists public.handoff_chains (
  id             uuid primary key default gen_random_uuid(),

  name           text not null,
  project_type   public.project_type not null,

  -- Retirement, not deletion — the same reasoning as `skills.is_active`. A chain
  -- that produced work last month is part of why that work exists.
  is_active      boolean not null default true,

  created_by_id  uuid not null references public.users (id) on delete restrict,
  updated_by_id  uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint handoff_chains_name_present check (length(btrim(name)) between 1 and 120)
);

-- ⚠️ AT MOST ONE ACTIVE CHAIN PER PROJECT TYPE, STRUCTURALLY.
-- Two live chains on `client` would both match a completed task and the system
-- would have to pick one — and whichever rule it used would be invisible to the
-- person whose work suddenly forked. A partial unique index makes the question
-- unaskable, the same technique as users_single_super_admin_idx and
-- projects_single_permanent_idx.
create unique index if not exists handoff_chains_one_active_per_type
  on public.handoff_chains (project_type)
  where is_active;

comment on table public.handoff_chains is
  'doc 12 E-004 / R4a. One active chain per project type. Creates tasks and nothing else — see the header on migration 026 before adding any column.';
comment on index public.handoff_chains_one_active_per_type is
  'At most one active chain per project type, so a completed task can never match two.';


-- -----------------------------------------------------------------------------
-- 2 · THE STEPS
-- -----------------------------------------------------------------------------
-- Ordered by `position`. Position 0 is the TRIGGER and creates nothing: it names
-- the skill whose completion starts the chain. Positions 1..n each describe one
-- task to create.
--
-- Linear, not a graph. E-004 is a pipeline — editor → designer → ads manager —
-- and a graph would mean branch conditions, join semantics and cycle detection
-- for a shape nobody has asked for. The canvas draws it as connected nodes
-- because that is the reference's LOOK; the semantics underneath stay a list.
create table if not exists public.handoff_nodes (
  id               uuid primary key default gen_random_uuid(),
  chain_id         uuid not null references public.handoff_chains (id) on delete cascade,

  position         integer not null,

  -- RESTRICT, not CASCADE: deleting a skill must not silently gut a chain.
  -- Retire the skill instead (skills.is_active), exactly as user_skills does.
  skill_id         uuid not null references public.skills (id) on delete restrict,

  -- What the created task is called. NULL at position 0, which creates nothing.
  title            text,
  description      text,
  effort_points    numeric(6,2),
  priority         public.task_priority not null default 'medium',
  -- Due this many days after the task is created. NULL leaves it undated rather
  -- than inventing a deadline nobody chose.
  due_offset_days  integer,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint handoff_nodes_position_sane check (position >= 0),

  -- The trigger describes no work; every other step must describe real work.
  -- Expressed as a constraint rather than trusted to the form, for the same
  -- reason `tasks_blocked_needs_reason` is: a step with no title would create a
  -- nameless task and nobody would know what it was for.
  constraint handoff_nodes_shape check (
    (position = 0
      and title is null and effort_points is null and due_offset_days is null)
    or (position > 0
      and length(btrim(coalesce(title, ''))) > 0
      and effort_points is not null and effort_points > 0)
  ),
  constraint handoff_nodes_offset_sane check (due_offset_days is null or due_offset_days >= 0)
);

-- One node per position per chain, so the order is unambiguous.
create unique index if not exists handoff_nodes_chain_position_key
  on public.handoff_nodes (chain_id, position);

create index if not exists handoff_nodes_skill_idx on public.handoff_nodes (skill_id);

comment on table public.handoff_nodes is
  'Ordered steps. Position 0 is the trigger and creates nothing; 1..n each create one task. Linear by design — see migration 026.';


-- -----------------------------------------------------------------------------
-- 3 · WHERE A TASK SITS IN ITS CHAIN
-- -----------------------------------------------------------------------------
-- ⚠️ THIS IS A POSITION POINTER, NOT A VERSION REFERENCE.
-- The owner chose no versioning, and this does not reintroduce it. It exists
-- because the chain has to be able to answer "which step just finished?" when a
-- task completes, and the alternative — matching on the task's skills — breaks
-- the moment a task carries two skills or a skill appears twice in one chain.
--
-- `on delete set null`: deleting a chain must not delete real work. The task
-- survives as an ordinary task, which is exactly what it already was.
alter table public.tasks
  add column if not exists handoff_node_id uuid
    references public.handoff_nodes (id) on delete set null;

create index if not exists tasks_handoff_node_idx
  on public.tasks (handoff_node_id)
  where handoff_node_id is not null;

comment on column public.tasks.handoff_node_id is
  'The chain step that created this task, or NULL if a person did. Used to find the NEXT step on completion — a position pointer, not a version.';


-- -----------------------------------------------------------------------------
-- 4 · updated_at
-- -----------------------------------------------------------------------------
drop trigger if exists handoff_chains_touch_updated_at on public.handoff_chains;
create trigger handoff_chains_touch_updated_at
  before update on public.handoff_chains
  for each row execute function app.touch_updated_at();

drop trigger if exists handoff_nodes_touch_updated_at on public.handoff_nodes;
create trigger handoff_nodes_touch_updated_at
  before update on public.handoff_nodes
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- 5 · ROW-LEVEL SECURITY
-- -----------------------------------------------------------------------------
-- Modelled on `skills`, which is the closest existing thing: readable by anyone
-- signed in, writable by Admin and above.
--
-- Readable by everyone on purpose. A Member who finds a task they did not create
-- should be able to see WHY it exists, and "the Client retainer chain made it"
-- is the answer. A chain holds no personal data — a name, a project type, a
-- skill and an effort estimate.
alter table public.handoff_chains enable row level security;
alter table public.handoff_nodes  enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'handoff_chains_select') then
    create policy handoff_chains_select on public.handoff_chains
      for select to cni_app
      using (app.current_user_id() is not null);
  end if;

  if not exists (select 1 from pg_policy where polname = 'handoff_chains_write') then
    create policy handoff_chains_write on public.handoff_chains
      for all to cni_app
      using (app.acting_at_least('admin'::public.user_role))
      with check (app.acting_at_least('admin'::public.user_role));
  end if;

  if not exists (select 1 from pg_policy where polname = 'handoff_nodes_select') then
    create policy handoff_nodes_select on public.handoff_nodes
      for select to cni_app
      using (app.current_user_id() is not null);
  end if;

  if not exists (select 1 from pg_policy where polname = 'handoff_nodes_write') then
    create policy handoff_nodes_write on public.handoff_nodes
      for all to cni_app
      using (app.acting_at_least('admin'::public.user_role))
      with check (app.acting_at_least('admin'::public.user_role));
  end if;
end
$$;

grant select, insert, update, delete on public.handoff_chains to cni_app;
grant select, insert, update, delete on public.handoff_nodes  to cni_app;
revoke all on public.handoff_chains from anon, authenticated;
revoke all on public.handoff_nodes  from anon, authenticated;


-- -----------------------------------------------------------------------------
-- 6 · SELF-CHECK
-- -----------------------------------------------------------------------------
do $$
declare
  v_missing text;
  v_chain   uuid;
  v_skill   uuid;
begin
  select string_agg(t, ', ') into v_missing
  from unnest(array['handoff_chains', 'handoff_nodes']) as t
  where not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = t
  );
  if v_missing is not null then
    raise exception 'Migration 026 incomplete — missing: %', v_missing;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'handoff_node_id'
  ) then
    raise exception 'Migration 026 incomplete — tasks.handoff_node_id missing';
  end if;

  -- Prove the one-active-chain-per-type rule actually binds, then undo it.
  select id into v_skill from public.skills limit 1;
  if v_skill is not null then
    insert into public.handoff_chains (name, project_type, is_active, created_by_id)
    select '__probe_a', 'client', true, u.id from public.users u limit 1
    returning id into v_chain;

    begin
      insert into public.handoff_chains (name, project_type, is_active, created_by_id)
      select '__probe_b', 'client', true, u.id from public.users u limit 1;
      delete from public.handoff_chains where name in ('__probe_a', '__probe_b');
      raise exception 'Migration 026 FAILED — two active chains on one project type were accepted';
    exception
      when unique_violation then
        delete from public.handoff_chains where name = '__probe_a';
        raise notice 'Migration 026 OK — one-active-chain-per-type binds, tables and column present';
    end;
  else
    raise notice 'Migration 026 OK — tables and column present (no skills yet, uniqueness probe skipped)';
  end if;
end
$$;
