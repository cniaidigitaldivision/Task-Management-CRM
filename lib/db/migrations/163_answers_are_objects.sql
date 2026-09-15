-- ============================================================================
-- 163 · `answers` IS AN OBJECT, NOT A STRING THAT LOOKS LIKE ONE
-- ----------------------------------------------------------------------------
-- Reported by the owner from the test run, on the lead drawer's Overview tab:
--
--     *"what they told the form is character by character, something like that.
--     What is that? I don't understand what this is, so it's totally out of
--     order."*
--
-- ── ⚠️ A DOUBLE-ENCODED JSONB, AND NOTHING ANYWHERE COMPLAINED ─────────────
-- `crm_leads.answers` is `jsonb`. `app/actions/crm-test-lead.ts` wrote it as
-- `${JSON.stringify(obj)}::jsonb` — which Postgres accepts, and which stores a
-- jsonb whose TYPE is `string`, holding the text of an object rather than the
-- object.
--
-- Every layer stayed quiet. The column is jsonb, so the cast is legal. The value
-- round-trips. TypeScript types it `Record<string, unknown>` because that is
-- what the interface claims. And then the drawer does
-- `Object.entries(lead.answers)` — which, on a string, yields ONE ENTRY PER
-- CHARACTER. That is the "character by character" on screen.
--
-- Measured before fixing: **2 of 659** leads, both from the demo test form.
-- Every one of the 636 imported from Meta is a proper object, because the
-- importer builds the jsonb in SQL rather than handing it a string.
--
-- ⚠️ THE WRITER IS FIXED SEPARATELY (`tx.json(...)`, which is what every other
-- jsonb write here already uses). This file repairs the two rows that exist and
-- stops any more arriving.
-- ============================================================================

update public.crm_leads
   /* ⚠️ `#>>` yields TEXT, so the cast back to jsonb is not optional — without
      it Postgres refuses the assignment outright, which is the good outcome.
      The text is the object's own source, so this parses it rather than
      re-wrapping it. */
   set answers = (answers #>> '{}')::jsonb
 where jsonb_typeof(answers) = 'string'
   /* ⚠️ ONLY WHERE THE TEXT IS ITSELF AN OBJECT. A jsonb string holding a plain
      sentence is somebody's answer, not a mis-encoded record, and turning it
      into an object would be this migration inventing structure that was never
      there. */
   and left(btrim(answers #>> '{}'), 1) = '{';

-- ⚠️ NOT VALID, so the 657 rows that predate it are left alone and every future
-- write is bound. There is nothing wrong with those rows — they are objects
-- already — but a constraint that has to scan the table to prove it is a lock on
-- a live table for a rule about the future.
alter table public.crm_leads
  drop constraint if exists crm_leads_answers_is_object;
alter table public.crm_leads
  add constraint crm_leads_answers_is_object
  check (jsonb_typeof(answers) = 'object') not valid;

comment on column public.crm_leads.answers is
  'What they typed into the form. ⚠️ ALWAYS a jsonb OBJECT — write it with '
  'tx.json(...), never JSON.stringify(...)::jsonb, which stores a jsonb string '
  'and makes Object.entries() walk it one character at a time. Migration 163.';

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  n_string int; n_total int; v_id uuid; bad boolean := false;
begin
  select count(*) into n_total from public.crm_leads;
  select count(*) into n_string from public.crm_leads where jsonb_typeof(answers) = 'string';

  -- 1 · Not one row is a string any more.
  if n_string <> 0 then
    raise exception '163 · % leads still hold answers as a string', n_string;
  end if;

  -- 2 · ⚠️ AND THE REPAIRED ROWS ACTUALLY HAVE THEIR KEYS BACK. Unwrapping to
  --     an EMPTY object would satisfy check 1 and have thrown the answers away.
  if exists (
    select 1 from public.crm_leads
     where full_name like 'Mohsin Testing%'
       and (answers = '{}'::jsonb or answers -> 'which_product_are_you_interested_in' is null)
  ) then
    raise exception '163 · a repaired row lost its answers';
  end if;

  -- 3 · ⚠️ AND A NEW DOUBLE-ENCODED WRITE IS NOW REFUSED, which is the whole
  --     point — the two rows were a symptom, the writer was the cause.
  select id into v_id from public.crm_leads limit 1;
  if v_id is not null then
    begin
      update public.crm_leads
         set answers = to_jsonb('{"a":"b"}'::text)
       where id = v_id;
      bad := true;
    exception when check_violation then null;
    end;
    if bad then
      raise exception '163 · a jsonb string was accepted into answers';
    end if;
  end if;

  raise notice '163 · every one of % leads holds answers as an object, the repaired rows kept their keys, and a string is now refused', n_total;
end $chk$;
