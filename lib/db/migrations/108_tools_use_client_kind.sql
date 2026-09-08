-- ============================================================================
-- 108 · TOOLS USE `client_kind`, AND `tool_audience` GOES — 2026-09-08
-- ----------------------------------------------------------------------------
-- Owner: *"when I select the tool it's showing a tool detail. Whose tool is
-- this, internal or external? When I choose internal or external it's not
-- creating the project. It is saying again, 'Say whether this is internal or
-- for the external client,' but I have already chosen from the dropdown."*
--
-- ── THE BUG, AND THE MISTAKE BEHIND IT ─────────────────────────────────────
-- The refusal came from `createProjectAction`, which requires `clientKind`.
-- Choosing "Tool" removes the whole "What was sold" section from the form —
-- correctly, since a tool has no posting agreement — and that section is where
-- the internal/external control lives. So the field could not be answered and
-- the server would not proceed: a project type that could never be created.
--
-- ⚠️ BUT THE REAL ERROR WAS ONE LAYER UP. Migration 107 added `tool_audience`
-- as `internal | external`, and `projects.client_kind` has been exactly
-- `internal | external` since it was introduced. Two columns, one fact. The
-- duplication was invisible to me only because the control that already asked
-- the question was hidden behind the section I had just removed.
--
-- `client_kind` is not a dead field either: `lib/domain/ceo-report.ts` splits
-- the monthly report into internal, external and unclassified on it. Keeping
-- `tool_audience` would have meant a tool built FOR a client sitting in the
-- "unclassified" bucket of the report that exists to show exactly that
-- distinction — while the answer sat in a column nothing read.
--
-- So the column added yesterday is removed today. The value is carried over
-- first, and the check is dropped with it.
--
-- ── ⚠️ WHY NOT KEEP BOTH AND COPY ──────────────────────────────────────────
-- Two columns that must agree is a rule nobody can see and every future write
-- has to remember. The one that survives is the one with readers.
-- ============================================================================

-- 1 · Carry the answer over. Only where nothing has been recorded yet, so an
--     edit made since 107 wins over the value it was seeded with.
update public.projects
   set client_kind = tool_audience::public.client_kind
 where type = 'tool'
   and tool_audience is not null
   and client_kind is null;

-- 2 · The constraint first — it references the column.
alter table public.projects
  drop constraint if exists projects_tool_audience_pairing;

alter table public.projects
  drop column if exists tool_audience;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  n integer;
begin
  select count(*) into n
    from information_schema.columns
   where table_name = 'projects' and column_name = 'tool_audience';
  if n <> 0 then
    raise exception '108 · tool_audience is still on projects';
  end if;

  -- ⚠️ THE VALUE SURVIVED THE COLUMN. A drop that silently discarded the three
  --    answers would leave the CEO report unclassifying exactly the projects
  --    this migration exists to classify.
  select count(*) into n
    from public.projects
   where type = 'tool' and client_kind is null;
  if n > 0 then
    raise exception '108 · % tool project(s) lost their internal/external answer', n;
  end if;

  select count(*) into n from public.projects where type = 'tool';
  raise notice '108 · % tool project(s), each classified on client_kind', n;
end $$;
