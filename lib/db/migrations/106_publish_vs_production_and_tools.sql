-- ============================================================================
-- 106 · TELLING PUBLISHING APART FROM MAKING, AND TOOLS FROM CLIENTS
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-08:
--
--   *"Everybody is confused between static post designing and static post
--   publishing so make a different category… for static post publishing or reel
--   publishing there is a rule: you should place the URL… if someone is just
--   designing that static post, he should select the static post designing
--   category. For that the URL entry is not restricted."*
--
-- and:
--
--   *"when I create a new project there is an option for a client, a business,
--   an event. Add one more thing: a tool… For that there is no need for any
--   social media."*
--
-- ── ⚠️ THIS MIGRATION ONLY ADDS ENUM VALUES, AND THAT IS WHY IT IS SPLIT ────
-- `ALTER TYPE … ADD VALUE` is permitted inside a transaction on PostgreSQL 12+,
-- but the new label CANNOT BE USED until that transaction commits — any
-- reference raises "unsafe use of new value". `scripts/migrate.mjs` wraps every
-- file in one transaction, so a self-check here that inserted a `static_design`
-- task, or moved a project to `tool`, would fail on a migration that is
-- otherwise correct.
--
-- So the labels land here with nothing else, and 107 does the work that needs
-- them: the `tool_audience` column, moving the three tool projects, and the
-- checks that prove both. Two files, one idea, and the order matters.
--
-- ── ⚠️ THE EXISTING LABELS KEEP THEIR MEANING ──────────────────────────────
-- `static` and `reel` are NOT renamed. Every row already carrying them means a
-- post that goes out — that is precisely why `PUBLISH_PROOF_KINDS` gates them —
-- so the fix is to say so in the interface rather than to migrate data. Their
-- labels in lib/domain/constants.ts now read "Static post — publishing" and
-- "Reel — publishing"; the new labels below are the work that PRECEDES a post,
-- and none of them is gated on a URL.
-- ============================================================================

-- ── The making of a thing, as distinct from the publishing of it ────────────
alter type public.content_kind add value if not exists 'static_design';
alter type public.content_kind add value if not exists 'video_edit';
alter type public.content_kind add value if not exists 'ai_generation';

-- ── Development, which this division does and could not previously file ─────
alter type public.content_kind add value if not exists 'frontend';
alter type public.content_kind add value if not exists 'backend';

-- ── A project that is a product rather than an audience ─────────────────────
alter type public.project_type add value if not exists 'tool';
