-- ============================================================================
-- 051 · WHICH SERVICE IS THIS CREDENTIAL FOR — CHOSEN, NOT GUESSED
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-24: *"during the time of creation, it should be selected whether
-- the credentials are Gmail, Facebook, TikTok, or anything like that, so select
-- the image respectively."*
--
-- ── ⚠️ WHY THIS COLUMN IS THE REAL FIX, NOT ANOTHER HOST PATTERN ────────────
-- The icon has been DERIVED from the URL since it was built
-- (`lib/domain/credential-service.ts`), and derivation has now failed twice in
-- one day:
--
--   · `https://google.com/login` labelled "Gmail Login" matched no pattern at
--     all, so a Gmail credential drew a generic key glyph;
--   · `accounts.google.com` names a vendor and not a product, so the right icon
--     was genuinely unknowable from the URL.
--
-- Both were patched by adding patterns. That approach has no end: it needs a new
-- entry for every host in the world, and it can never resolve the cases where the
-- URL honestly does not say. The person storing the credential KNOWS which service
-- it is. Asking them once is worth more than any table of substrings.
--
-- ── NULLABLE, AND THAT IS THE WHOLE MIGRATION STRATEGY ──────────────────────
-- NULL means "nothing was chosen — work it out from the URL", which is exactly
-- what every existing row wants. So:
--
--   · no backfill, and no risk of backfilling one wrongly;
--   · every credential stored before today keeps the behaviour it has now;
--   · the derivation stays as the fallback rather than being replaced, so a row
--     created by an import or a script still gets a sensible icon.
--
-- ── ⚠️ NO CHECK CONSTRAINT ON THE VALUE, DELIBERATELY ───────────────────────
-- The valid values are the keys of `PLATFORM_MARKS` and `SERVICE_MARKS` in
-- `lib/brand/`, which is where marks are added — currently 32 of them. A CHECK
-- would mean a migration every time a logo is added, and the two lists would
-- drift the first time somebody forgot. The application validates the value
-- against the real mark tables before it is stored (`readInput`), and an
-- unrecognised value degrades to the family glyph rather than breaking a page.
--
-- Text rather than an enum for the same reason, and because Postgres enums cannot
-- have values removed.
-- ============================================================================

alter table public.credentials
  add column if not exists service text;

comment on column public.credentials.service is
  'The brand mark to draw for this credential — a key into PLATFORM_MARKS or '
  'SERVICE_MARKS (lib/brand/), e.g. ''gmail'', ''facebook'', ''cpanel''. Chosen by '
  'the person storing it (owner, 2026-08-24). NULL means work it out from the URL '
  'and the label, which is what every row created before this migration does. '
  'Deliberately unconstrained: the valid set lives in the application, where marks '
  'are added, and an unknown value falls back to a generic glyph.';
