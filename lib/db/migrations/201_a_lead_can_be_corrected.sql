-- ============================================================================
-- 201 · A LEAD CAN BE CORRECTED — the person's own details are editable
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-18:
--
--   *"Add the edit option for things like phone number, email, for example, if I
--   want to change it, or their name, their interest… when I contact him and he
--   gives me a correct number or a correct email, I want to add that
--   information."*
--
-- Which is the commonest correction in this business: a Meta form arrives with a
-- typo'd number, the salesperson rings the one that works, and the record has to
-- follow. Today it cannot — `cni_app` has UPDATE on `stage`, `temperature`,
-- `owner_id`, `property_id` and the next action, and **not** on `full_name`,
-- `phone`, `phone_e164`, `email`, `city` or `answers`. The RLS policy has always
-- allowed the owner to update their lead; the GRANT was never widened, so the
-- feature could not be built.
--
-- ⚠️ A GRANT, NOT A POLICY, AND THE DIFFERENCE IS THE ERROR. A missing column
-- grant says "permission denied for table crm_leads" — which reads as RLS and
-- sends somebody to rewrite a policy that was already correct. 166 is the
-- migration that learnt this; `definers-hide-missing-grants` is the note.
--
-- ⚠️ WHO MAY EDIT IS STILL RLS'S ANSWER, unchanged: `crm_leads_update` allows the
-- lead's owner, a manager of its department, and admins. A grant cannot widen
-- that — it only stops the column being refused before the policy is consulted.
--
-- ⚠️ AND `phone_e164` IS NOT DECORATION. It is what duplicate detection, the
-- WhatsApp link and the message thread all match on. A writer that changed
-- `phone` and left `phone_e164` pointing at the old number would break all three
-- silently — the lead would look corrected and still reach the wrong handset. So
-- the pair is guarded below.
-- ============================================================================

/* ⚠️ THE COLUMNS THE PERSON IS MADE OF, AND NOTHING ELSE. `project_id`,
   `source`, `external_id`, `submitted_at` and `is_test_data` stay unwritable:
   they are where the lead CAME FROM, and a record whose provenance can be edited
   cannot be reconciled with Meta's own export. */
grant update (full_name, phone, phone_e164, email, city, answers)
  on public.crm_leads to cni_app;

/**
 * The normalised number must follow the number.
 *
 * ⚠️ IT COMPARES DIGITS, IT DOES NOT PARSE. `lib/domain/phone.ts` knows about
 * 0092, leading zeros and country codes, and is tested; restating that in PL/pgSQL
 * would be a second parser to keep in step. This asks only the question that
 * catches the bug: does the stored E.164 still end with the last nine digits of
 * the number somebody typed? A stale one does not.
 */
create or replace function app.crm_leads_guard_phone_pair()
returns trigger
language plpgsql
as $fn$
declare
  v_digits text;
begin
  if new.phone is distinct from old.phone then
    v_digits := regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g');

    /* No number at all, or no normalised form: nothing to disagree about. A
       number this system cannot parse is stored with a null E.164 on purpose. */
    if v_digits = '' or new.phone_e164 is null then
      return new;
    end if;

    if right(v_digits, 9) <> '' and
       regexp_replace(new.phone_e164, '[^0-9]', '', 'g') not like '%' || right(v_digits, 9) then
      raise exception
        using errcode = 'CRM96',
              message = 'The normalised phone number does not match the number being saved.',
              hint = 'Derive phone_e164 with toE164() from lib/domain/phone.ts in the same write.';
    end if;
  end if;
  return new;
end;
$fn$;

comment on function app.crm_leads_guard_phone_pair() is
  '201 · phone_e164 must follow phone in the same write. Compares digits; never parses.';

drop trigger if exists crm_leads_guard_phone_pair on public.crm_leads;
create trigger crm_leads_guard_phone_pair
  before update of phone, phone_e164 on public.crm_leads
  for each row execute function app.crm_leads_guard_phone_pair();

-- ============================================================================
-- SELF-CHECK — a salesperson corrects their own lead, and nobody else's
-- ============================================================================
do $chk$
declare
  v_project uuid; v_lead uuid; v_owner uuid; v_outsider uuid;
  v_name text; v_email text; v_phone text; v_e164 text; v_answers jsonb;
  n_stale int := -1; n_outsider int := -1; n_provenance int := -1;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select l.id, l.owner_id into v_lead, v_owner
    from public.crm_leads l
    join public.users u on u.id = l.owner_id and u.is_active and u.role = 'member'
   where l.project_id = v_project and l.is_test_data limit 1;

  /* ⚠️ A DIFFERENT DEPARTMENT, not just a different person: a colleague in sales
     can legitimately work this lead, so testing privacy against one proves
     nothing (185, and again in 200). */
  select u.id into v_outsider
    from public.users u join public.departments d on d.id = u.department_id
   where u.is_active and u.role = 'member' and d.key <> 'sales' and u.id <> v_owner
   limit 1;

  if v_lead is null then
    raise exception '201 · fixtures missing (project %, lead %)', v_project, v_lead;
  end if;
  if v_outsider is null then
    raise exception '201 · no member outside sales — the privacy half would prove nothing';
  end if;

  begin
    set local role cni_app;
    perform set_config('app.user_id', v_owner::text, true);

    /* 1 · The correction the owner asked for. */
    update public.crm_leads
       set full_name = 'SELFCHECK 201',
           phone = '0300 9999201',
           phone_e164 = '+923009999201',
           email = 'selfcheck-201@example.com',
           city = 'Peshawar',
           answers = coalesce(answers, '{}'::jsonb) || '{"interest":"5 Marla"}'::jsonb
     where id = v_lead;
    select full_name, email, phone, phone_e164, answers
      into v_name, v_email, v_phone, v_e164, v_answers
      from public.crm_leads where id = v_lead;

    /* 2 · …and a normalised number left pointing at the old handset is refused. */
    begin
      update public.crm_leads set phone = '0301 1111111' where id = v_lead;
      n_stale := 1;
    exception when sqlstate 'CRM96' then n_stale := 0;
    end;

    /* 3 · Where the lead came from is still not editable. */
    begin
      update public.crm_leads set external_id = 'SELFCHECK-201' where id = v_lead;
      n_provenance := 1;
    exception when insufficient_privilege then n_provenance := 0;
    end;
    reset role;

    /* 4 · And somebody in another department cannot touch it at all. */
    set local role cni_app;
    perform set_config('app.user_id', v_outsider::text, true);
    update public.crm_leads set full_name = 'SHOULD NOT HAPPEN' where id = v_lead;
    n_outsider := (select count(*)::int from public.crm_leads
                    where id = v_lead and full_name = 'SHOULD NOT HAPPEN');
    reset role;

    raise exception using errcode = 'P0201', message = '201 rollback';
  exception when sqlstate 'P0201' then
    null;
  end;

  if v_name is distinct from 'SELFCHECK 201' then
    raise exception '201 · a salesperson still cannot correct the name (got %)', v_name;
  end if;
  if v_email is distinct from 'selfcheck-201@example.com' then
    raise exception '201 · the email could not be corrected (got %)', v_email;
  end if;
  if v_e164 is distinct from '+923009999201' then
    raise exception '201 · the normalised number could not be written (got %)', v_e164;
  end if;
  if v_answers -> 'interest' is null then
    raise exception '201 · the qualifying answers could not be corrected';
  end if;
  if n_stale <> 0 then
    raise exception '201 · a stale phone_e164 was accepted — the WhatsApp link would point at the old number';
  end if;
  if n_provenance <> 0 then
    raise exception '201 · external_id is writable; a lead''s provenance must not be editable';
  end if;
  if n_outsider <> 0 then
    raise exception '201 · another department''s member edited this lead';
  end if;

  raise notice '201 ✓ name, phone, email, city and answers correctable by the owner; stale E.164, provenance and outsiders all refused';
end $chk$;
