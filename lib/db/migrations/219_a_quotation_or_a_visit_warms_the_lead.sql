-- ============================================================================
-- 219 · A QUOTATION OR A BOOKED VISIT WARMS THE LEAD, AND CONFIRMS ITSELF
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-19: *"Even if I share quotations with them or I have booked a
-- visit, they put a temperature of normal. How could it be a normal lead? It
-- must be a hot lead, right?"* And: *"Once I have scheduled the appointment
-- successfully… 'your site visit is booked at this time on this day.' This
-- message should be sent automatically. Whether I have to go and type the
-- message to him — this is not the right way."*
--
-- ── ⚠️ TEMPERATURE ONLY EVER WARMS ─────────────────────────────────────────
-- The same rule the stage follows (209): automation may move a lead FORWARD and
-- never back. A salesperson who marked somebody cold and then sent them a
-- quotation has contradicted their own label by acting, so the action wins — but
-- nothing here ever cools a lead somebody called hot. Cooling is a judgement,
-- and the only evidence for it is silence, which the Nurture rule already owns.
--
-- ── ⚠️ AND THE CONFIRMATION IS A FOLLOW-UP ROW, NOT A DIRECT SEND ──────────
-- Every WhatsApp rule already lives in the sender: the 24-hour window, the claim
-- guard against double-sending, writing the message into the lead's thread, the
-- consent check. A direct API call from a booking trigger would be a second
-- place for all of that to be got wrong — and the first one to be forgotten.
--
-- ⚠️ SO WHEN THE WINDOW IS SHUT IT BECOMES THE SALESPERSON'S TO SEND, not a
-- silent failure. `crm_followups_to_send` refuses a WhatsApp row with no open
-- window and no template, so an `auto_send` row booked at midnight would sit
-- there for ever looking scheduled. `review_first` puts it in front of a person
-- instead, which is the honest outcome until an appointment template exists.
-- ============================================================================

-- ── 1 · Warming, in one place ───────────────────────────────────────────────
create or replace function app.crm_warm_lead(p_lead uuid, p_to text, p_why text)
returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_rank constant jsonb := '{"cold": 1, "warm": 2, "hot": 3}'::jsonb;
  v_now  text;
  v_n    integer;
begin
  select temperature::text into v_now from public.crm_leads where id = p_lead;

  /* ⚠️ NULL IS COLDER THAN COLD, not equal to it. A lead nobody has judged must
     be warmable; treating null as "already there" would leave every automatic
     lead at no temperature for ever. */
  if v_now is not null
     and coalesce((v_rank ->> v_now)::int, 0) >= coalesce((v_rank ->> p_to)::int, 0) then
    return false;
  end if;

  /* The timeline entry is 116's trigger's, on the column change. */
  update public.crm_leads
     set temperature = p_to::public.crm_temperature
   where id = p_lead;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$fn$;

grant execute on function app.crm_warm_lead(uuid, text, text) to cni_app;


-- ── 2 · A quotation reaching `sent` ─────────────────────────────────────────
create or replace function app.crm_quotation_warms_lead()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
begin
  perform app.crm_warm_lead(new.lead_id, 'hot', 'a quotation was sent');
  return null;
end;
$fn$;

drop trigger if exists crm_quotations_warm_lead on public.crm_quotations;
create trigger crm_quotations_warm_lead
  after insert or update of status on public.crm_quotations
  for each row when (new.status = 'sent')
  execute function app.crm_quotation_warms_lead();


-- ── 3 · An appointment booked: warm the lead, and confirm it to the client ──
create or replace function app.crm_appointment_booked()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_lead   record;
  v_when   text;
  v_what   text;
  v_body   text;
  v_mode   public.crm_followup_mode;
  v_title  text;
  v_moved  boolean;
begin
  /* Only a live booking in the future. A visit recorded after the fact, or one
     being cancelled, must not send a confirmation. */
  if new.status not in ('scheduled', 'confirmed') or new.scheduled_at <= now() then
    return null;
  end if;

  v_moved := tg_op = 'INSERT'
    or old.scheduled_at is distinct from new.scheduled_at
    or old.status is distinct from new.status;
  if not v_moved then
    return null;
  end if;

  perform app.crm_warm_lead(new.lead_id, 'hot', 'a visit was booked');

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

  /* ⚠️ KARACHI, WRITTEN OUT. "2026-09-22T05:00:00Z" on a client's phone is not a
     confirmation, it is a database row. */
  v_when := to_char(new.scheduled_at at time zone 'Asia/Karachi', 'FMDay FMDD FMMonth') ||
            ' at ' || to_char(new.scheduled_at at time zone 'Asia/Karachi', 'FMHH12:MI AM');

  v_what := case new.kind::text
              when 'site_visit' then 'site visit'
              when 'meeting'    then 'meeting'
              when 'call'       then 'call'
              else 'appointment'
            end;

  v_title := (case when tg_op = 'INSERT' then 'Confirm the ' else 'Confirm the new ' end) || v_what || ' time';

  v_body := 'Assalam-o-Alaikum' ||
            coalesce(' ' || nullif(split_part(btrim(v_lead.full_name), ' ', 1), ''), '') || ', ' ||
            case when tg_op = 'INSERT'
                 then 'your ' || v_what || ' with ' || v_lead.business || ' is booked for '
                 else 'your ' || v_what || ' with ' || v_lead.business || ' has been moved to '
            end ||
            v_when ||
            coalesce('. Location: ' || nullif(btrim(new.location), ''), '') ||
            '. Please let us know if you need a different time.';

  /* ⚠️ THE WINDOW DECIDES WHO SENDS IT — see this migration's header. */
  v_mode := case when app.crm_window_is_open(new.lead_id)
                 then 'auto_send'::public.crm_followup_mode
                 else 'review_first'::public.crm_followup_mode
            end;

  /* ⚠️ ONE CONFIRMATION PER BOOKING, PER TIME. A row still waiting to go out for
     this appointment is replaced rather than joined — a client who was told
     Sunday and then Monday must not receive both. */
  update public.crm_follow_ups
     set status = 'cancelled',
         outcome_note = 'Superseded — the appointment time changed.'
   where lead_id = new.lead_id
     and purpose = 'appointment_reminder'
     and status in ('planned', 'due')
     and title like 'Confirm the %';

  insert into public.crm_follow_ups
    (lead_id, purpose, channel, mode, status, title, body, due_at,
     assigned_to_id, created_by_id)
  values (new.lead_id, 'appointment_reminder', 'whatsapp', v_mode, 'due',
          v_title, v_body, now(), v_lead.owner_id, v_lead.owner_id);

  return null;
end;
$fn$;

drop trigger if exists crm_appointments_confirm on public.crm_appointments;
create trigger crm_appointments_confirm
  after insert or update of scheduled_at, status on public.crm_appointments
  for each row execute function app.crm_appointment_booked();


-- ── 4 · Moving an appointment ───────────────────────────────────────────────
-- ⚠️ ITS OWN FUNCTION RATHER THAN A BARE UPDATE, because three things have to
-- happen together: the row moves, the client is told (trigger 3), and the reason
-- is kept. A screen that wrote the column directly would do the first only.
create or replace function app.crm_reschedule_appointment(
  p_appointment uuid,
  p_at          timestamptz,
  p_minutes     integer default null,
  p_location    text default null,
  p_note        text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_lead uuid;
  v_n    integer;
begin
  select lead_id into v_lead from public.crm_appointments where id = p_appointment;
  if v_lead is null or not app.crm_lead_is_visible(v_lead) then
    return false;
  end if;

  update public.crm_appointments
     set scheduled_at = p_at,
         duration_minutes = coalesce(p_minutes, duration_minutes),
         location = coalesce(nullif(btrim(coalesce(p_location, '')), ''), location),
         /* ⚠️ APPENDED, NEVER REPLACED. Why a visit moved is the history a
            salesperson needs when a client says it was moved twice. */
         notes = btrim(coalesce(notes || E'\n', '') ||
                 to_char(now() at time zone 'Asia/Karachi', 'FMDD FMMon FMHH12:MI AM') ||
                 ' — moved' || coalesce(': ' || nullif(btrim(coalesce(p_note, '')), ''), '')),
         /* A moved appointment is live again, whatever it was before. */
         status = case when status in ('cancelled', 'no_show') then 'scheduled'::public.crm_appointment_status
                       else status end,
         updated_at = now()
   where id = p_appointment;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$fn$;

grant execute on function app.crm_reschedule_appointment(uuid, timestamptz, integer, text, text) to cni_app;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid;
  v_q uuid; v_a uuid; v_hot uuid; v_appt uuid;
  t_q text; t_a text; t_hot text;
  n_msg int; v_body text; v_mode text; n_after_move int; v_moved_body text;
  moved boolean;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '219 · fixtures missing';
  end if;

  begin
    perform set_config('app.user_id', v_owner::text, true);

    /* 1 · A quotation sent warms a lead nobody has judged. */
    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-219 quote', '+923000000219', '+923000000219', 'contacted', now(), v_owner, true)
    returning id into v_q;
    insert into public.crm_quotations
      (lead_id, project_id, number, version, status, base_price, net_amount, prepared_by_id, is_test_data)
    values (v_q, v_project, 'SELFCHECK-219', 1, 'sent', 1000, 1000, v_owner, true);
    select temperature::text into t_q from public.crm_leads where id = v_q;

    /* 2 · A booked visit warms, and writes one confirmation carrying the time. */
    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-219 visit', '+923000000220', '+923000000220', 'contacted', now(), v_owner, true)
    returning id into v_a;
    insert into public.crm_appointments
      (lead_id, project_id, kind, status, scheduled_at, duration_minutes, location, owner_id, created_by_id, is_test_data)
    values (v_a, v_project, 'site_visit', 'scheduled', now() + interval '3 days', 60, 'Site office', v_owner, v_owner, true)
    returning id into v_appt;
    select temperature::text into t_a from public.crm_leads where id = v_a;
    select count(*)::int into n_msg from public.crm_follow_ups
     where lead_id = v_a and purpose = 'appointment_reminder' and status in ('planned','due');
    select body, mode::text into v_body, v_mode from public.crm_follow_ups
     where lead_id = v_a and purpose = 'appointment_reminder' and status in ('planned','due') limit 1;

    /* 3 · ⚠️ HOT IS NEVER COOLED by a later quotation. */
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data, temperature)
    values (v_project, 'manual', 'SELFCHECK-219 hot', 'contacted', now(), v_owner, true, 'hot')
    returning id into v_hot;
    perform app.crm_warm_lead(v_hot, 'warm', 'test');
    select temperature::text into t_hot from public.crm_leads where id = v_hot;

    /* 4 · Moving it replaces the confirmation rather than adding a second. */
    perform app.crm_reschedule_appointment(v_appt, now() + interval '5 days', null, null, 'client asked');
    select count(*)::int into n_after_move from public.crm_follow_ups
     where lead_id = v_a and purpose = 'appointment_reminder' and status in ('planned','due');
    select body into v_moved_body from public.crm_follow_ups
     where lead_id = v_a and purpose = 'appointment_reminder' and status in ('planned','due') limit 1;

    raise exception using errcode = 'P0219', message = '219 rollback';
  exception when sqlstate 'P0219' then
    null;
  end;

  if t_q is distinct from 'hot' then
    raise exception '219 · a sent quotation did not warm the lead (got %)', t_q;
  end if;
  if t_a is distinct from 'hot' then
    raise exception '219 · a booked visit did not warm the lead (got %)', t_a;
  end if;
  if t_hot is distinct from 'hot' then
    raise exception '219 · a hot lead was COOLED to % — automation must only warm', t_hot;
  end if;
  if n_msg <> 1 then
    raise exception '219 · the booking wrote % confirmations, expected 1', n_msg;
  end if;
  if v_body not like '%site visit%' or v_body !~ '[0-9]{1,2}:[0-9]{2}' then
    raise exception '219 · the confirmation does not carry what and when: %', v_body;
  end if;
  if v_mode not in ('auto_send', 'review_first') then
    raise exception '219 · unexpected send mode %', v_mode;
  end if;
  if n_after_move <> 1 then
    raise exception '219 · moving the appointment left % confirmations, expected 1', n_after_move;
  end if;
  if v_moved_body not like '%has been moved to%' then
    raise exception '219 · the second confirmation does not say it moved: %', v_moved_body;
  end if;

  raise notice '219 · a quotation or a visit warms the lead, and the client is told once';
end $chk$;
