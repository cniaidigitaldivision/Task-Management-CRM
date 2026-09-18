-- ============================================================================
-- 200 · THE TIMELINE TAKES WHAT THE APP WRITES — recording an outcome was failing
-- ----------------------------------------------------------------------------
-- 116 narrowed `crm_lead_activity_insert` to the five kinds that migration was
-- about — the contact attempts:
--
--   kind in ('call_attempted','call_connected','call_no_answer',
--            'whatsapp_sent','email_sent')
--
-- Everything written since has been outside that list, and each one fails with
-- 42501 **inside the transaction that does the real work**, so the whole action
-- rolls back:
--
--   stage_changed     `crmSetLeadStage` — RECORD OUTCOME. Every stage change the
--                     owner asked to be prompted for could not be saved.
--   next_action_set   `crmBookAppointment` — booking a site visit or a payment
--                     plan meeting.
--   note_added        `crmRaiseQuotation` — raising a quotation at all.
--
-- ⚠️ AND IT ONLY FAILS BELOW ADMIN, which is why it survived. An admin session
-- passes `app.acting_at_least('admin')` elsewhere and never meets this policy's
-- refusal; the owner's own account (Sarah, `member`, sales) does. Proved on
-- 2026-09-18 by inserting each kind as that member: the five pass, these three
-- are refused. `admin-sessions-cannot-test-access` in the notes, for the eighth
-- time.
--
-- Two different repairs, because the two cases are not the same:
--
--   `note_added` STAYS REFUSED. That kind belongs to
--   `app.crm_note_record_activity`, a definer trigger on `crm_lead_notes`, and
--   the invariant is worth keeping: an activity row saying "note added" has a
--   note behind it. `crmRaiseQuotation` and the PDF intake now write the note
--   and let the trigger write the row.
--
--   `stage_changed` AND `next_action_set` ARE THE PERSON'S OWN ACTS and carry no
--   such invariant. They join the list, under the same two conditions as the
--   rest: the lead must be one this session can see, and the actor must be this
--   session. A salesperson still cannot log an event on somebody else's lead,
--   and still cannot log one under a colleague's name.
--
-- ⚠️ NOTHING BECOMES EDITABLE. There is still no UPDATE and no DELETE policy on
-- this table for any rank — 111's rule, and the reason the log is evidence.
-- ============================================================================

drop policy if exists crm_lead_activity_insert on public.crm_lead_activity;
create policy crm_lead_activity_insert on public.crm_lead_activity
  for insert to cni_app
  with check (
    exists (select 1 from public.crm_leads l where l.id = crm_lead_activity.lead_id)
    and kind in ('call_attempted', 'call_connected', 'call_no_answer',
                 'whatsapp_sent', 'email_sent',
                 /* 200 — the acts a person performs on their own lead. */
                 'stage_changed', 'next_action_set')
    /* The actor is the caller or nobody — a session cannot log an event under a
       colleague's name. */
    and (actor_id is null or actor_id = app.current_user_id())
  );

-- ============================================================================
-- SELF-CHECK — the three cases, as the three different answers they should be
-- ============================================================================
do $chk$
declare
  v_lead uuid; v_owner uuid; v_outsider uuid; v_project uuid;
  n_stage int := -1; n_action int := -1; n_note int := -1;
  n_other_name int := -1; n_other_lead int := -1;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select l.id, l.owner_id into v_lead, v_owner
    from public.crm_leads l
    join public.users u on u.id = l.owner_id and u.is_active and u.role = 'member'
   where l.project_id = v_project and l.is_test_data limit 1;

  /* ⚠️ A DIFFERENT DEPARTMENT, NOT JUST A DIFFERENT PERSON. A colleague in sales
     can legitimately see this lead, so testing privacy against one proves
     nothing — 185 learnt this the hard way. */
  select u.id into v_outsider
    from public.users u
    join public.departments d on d.id = u.department_id
   where u.is_active and u.role = 'member' and d.key <> 'sales'
     and u.id <> v_owner
   limit 1;

  if v_lead is null then
    raise exception '200 · fixtures missing (project %, lead %)', v_project, v_lead;
  end if;

  begin
    set local role cni_app;
    perform set_config('app.user_id', v_owner::text, true);

    /* 1 · Record outcome. */
    begin
      insert into public.crm_lead_activity (lead_id, actor_id, kind, occurred_at, detail)
      values (v_lead, v_owner, 'stage_changed', now(), '{"selfcheck":200}'::jsonb);
      n_stage := 1;
    exception when sqlstate '42501' then n_stage := 0;
    end;

    /* 2 · Booking an appointment. */
    begin
      insert into public.crm_lead_activity (lead_id, actor_id, kind, occurred_at, detail)
      values (v_lead, v_owner, 'next_action_set', now(), '{"selfcheck":200}'::jsonb);
      n_action := 1;
    exception when sqlstate '42501' then n_action := 0;
    end;

    /* 3 · And "note added" is still the trigger's alone. */
    begin
      insert into public.crm_lead_activity (lead_id, actor_id, kind, occurred_at, detail)
      values (v_lead, v_owner, 'note_added', now(), '{"selfcheck":200}'::jsonb);
      n_note := 1;
    exception when sqlstate '42501' then n_note := 0;
    end;

    /* 4 · Nor under somebody else's name. */
    if v_outsider is not null then
      begin
        insert into public.crm_lead_activity (lead_id, actor_id, kind, occurred_at, detail)
        values (v_lead, v_outsider, 'stage_changed', now(), '{"selfcheck":200}'::jsonb);
        n_other_name := 1;
      exception when sqlstate '42501' then n_other_name := 0;
      end;
    end if;
    reset role;

    /* 5 · Nor on a lead this person cannot see at all. */
    if v_outsider is not null then
      set local role cni_app;
      perform set_config('app.user_id', v_outsider::text, true);
      begin
        insert into public.crm_lead_activity (lead_id, actor_id, kind, occurred_at, detail)
        values (v_lead, v_outsider, 'stage_changed', now(), '{"selfcheck":200}'::jsonb);
        n_other_lead := 1;
      exception when sqlstate '42501' then n_other_lead := 0;
      end;
      reset role;
    end if;

    raise exception using errcode = 'P0200', message = '200 rollback';
  exception when sqlstate 'P0200' then
    null;
  end;

  if n_stage <> 1 then
    raise exception '200 · a salesperson still cannot record an outcome';
  end if;
  if n_action <> 1 then
    raise exception '200 · a salesperson still cannot book an appointment';
  end if;
  if n_note <> 0 then
    raise exception '200 · note_added can be written directly — the trigger no longer owns it';
  end if;
  if v_outsider is null then
    raise exception '200 · no member outside sales to test privacy with — the check would have proved nothing';
  end if;
  if n_other_name <> 0 then
    raise exception '200 · an event could be logged under a colleague''s name';
  end if;
  if n_other_lead <> 0 then
    raise exception '200 · an outsider could log an event on this lead';
  end if;

  raise notice '200 ✓ outcome and appointment write; note_added, a colleague''s name and another team''s lead all refused';
end $chk$;
