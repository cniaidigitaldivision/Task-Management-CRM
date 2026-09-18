-- ============================================================================
-- 205 · A LEAD CAN BE NURTURED — the stage itself
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-18: *"after the third sequence follow-up the client didn't
-- reply. I think it should move to nurture, right?… Whenever I click on the
-- dropdown to see the nurture leads, I can see that. I know that he contacted us
-- and we sent three follow-ups successfully but he didn't reply so that's why
-- this lead goes to nurture."*
--
-- Which is the right answer to a question I put to them earlier: a lead that
-- ignored three chases is not lost — it never said no — and it is not in the
-- pipeline either. It is parked.
--
-- ⚠️ NURTURE IS AN **OPEN** STAGE, AND THAT IS THE WHOLE POINT. `lost` is a
-- decision with a reason attached; `nurture` is the absence of one. A lead here
-- still counts as live, can still be worked, and can still be won — it has simply
-- stopped answering, and somebody should decide what to do about it later rather
-- than today.
--
-- ⚠️ AND IT DOES NOT REQUIRE QUALIFICATION. `app.crm_require_qualification`
-- demands BANT for `qualified` and beyond; `nurture` is deliberately outside that
-- list, exactly as `lost` is — a lead that stopped replying before it was ever
-- qualified must still be parkable.
--
-- ⚠️ THIS MIGRATION ADDS THE VALUE AND NOTHING ELSE. Postgres refuses to USE a
-- new enum value in the transaction that added it ("unsafe use of new value"),
-- and every migration here runs inside one (`sql.begin` in scripts/migrate.mjs).
-- So 206 carries the automation and the self-check that exercises it.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'crm_stage' and e.enumlabel = 'nurture'
  ) then
    /* Before `won`, so the dropdown reads as the pipeline, then the two ways a
       lead leaves it, with "parked" beside them rather than buried mid-funnel. */
    alter type public.crm_stage add value 'nurture' before 'won';
  end if;
end $$;
