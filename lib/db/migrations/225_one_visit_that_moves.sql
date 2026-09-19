-- ============================================================================
-- 225 · ONE VISIT THAT MOVES, NOT TWO VISITS
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-19, holding a screenshot of Appointments (2) where there is one
-- site visit:
--
--   *"These are not two separate visits. It's one visit: first I schedule it,
--   then the client says that this time is not feasible, and then I change its
--   time… It creates two site visits for me in the appointment so it shouldn't
--   be like that."*
--
-- They are right, and the cause is that this codebase had **two** rescheduling
-- implementations that disagreed:
--
--   · `app.crm_reschedule_appointment` (219)  — moves the row. One visit.
--   · `rescheduleAppointment` (crm-related.ts) — marks the old row `rescheduled`
--     and INSERTS a new one pointing back with `replaces_id`. Two rows.
--
-- The dialog's Reschedule button called the second. A `replaces_id` chain is a
-- reasonable audit design and a bad fit for the thing a salesperson looks at:
-- the screen answers "when am I seeing this client", and that has exactly one
-- answer. The move is now recorded in the row's own notes and in the timeline,
-- which is where the history belongs.
--
-- ── ⚠️ AND A MOVED VISIT IS NO LONGER A CONFIRMED VISIT ────────────────────
-- 222 lets a client tap **Confirm**. If a confirmed visit is then moved, the
-- client has agreed to a time that no longer exists — keeping `confirmed` would
-- show a tick against a time nobody agreed to, and 220 re-sends the
-- confirmation for the new time anyway. Any move returns the row to `scheduled`
-- and waits for the client to confirm again.
-- ============================================================================

create or replace function app.crm_reschedule_appointment(
  p_appointment uuid,
  p_at          timestamptz,
  p_minutes     integer default null,
  p_location    text default null,
  p_note        text default null
) returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_lead uuid;
  v_old  timestamptz;
  v_stat text;
  v_n    integer;
begin
  select lead_id, scheduled_at, status::text
    into v_lead, v_old, v_stat
    from public.crm_appointments where id = p_appointment;

  if v_lead is null or not app.crm_lead_is_visible(v_lead) then
    return false;
  end if;

  /* ⚠️ A VISIT THAT ALREADY HAPPENED IS NOT MOVED, IT IS RECORDED. Moving a
     completed visit would erase the fact that it took place. */
  if v_stat = 'completed' then
    return false;
  end if;

  update public.crm_appointments
     set scheduled_at = p_at,
         duration_minutes = coalesce(p_minutes, duration_minutes),
         location = coalesce(nullif(btrim(coalesce(p_location, '')), ''), location),
         /* ⚠️ APPENDED, NEVER REPLACED. Why a visit moved is the history a
            salesperson needs when a client says it was moved twice — and with
            one row per visit, this note IS that history. It records the time it
            moved FROM, which the row no longer carries. */
         notes = btrim(coalesce(notes || E'\n', '') ||
                 to_char(now() at time zone 'Asia/Karachi', 'FMDD FMMon FMHH12:MI AM') ||
                 ' — moved from ' ||
                 to_char(v_old at time zone 'Asia/Karachi', 'FMDD FMMon, FMHH12:MI AM') ||
                 coalesce(': ' || nullif(btrim(coalesce(p_note, '')), ''), '')),
         /* ⚠️ BACK TO `scheduled`, ALWAYS — see this migration's header. A move
            un-confirms the visit, and a cancelled one comes back to life. */
         status = 'scheduled'::public.crm_appointment_status,
         updated_at = now()
   where id = p_appointment;

  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$fn$;


-- ── The rows that were already split in two ─────────────────────────────────
/*
 * ⚠️ NOTHING IS DELETED. A `rescheduled` row has a successor by construction —
 * that is the only way one was ever written — so it is history, not a visit. The
 * screens stop counting it (the query change ships with this migration), and the
 * row stays exactly where it is for anybody reading the record.
 *
 * What this DOES fix is the successor's missing history: the note that says
 * where it moved from, which the two-row path never wrote onto the new row.
 */
do $backfill$
declare
  r record;
  n integer := 0;
begin
  for r in
    select new_a.id,
           old_a.scheduled_at as was,
           new_a.notes        as notes
      from public.crm_appointments new_a
      join public.crm_appointments old_a on old_a.id = new_a.replaces_id
     where old_a.status = 'rescheduled'
       and coalesce(new_a.notes, '') not like '%moved from%'
  loop
    update public.crm_appointments
       set notes = btrim(coalesce(r.notes || E'\n', '') ||
                   'Moved from ' ||
                   to_char(r.was at time zone 'Asia/Karachi', 'FMDD FMMon, FMHH12:MI AM') || '.')
     where id = r.id;
    n := n + 1;
  end loop;
  raise notice '225 · % moved visit(s) gained the time they moved from', n;
end $backfill$;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid; v_lead uuid; v_appt uuid;
  v_ok boolean; v_done boolean;
  n_rows int; s_after text; t_after timestamptz; notes_after text;
  v_when timestamptz := date_trunc('hour', now()) + interval '3 days';
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '225 · fixtures missing';
  end if;

  begin
    perform set_config('app.user_id', v_owner::text, true);

    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-225', '+923000000225', '+923000000225', 'contacted', now(), v_owner, true)
    returning id into v_lead;

    /* A visit the client has already confirmed. */
    insert into public.crm_appointments
      (lead_id, project_id, kind, status, scheduled_at, duration_minutes, location, owner_id, created_by_id, is_test_data)
    values (v_lead, v_project, 'site_visit', 'confirmed', v_when, 60, 'Site office', v_owner, v_owner, true)
    returning id into v_appt;

    select app.crm_reschedule_appointment(v_appt, v_when + interval '2 hours', null, null, 'client asked for later') into v_ok;

    select count(*)::int into n_rows from public.crm_appointments where lead_id = v_lead;
    select status::text, scheduled_at, notes into s_after, t_after, notes_after
      from public.crm_appointments where id = v_appt;

    /* A visit that already happened is recorded, not moved.
       (`outcome_at` comes with it — a completed visit without one is refused by
       `crm_appointments_outcome_complete`, which this check ran into.) */
    update public.crm_appointments
       set status = 'completed', outcome_at = now(), outcome = 'they came'
     where id = v_appt;
    select app.crm_reschedule_appointment(v_appt, v_when + interval '5 hours') into v_done;

    raise exception using errcode = 'P0225', message = '225 rollback';
  exception when sqlstate 'P0225' then
    null;
  end;

  if not v_ok then
    raise exception '225 · the move was refused';
  end if;
  if n_rows <> 1 then
    raise exception '225 · rescheduling left % appointment rows, expected 1', n_rows;
  end if;
  if t_after is distinct from v_when + interval '2 hours' then
    raise exception '225 · the visit did not move to the new time';
  end if;
  if s_after is distinct from 'scheduled' then
    raise exception '225 · a moved visit kept status % — the client never agreed to the new time', s_after;
  end if;
  if notes_after not like '%moved from%' then
    raise exception '225 · the move did not record the time it moved from';
  end if;
  if v_done then
    raise exception '225 · a completed visit was moved, erasing that it happened';
  end if;

  raise notice '225 · one visit moves, un-confirms itself, and keeps where it moved from';
end $chk$;
