-- ============================================================================
-- 230 · EVERY FOLLOW-UP CARRIES ITS TEMPLATE, AND A PAYMENT IS ACKNOWLEDGED
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-21, all seventeen templates approved:
--
--   *"Please set every follow-up with its specific template. Make sure from now
--   on no other excuse will be given to me…"*
--
-- Three things, all using the types 229 added.
--
-- ── 1 · THE PLANS ALREADY SAVED ────────────────────────────────────────────
-- Read on 2026-09-21: two "No response" plans sent `quotation_follow_up` —
-- "regarding the quotation we shared with you" — to leads who had never been
-- sent one, and every other WhatsApp step but the greeting had no template at
-- all, so a quiet lead got nothing. Each step now carries the template its
-- purpose implies, with the token names that fill it (228).
--
-- ── 2 · THE FOLLOW-UPS ALREADY QUEUED ──────────────────────────────────────
-- Same, for a follow-up standing on its own. One made by a plan reads its
-- step's template, so fixing the step fixes it.
--
-- ⚠️ NOTHING IS SWITCHED TO SEND ITSELF. A step or follow-up a person set to
-- "You send it" stays that way; a template only matters to one that sends
-- itself. And nothing already overdue is fired a day late by this migration.
--
-- ── 3 · A PAYMENT IS ACKNOWLEDGED WHEN FINANCE RECORDS IT ─────────────────
-- `payment_received` needs three values — name, amount, business — so no person
-- sends it from the wizard; this trigger does, the way 220 sends appointment
-- confirmations.
--
-- ⚠️ ON EACH INCREASE, FOR THAT PAYMENT. Finance may record a booking's money
-- more than once (instalments), and `verified_at` is stamped only the first
-- time (`crm_bookings_guard_money`). So this watches `verified_amount` going UP
-- and thanks the client for the difference — the payment just made, not the
-- running total, which would read as though they had paid it all again.
-- ============================================================================

-- ── The one mapping, written once ───────────────────────────────────────────
/*
 * The same catalogue `lib/domain/crm-template-for-purpose.ts` matches by name
 * (docs/crm/18-WHATSAPP-TEMPLATES.md). Used here for the repair only; the
 * wizard keeps choosing through the TypeScript rule, which also refuses a
 * template Meta has not approved.
 */
create temporary table template_for_purpose (purpose text primary key, name text not null, vars text[]) on commit drop;
insert into template_for_purpose values
  ('no_response',         'lead_check_in',          array['lead_first_name', 'company']),
  ('re_engage',           'lead_re_engage',         array['lead_first_name', 'company']),
  ('missing_information', 'lead_details_request',   array['lead_first_name', 'company']),
  ('quotation',           'quotation_follow_up',    null),
  ('approved_offer',      'approved_offer',         array['lead_first_name', 'company']),
  ('payment_reminder',    'payment_reminder',       array['lead_first_name', 'company']),
  ('site_visit_checkin',  'after_visit_check_in',   array['lead_first_name', 'company']),
  ('proposal',            'proposal_follow_up',     array['lead_first_name', 'company']),
  ('negotiation',         'negotiation_follow_up',  array['lead_first_name', 'company']),
  ('agreement',           'agreement_ready',        array['lead_first_name', 'company']),
  ('welcome',             'welcome_onboard',        array['lead_first_name', 'company']),
  ('meeting_feedback',    'meeting_feedback',       array['lead_first_name', 'company']),
  ('custom',              'update_available',       array['lead_first_name', 'company']);


-- ── 1 · The saved plans ─────────────────────────────────────────────────────
do $steps$
declare
  n integer;
begin
  update public.crm_sequence_steps st
     set wa_template_name = m.name,
         wa_template_language = 'en_GB',
         wa_template_vars = m.vars
    from template_for_purpose m
   where st.channel = 'whatsapp'
     and st.purpose = m.purpose
     and (
       st.wa_template_name is null
       /* ⚠️ THE WRONG ONE, REPLACED: a quotation message to a lead with none. */
       or (st.purpose in ('no_response', 're_engage') and st.wa_template_name = 'quotation_follow_up')
     );
  get diagnostics n = row_count;
  raise notice '230 · % saved plan step(s) now carry their template', n;
end $steps$;


-- ── 2 · The follow-ups already queued ───────────────────────────────────────
do $queued$
declare
  n integer;
begin
  update public.crm_follow_ups f
     set wa_template_name = m.name,
         wa_template_language = 'en_GB',
         wa_template_vars = m.vars,
         updated_at = now()
    from template_for_purpose m
   where f.channel = 'whatsapp'
     and f.status in ('planned', 'due')
     and f.lead_sequence_id is null
     and f.wa_template_name is null
     and f.wa_template_values is null
     and f.purpose::text = m.purpose;
  get diagnostics n = row_count;
  raise notice '230 · % queued follow-up(s) now carry their template', n;
end $queued$;


-- ── 3 · A payment is acknowledged ───────────────────────────────────────────
create or replace function app.crm_booking_payment_received()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_lead     record;
  v_first    text;
  v_paid     numeric := new.verified_amount - coalesce(old.verified_amount, 0);
  v_currency text;
  v_amount   text;
begin
  if v_paid <= 0 or new.is_test_data then
    return null;
  end if;

  select l.full_name, l.phone_e164, l.owner_id, l.whatsapp_consent,
         coalesce(nullif(btrim(s.whatsapp_display_name), ''), p.name) as business
    into v_lead
    from public.crm_leads l
    join public.projects p on p.id = l.project_id
    left join public.crm_project_settings s on s.project_id = p.id
   where l.id = new.lead_id;

  if v_lead.phone_e164 is null or v_lead.whatsapp_consent is false then
    return null;
  end if;

  v_first := coalesce(app.crm_first_name(v_lead.full_name), 'Sir/Madam');
  v_currency := coalesce(
    (select nullif(btrim(q.currency), '') from public.crm_quotations q where q.id = new.quotation_id),
    'PKR');
  /* "PKR 50,000" — the grouping a person writes, and no decimals on whole rupees. */
  v_amount := v_currency || ' ' ||
              case when v_paid = trunc(v_paid)
                   then to_char(v_paid, 'FM999,999,999,990')
                   else to_char(v_paid, 'FM999,999,999,990.00') end;

  insert into public.crm_follow_ups
    (lead_id, purpose, channel, mode, status, title, body, due_at,
     assigned_to_id, created_by_id,
     wa_template_name, wa_template_language, wa_template_values)
  values (new.lead_id, 'payment_received', 'whatsapp', 'auto_send', 'due',
          'Confirm the payment was received',
          'Assalam-o-Alaikum ' || v_first || ', thank you for your payment of ' || v_amount ||
            ' to ' || v_lead.business || '. It has been received and recorded on your account.',
          now(), v_lead.owner_id, coalesce(new.verified_by_id, v_lead.owner_id),
          'payment_received', 'en_GB', array[v_first, v_amount, v_lead.business]);

  return null;
end;
$fn$;

drop trigger if exists crm_bookings_payment_received on public.crm_bookings;
create trigger crm_bookings_payment_received
  after update of verified_amount on public.crm_bookings
  for each row
  when (new.verified_amount > old.verified_amount)
  execute function app.crm_booking_payment_received();


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid; v_admin uuid; v_lead uuid; v_booking uuid;
  n_first int; n_second int; v_values text[]; v_tpl text;
  n_wrong int; n_bare int;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' and p.whatsapp_phone_number_id is not null limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  select u.id into v_admin
    from public.users u where u.is_active and u.role in ('admin', 'super_admin') limit 1;
  if v_project is null or v_owner is null or v_admin is null then
    raise exception '230 · fixtures missing';
  end if;

  /* The repair left nothing behind. */
  select count(*)::int into n_wrong from public.crm_sequence_steps
   where channel = 'whatsapp' and purpose in ('no_response', 're_engage')
     and wa_template_name = 'quotation_follow_up';
  select count(*)::int into n_bare from public.crm_sequence_steps
   where channel = 'whatsapp' and wa_template_name is null
     and purpose in (select purpose from template_for_purpose);

  begin
    /* ⚠️ AS FINANCE. crm_bookings_guard_money refuses a verified amount from
       anybody else — the trigger has to be proved on the path that can happen. */
    perform set_config('app.user_id', v_admin::text, true);

    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK Payment Person', '+923000000230', '+923000000230', 'contacted', now(), v_owner, false)
    returning id into v_lead;

    insert into public.crm_bookings (lead_id, project_id, amount, is_test_data)
    values (v_lead, v_project, 150000, false)
    returning id into v_booking;

    /* First instalment. */
    update public.crm_bookings set verified_amount = 50000 where id = v_booking;
    select count(*)::int, max(wa_template_name)
      into n_first, v_tpl
      from public.crm_follow_ups where lead_id = v_lead and purpose = 'payment_received';
    /* ⚠️ READ ON ITS OWN. (array_agg(an_array))[1] is a 2-D array indexed once,
       which is NULL — this check's first run reported "wrong values: NULL" for
       an acknowledgement that was perfectly right. */
    select wa_template_values into v_values
      from public.crm_follow_ups where lead_id = v_lead and purpose = 'payment_received' limit 1;

    /* Second instalment — thanked for THAT payment, not the total. */
    update public.crm_bookings set verified_amount = 80000 where id = v_booking;
    select count(*)::int into n_second
      from public.crm_follow_ups
     where lead_id = v_lead and purpose = 'payment_received' and wa_template_values[2] = 'PKR 30,000';

    raise exception using errcode = 'P0230', message = '230 rollback';
  exception when sqlstate 'P0230' then
    null;
  end;

  if n_wrong <> 0 then
    raise exception '230 · % plan step(s) still send the quotation message to a silent lead', n_wrong;
  end if;
  if n_bare <> 0 then
    raise exception '230 · % WhatsApp plan step(s) still have no template', n_bare;
  end if;
  if n_first <> 1 or v_tpl is distinct from 'payment_received' then
    raise exception '230 · a verified payment did not queue its acknowledgement (% rows, template %)', n_first, v_tpl;
  end if;
  if v_values is distinct from array['SELFCHECK', 'PKR 50,000', v_values[3]] or v_values[3] is null then
    raise exception '230 · the acknowledgement carried the wrong values: %', v_values;
  end if;
  if n_second <> 1 then
    raise exception '230 · a second instalment was not thanked for its own amount';
  end if;

  raise notice '230 · every plan step carries its template, and each payment finance records is acknowledged';
end $chk$;
