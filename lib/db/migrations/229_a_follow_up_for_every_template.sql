-- ============================================================================
-- 229 · A FOLLOW-UP TYPE FOR EVERY TEMPLATE
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-21, with all seventeen templates approved:
--
--   *"Please set every follow-up with its specific template. Make sure from now
--   on no other excuse will be given to me that any template was not present,
--   any follow-up was not present…"*
--
-- Six approved templates had no follow-up type that could pick them — proposal,
-- negotiation, agreement, welcome, feedback — so they could only be chosen by
-- hand from a list. This adds the types. `payment_received` is a type too, but
-- no person chooses it: 230 sends it when finance verifies a booking's payment.
--
-- ⚠️ ONLY THE VALUES, AND ALONE. A new enum value cannot be USED in the
-- transaction that adds it ("unsafe use of new value"), which is why 211 and 212
-- are two files. 230 uses these.
-- ============================================================================

alter type public.crm_followup_purpose add value if not exists 'proposal';
alter type public.crm_followup_purpose add value if not exists 'negotiation';
alter type public.crm_followup_purpose add value if not exists 'agreement';
alter type public.crm_followup_purpose add value if not exists 'welcome';
alter type public.crm_followup_purpose add value if not exists 'meeting_feedback';
alter type public.crm_followup_purpose add value if not exists 'payment_received';

do $chk$
declare
  v_have text[];
begin
  select array_agg(e.enumlabel::text) into v_have
    from pg_type t join pg_enum e on e.enumtypid = t.oid
   where t.typname = 'crm_followup_purpose';
  if not (v_have @> array['proposal', 'negotiation', 'agreement', 'welcome', 'meeting_feedback', 'payment_received']) then
    raise exception '229 · a follow-up type is missing: %', v_have;
  end if;
  raise notice '229 · six follow-up types added — one for every approved template';
end $chk$;
