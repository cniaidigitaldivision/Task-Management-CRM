-- ============================================================================
-- 202 · A PLANNED FOLLOW-UP COMES DUE — nothing was ever moving it
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-18: *"I have set a follow-up that will auto-send. Please check
-- whether it will go at the set time or not."*
--
-- It would not have. `createFollowUp` writes
--
--   status = case when due_at <= now() then 'due' else 'planned' end
--
-- so anything scheduled for later is born `planned` — and **nothing in this
-- database or in the application ever changes it.** There is no job, no trigger
-- and no function that moves a follow-up from `planned` to `due`; searching every
-- function body in `app` and `public` for the word returns nothing.
--
-- Both readers require `due`:
--
--   `app.crm_followups_to_send`  — the sender's queue. So it never sends.
--   `crmMyTodos`                 — the salesperson's own list. So it never shows.
--
-- ⚠️ SO A SINGLE FOLLOW-UP SET FOR A FUTURE TIME WAS INVISIBLE, FOR EVER. It sat
-- in the drawer's Follow-ups tab looking scheduled, and its moment passed without
-- anything happening — the worst shape a reminder can take, because the person
-- stopped holding the job themselves on the strength of it.
--
-- ⚠️ SEQUENCES WERE NEVER AFFECTED, which is why this survived. The sequence
-- advancer (187) materialises each step with `'due'` and `due_at = now()` at the
-- moment it falls, so a scheduled PLAN worked perfectly while a single follow-up
-- did not. Every test of the scheduler exercised the path that worked.
--
-- ── THE FIX: THE READERS ASK THE CLOCK, NOT THE COLUMN ──────────────────────
-- Rather than adding an eighth cron job whose only purpose is to rewrite a column
-- to match `now()`, both readers accept a `planned` row whose time has come. The
-- status column stops being a second, slower copy of a fact `due_at` already
-- holds — and there is no window in which a job has not run yet.
-- ============================================================================

create or replace function app.crm_followups_to_send(p_limit integer default 25)
returns table (
  follow_up_id uuid, lead_id uuid, project_id uuid, lead_sequence_id uuid, owner_id uuid,
  channel text, title text, body text, subject text, lead_name text, to_phone text, to_email text,
  template_name text, template_language text, document_ids uuid[], window_open boolean,
  wa_phone_number_id text, sender_name text, project_name text
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select f.id, f.lead_id, l.project_id, f.lead_sequence_id, f.assigned_to_id,
         f.channel::text, f.title, f.body, st.subject,
         l.full_name, l.phone_e164, l.email,
         nullif(st.wa_template_name, ''), coalesce(nullif(st.wa_template_language, ''), 'en'),
         st.document_ids,
         app.crm_window_is_open(f.lead_id),
         p.whatsapp_phone_number_id,
         coalesce(nullif(trim(s.whatsapp_display_name), ''), p.name),
         p.name
    from public.crm_follow_ups f
    join public.crm_leads l on l.id = f.lead_id
    join public.projects p on p.id = l.project_id
    left join public.crm_project_settings s on s.project_id = p.id
    left join public.crm_lead_sequences ls on ls.id = f.lead_sequence_id
    left join public.crm_sequence_steps st
           on st.sequence_id = ls.sequence_id and st.step_no = f.sequence_step_no
   /* ⚠️ 202: a planned row whose moment has come is due. Nothing was moving it. */
   where f.status in ('planned', 'due')
     and f.mode = 'auto_send'
     and f.due_at <= now()
     and l.stage not in ('won', 'lost')
     /* Every stop-condition, asked again at the moment of sending. */
     and (f.lead_sequence_id is null or app.crm_sequence_stop_reason(f.lead_sequence_id) is null)
     and (
       (f.channel = 'whatsapp'
        and l.phone_e164 is not null
        and p.whatsapp_phone_number_id is not null
        /* ⚠️ A STATED NO STOPS IT. NULL means nobody has ever asked, which is
           where every lead in this database stands — see 192. */
        and l.whatsapp_consent is distinct from false
        /* ⚠️ AND WHATSAPP'S OWN RULE, WHICH IS NOT OURS TO RELAX: free text only
           inside the 24-hour window; outside it, only an approved template. */
        and (app.crm_window_is_open(f.lead_id) or nullif(st.wa_template_name, '') is not null))
       or (f.channel = 'email' and l.email is not null)
     )
   order by f.due_at
   limit greatest(1, least(p_limit, 100))
$fn$;

comment on function app.crm_followups_to_send(integer) is
  'What the sender should send now. 187, widened in 202 to include a planned row whose due_at has passed.';

-- ============================================================================
-- SELF-CHECK — a follow-up planned for the past is sendable; the future is not
-- ============================================================================
do $chk$
declare
  v_project uuid; v_lead uuid; v_owner uuid; v_id uuid;
  n_past int := -1; n_future int := -1; n_manual int := -1;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.whatsapp_phone_number_id is not null limit 1;

  /* ⚠️ A LEAD WHOSE WINDOW IS OPEN, or the queue would refuse it for a reason
     that has nothing to do with what this migration changed — and the check would
     pass while proving nothing (`self-checks-that-skip-silently`). */
  select l.id, l.owner_id into v_lead, v_owner
    from public.crm_leads l
   where l.project_id = v_project
     and l.phone_e164 is not null
     and l.whatsapp_consent is distinct from false
     and l.stage not in ('won', 'lost')
     and app.crm_window_is_open(l.id)
   limit 1;

  if v_lead is null then
    raise exception '202 · no lead with an open 24-hour window — the check could not prove the queue';
  end if;

  begin
    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at, assigned_to_id, created_by_id)
    values (v_lead, 'no_response', 'whatsapp', 'auto_send', 'planned',
            'SELFCHECK-202', 'body', now() - interval '1 minute', v_owner, v_owner)
    returning id into v_id;
    select count(*)::int into n_past from app.crm_followups_to_send(100) q where q.follow_up_id = v_id;

    /* Not yet its moment: still nothing to send. */
    update public.crm_follow_ups set due_at = now() + interval '1 hour' where id = v_id;
    select count(*)::int into n_future from app.crm_followups_to_send(100) q where q.follow_up_id = v_id;

    /* And a reminder is still a person's job, however overdue. */
    update public.crm_follow_ups
       set due_at = now() - interval '1 minute', mode = 'remind_me' where id = v_id;
    select count(*)::int into n_manual from app.crm_followups_to_send(100) q where q.follow_up_id = v_id;

    raise exception using errcode = 'P0202', message = '202 rollback';
  exception when sqlstate 'P0202' then
    null;
  end;

  if n_past <> 1 then
    raise exception '202 · a planned auto-send whose time has come is still not in the sender queue';
  end if;
  if n_future <> 0 then
    raise exception '202 · a follow-up due in an hour was offered to the sender now';
  end if;
  if n_manual <> 0 then
    raise exception '202 · a remind_me follow-up was offered to the sender';
  end if;

  raise notice '202 ✓ planned + overdue + auto_send is sendable; future and remind_me are not';
end $chk$;
