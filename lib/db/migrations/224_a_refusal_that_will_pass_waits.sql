-- ============================================================================
-- 224 · A REFUSAL THAT WILL PASS LATER SHOULD WAIT, NOT DIE
-- ----------------------------------------------------------------------------
-- The owner has just edited `appointment_confirmed` to add the Confirm button.
-- Editing an approved template sends it back to **PENDING**, and Meta refuses a
-- send on a PENDING template with error **132001**.
--
-- `crm_followup_sent` settles every refusal the same way:
--
--     status = case when p_error is null then 'done' else 'failed' end
--
-- `failed` is terminal. Nothing retries it. So a visit booked in the next few
-- hours — while the client's 24-hour window happens to be closed, which is the
-- only case that needs a template — would have its confirmation refused once and
-- then **never sent, even after the template is approved**. Silently: the client
-- waits for a confirmation that is sitting in the database marked failed.
--
-- ── ⚠️ THE DISTINCTION THIS ADDS ───────────────────────────────────────────
-- "This will never work" and "this will work in an hour" are different answers
-- and were being recorded identically:
--
--   never  · the lead has no phone · the template needs a name nobody filled in
--   later  · the template is pending approval · paused · a rate limit · Meta down
--
-- The first is a person's job to fix. The second fixes itself, and the only
-- correct response is to try again. This is not about the button — a rate limit
-- on a busy morning had exactly the same permanent consequence.
--
-- ⚠️ BUT IT GIVES UP HONESTLY. A retry with no ceiling is how a queue starts
-- sending a week-old "your visit is tomorrow". Eight attempts or six hours,
-- whichever comes first, and then it fails for real with the reason kept.
-- ============================================================================

alter table public.crm_follow_ups
  add column if not exists attempts integer not null default 0,
  add column if not exists first_attempt_at timestamptz;

comment on column public.crm_follow_ups.attempts is
  'How many times sending has been tried. Only a RECOVERABLE refusal increments it — see app.crm_followup_defer.';


create or replace function app.crm_followup_defer(
  p_follow_up uuid,
  p_reason    text,
  p_minutes   integer default 10
) returns text
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_first timestamptz;
  v_tries integer;
  v_wait  integer := greatest(1, least(180, coalesce(p_minutes, 10)));
begin
  /* ⚠️ THE SAME QUESTION THE QUEUE ASKED, exactly as `crm_followup_sent` asks
     it — so a row that was offered can always be settled, and only once. */
  if not app.crm_followup_is_due(p_follow_up) then
    return null;
  end if;

  select coalesce(first_attempt_at, now()), attempts + 1
    into v_first, v_tries
    from public.crm_follow_ups where id = p_follow_up;

  /* ── Given up on ──────────────────────────────────────────────────────── */
  if v_tries >= 8 or v_first < now() - interval '6 hours' then
    update public.crm_follow_ups
       set status = 'failed',
           attempts = v_tries,
           first_attempt_at = v_first,
           outcome_note = coalesce(p_reason, 'WhatsApp kept refusing this.') ||
                          ' — gave up after ' || v_tries || ' attempts.',
           claimed_at = null,
           updated_at = now()
     where id = p_follow_up;
    return 'failed';
  end if;

  /* ── Try again shortly ────────────────────────────────────────────────────
     ⚠️ `claimed_at` IS CLEARED, or the row stays held by a runner that has
     already finished with it and nothing picks it up again. */
  update public.crm_follow_ups
     set due_at = now() + make_interval(mins => v_wait),
         attempts = v_tries,
         first_attempt_at = v_first,
         outcome_note = coalesce(p_reason, 'WhatsApp refused this.') ||
                        ' — attempt ' || v_tries || ', trying again shortly.',
         claimed_at = null,
         updated_at = now()
   where id = p_follow_up;
  return 'deferred';
end;
$fn$;

grant execute on function app.crm_followup_defer(uuid, text, integer) to cni_app;


/* ⚠️ AND A SUCCESSFUL SEND MUST COUNT ITS ATTEMPT TOO, or a row that failed
   twice and then sent would read as though it went first time. */
create or replace function app.crm_followup_sent(p_follow_up uuid, p_message_id text, p_error text)
returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  n integer;
begin
  update public.crm_follow_ups
     set status = case when p_error is null then 'done' else 'failed' end::public.crm_followup_status,
         done_at = case when p_error is null then now() end,
         outcome_note = coalesce(p_error, 'Sent automatically' ||
                                 case when p_message_id is null then '' else ' · ' || p_message_id end),
         attempts = attempts + 1,
         first_attempt_at = coalesce(first_attempt_at, now()),
         claimed_at = null,
         updated_at = now()
   where id = p_follow_up
     /* ⚠️ THE SAME QUESTION THE QUEUE ASKED (203), so a row that was offered can
        always be settled — and only once. */
     and app.crm_followup_is_due(id);
  get diagnostics n = row_count;
  return n > 0;
end;
$fn$;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid; v_lead uuid; v_f uuid;
  r text; s text; d timestamptz; a int; i int; n_note text;
begin
  select p.id into v_project
    from public.projects p join public.departments d2 on d2.id = p.lead_department_id
   where d2.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_owner
    from public.users u join public.departments d2 on d2.id = u.department_id
   where d2.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '224 · fixtures missing';
  end if;

  begin
    perform set_config('app.user_id', v_owner::text, true);

    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-224', '+923000000224', '+923000000224', 'contacted', now(), v_owner, true)
    returning id into v_lead;

    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at, assigned_to_id, created_by_id)
    values (v_lead, 'appointment_reminder', 'whatsapp', 'auto_send', 'due',
            'Confirm the visit', 'body', now(), v_owner, v_owner)
    returning id into v_f;

    /* 1 · A recoverable refusal keeps the row alive and pushes it forward. */
    select app.crm_followup_defer(v_f, 'The template is awaiting approval.', 10) into r;
    select status::text, due_at, attempts, outcome_note
      into s, d, a, n_note from public.crm_follow_ups where id = v_f;

    /* 2 · ⚠️ AND IT IS NO LONGER DUE, so the very next runner does not spin on
         it a second time within the same minute. */
    if app.crm_followup_is_due(v_f) then
      raise exception '224 · a deferred step was still due immediately';
    end if;

    /* 3 · It gives up rather than retrying for ever. */
    for i in 2 .. 9 loop
      update public.crm_follow_ups set due_at = now() - interval '1 minute' where id = v_f;
      perform app.crm_followup_defer(v_f, 'still pending', 10);
    end loop;
    select status::text, attempts into s, a from public.crm_follow_ups where id = v_f;

    raise exception using errcode = 'P0224', message = '224 rollback';
  exception when sqlstate 'P0224' then
    null;
  end;

  if r is distinct from 'deferred' then
    raise exception '224 · a recoverable refusal was not deferred (got %)', r;
  end if;
  if s is distinct from 'failed' then
    raise exception '224 · a step retried for ever instead of giving up (status %)', s;
  end if;
  if a <> 8 then
    raise exception '224 · gave up after % attempts, expected 8', a;
  end if;

  raise notice '224 · a refusal that will pass later waits, and gives up after 8 tries';
end $chk$;
