-- ============================================================================
-- 247 · FOLLOW-UP CONDITIONS BELONG TO THE FOLLOW-UP
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-22, with a design for a "Follow-up conditions" dialog:
--
--   *"These are basically follow-up checks or, you can say, advanced settings.
--   There will be some button and when I click it that modal will appear.
--   Properly and logically each and everything should be wired up. Right now
--   it should be set to the default, according to the default setting of
--   follow-up, but if I want to change I can change it over here and it will
--   implement accordingly."*
--
-- ── WHAT WAS TRUE BEFORE ───────────────────────────────────────────────────
-- The checks existed but only bound to a SEQUENCE: `crm_sequences` carries
-- `stop_on_reply`, `stop_on_visit`, `stop_on_quotation_dead`, and
-- `crm_sequence_stop_reason` reads them. A ONE-OFF follow-up — most of what a
-- salesperson creates by hand — got only three: the lead is not won/lost, they
-- have not opted out, and the channel is reachable. So "do not chase somebody
-- who has just replied" was a promise the screen made and only sequences kept.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────
-- Eight nullable columns on `crm_follow_ups`. ⚠️ NULL MEANS "THE DEFAULT FOR
-- THIS PURPOSE" — the owner's *"right now it should be set to the default"*
-- taken literally, so no existing row's behaviour is guessed at or frozen, and
-- a later change to a default reaches every row that never overrode it.
--
-- `app.crm_followup_conditions` resolves them and, in the same row, answers
-- each check AS IT STANDS NOW — that is what the dialog's "Before sending"
-- column shows, so it is a live reading rather than a drawing of one.
--
-- ⚠️ THE GATE IS WHERE IT BINDS. `crm_followups_to_send` now applies the
-- resolved conditions to EVERY row. The dialog describes rules the database
-- enforces at the moment of sending; it does not implement any of them itself.
--
-- ── ⚠️ TWO CHECKS ARE NOT PREFERENCES AND GET NO COLUMN ────────────────────
-- A closed lead (won/lost) and a stated no (`whatsapp_consent = false`) stay
-- unconditional, exactly as `crm_sequence_stop_reason` already says of them:
-- *"A closed lead and a stated no are not preferences; nothing in the dialog
-- can switch them off."* Opting out is the client's instruction, not ours.
-- The dialog shows both as always-on and says why.
--
-- ── ⚠️ "ATTEMPTS" MEANS RETRIES, AND THE DEFAULT IS UNCHANGED ──────────────
-- `crm_followup_defer` retries a REFUSED send (a Meta hiccup), up to 8 times
-- inside 6 hours, 10 minutes apart. Those two numbers become per-row and keep
-- their current values as the default, so nothing about delivery changes until
-- somebody changes it. This is not "message the client 3 times".
-- ============================================================================

alter table public.crm_follow_ups
  add column if not exists cond_no_reply     boolean,
  add column if not exists cond_quote_valid  boolean,
  add column if not exists cond_not_booked   boolean,
  add column if not exists on_reply          text,
  add column if not exists on_opt_out        text,
  add column if not exists on_quote_expired  text,
  add column if not exists max_attempts      smallint,
  add column if not exists retry_gap_minutes smallint;

comment on column public.crm_follow_ups.cond_no_reply is
  'null = the default for this purpose (247). true: do not send while the client is waiting on us.';
comment on column public.crm_follow_ups.max_attempts is
  'null = 8 (247). Retries of a REFUSED send, not messages to the client.';

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_follow_ups_on_reply_ck') then
    alter table public.crm_follow_ups add constraint crm_follow_ups_on_reply_ck
      check (on_reply is null or on_reply in ('hold', 'cancel', 'send_anyway'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_follow_ups_on_opt_out_ck') then
    alter table public.crm_follow_ups add constraint crm_follow_ups_on_opt_out_ck
      check (on_opt_out is null or on_opt_out in ('stop_sales', 'stop_everything'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_follow_ups_on_quote_expired_ck') then
    alter table public.crm_follow_ups add constraint crm_follow_ups_on_quote_expired_ck
      check (on_quote_expired is null or on_quote_expired in ('hold', 'cancel', 'send_anyway'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_follow_ups_attempts_ck') then
    alter table public.crm_follow_ups add constraint crm_follow_ups_attempts_ck
      check (max_attempts is null or max_attempts between 1 and 8);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_follow_ups_retry_gap_ck') then
    alter table public.crm_follow_ups add constraint crm_follow_ups_retry_gap_ck
      check (retry_gap_minutes is null or retry_gap_minutes between 5 and 360);
  end if;
end
$c$;

-- ============================================================================
-- THE DEFAULTS, BY PURPOSE — one authority, in SQL, because the gate enforces
-- them and a second copy in TypeScript could disagree with the sending.
-- ----------------------------------------------------------------------------
-- ⚠️ AN APPOINTMENT REMINDER IS NOT A CHASE. "Your visit is tomorrow at 3 PM"
-- must go even though the client replied, and even though a visit is booked —
-- it is ABOUT that booking. Same for feedback after a meeting and a welcome.
-- The visit check mirrors `crm_sequence_stop_reason`, which already limits
-- itself to the three chase purposes.
-- ============================================================================

create or replace function app.crm_followup_default_conditions(p_purpose text)
returns table (no_reply boolean, quote_valid boolean, not_booked boolean)
language sql
immutable
as $fn$
  select
    p_purpose not in ('appointment_reminder', 'meeting_feedback', 'welcome', 'payment_received'),
    p_purpose in ('quotation', 'proposal', 'negotiation', 'approved_offer', 'agreement'),
    p_purpose in ('no_response', 're_engage', 'quotation')
$fn$;

-- ============================================================================
-- THE RESOLVED CONDITIONS, AND HOW EACH ONE STANDS RIGHT NOW
-- ============================================================================

create or replace function app.crm_followup_conditions(p_follow_up uuid)
returns table (
  follow_up_id      uuid,
  purpose           text,
  -- resolved settings (the default already applied; `*_is_default` says which)
  cond_no_reply     boolean,
  cond_quote_valid  boolean,
  cond_not_booked   boolean,
  no_reply_default  boolean,
  quote_default     boolean,
  booked_default    boolean,
  on_reply          text,
  on_opt_out        text,
  on_quote_expired  text,
  max_attempts      smallint,
  retry_gap_minutes smallint,
  attempts_so_far   integer,
  -- how it stands now
  ok_no_reply       boolean,
  ok_quote_valid    boolean,
  ok_not_booked     boolean,
  ok_lead_open      boolean,
  ok_consent        boolean,
  quotation_number  text,
  quotation_status  text,
  quote_valid_until date,
  lead_stage        text,
  booked_at         timestamptz
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  with f as (
    select f.*, l.stage::text as stage, l.whatsapp_consent, l.id as lid,
           coalesce(ls.quotation_id, f_q.qid) as quote_id
      from public.crm_follow_ups f
      join public.crm_leads l on l.id = f.lead_id
      left join public.crm_lead_sequences ls on ls.id = f.lead_sequence_id
      left join lateral (
        select q.id as qid from public.crm_quotations q
         where q.lead_id = f.lead_id and q.status <> 'draft'
         order by q.created_at desc limit 1
      ) f_q on true
     where f.id = p_follow_up
  ),
  d as (select * from f, app.crm_followup_default_conditions(f.purpose::text) dc),
  q as (
    select q.id, q.number::text as number, q.status::text as status, q.valid_until
      from public.crm_quotations q join d on d.quote_id = q.id
  ),
  appt as (
    select min(a.scheduled_at) as at
      from public.crm_appointments a join d on d.lid = a.lead_id
     where a.status in ('scheduled', 'confirmed') and a.scheduled_at >= now()
  ),
  waiting as (
    /* ⚠️ "THEY HAVE NOT REPLIED SINCE OUR LAST MESSAGE" — an inbound message
       newer than our newest outbound one. That is the same thing the screen
       calls "reply needed", so the dialog and the queue cannot disagree. */
    select exists (
      select 1 from public.crm_lead_messages m join d on d.lid = m.lead_id
       where m.direction = 'inbound'
         and m.created_at > coalesce((
           select max(o.created_at) from public.crm_lead_messages o
            where o.lead_id = d.lid and o.direction = 'outbound'
         ), '-infinity'::timestamptz)
    ) as they_wait
  )
  select
    d.id, d.purpose::text,
    coalesce(d.cond_no_reply, d.no_reply), coalesce(d.cond_quote_valid, d.quote_valid),
    coalesce(d.cond_not_booked, d.not_booked),
    d.no_reply, d.quote_valid, d.not_booked,
    coalesce(d.on_reply, 'hold'), coalesce(d.on_opt_out, 'stop_sales'),
    coalesce(d.on_quote_expired, 'hold'),
    coalesce(d.max_attempts, 8::smallint), coalesce(d.retry_gap_minutes, 10::smallint),
    d.attempts,
    not (select they_wait from waiting),
    coalesce(
      (select not (q.status in ('expired', 'rejected', 'superseded')
                   or (q.valid_until is not null
                       and q.valid_until < (now() at time zone 'Asia/Karachi')::date))
         from q),
      true
    ),
    (select at from appt) is null,
    d.stage not in ('won', 'lost'),
    d.whatsapp_consent is distinct from false,
    (select number from q), (select status from q), (select valid_until from q),
    d.stage, (select at from appt)
  from d
$fn$;

grant execute on function app.crm_followup_default_conditions(text) to public;
grant execute on function app.crm_followup_conditions(uuid) to public;

-- ============================================================================
-- THE GATE — the conditions now bind to EVERY row, not only a sequence's
-- ============================================================================

create or replace function app.crm_followups_to_send(p_limit integer default 25)
returns table (
  follow_up_id uuid, lead_id uuid, project_id uuid, lead_sequence_id uuid, owner_id uuid,
  channel text, title text, body text, subject text, lead_name text, to_phone text, to_email text,
  template_name text, template_language text, template_vars text[], template_values text[],
  document_ids uuid[], window_open boolean, wa_phone_number_id text, sender_name text,
  project_name text, purpose text
)
language sql
security definer
set search_path = public, app, pg_temp
as $fn$
  with claimed as (
    update public.crm_follow_ups f
       set claimed_at = now()
     where f.id in (
       select c.id
         from public.crm_follow_ups c
         join public.crm_leads l on l.id = c.lead_id
         join public.projects p on p.id = l.project_id
        where c.status in ('planned', 'due')
          and c.mode = 'auto_send'
          and c.due_at <= now()
          and (c.claimed_at is null or c.claimed_at < now() - interval '5 minutes')
          /* The two that are never a preference. */
          and l.stage not in ('won', 'lost')
          and (c.lead_sequence_id is null or app.crm_sequence_stop_reason(c.lead_sequence_id) is null)
          /* 247 · the row's own conditions, resolved, applied to every row.
             ⚠️ `send_anyway` is expressed by the condition being OFF, so this
             is one test per condition rather than a condition and an action. */
          and (
            select (not k.cond_no_reply    or k.ok_no_reply)
               and (not k.cond_quote_valid or k.ok_quote_valid)
               and (not k.cond_not_booked  or k.ok_not_booked)
               and k.attempts_so_far < k.max_attempts
              from app.crm_followup_conditions(c.id) k
          )
          and (
            (c.channel = 'whatsapp'
             and l.phone_e164 is not null
             and p.whatsapp_phone_number_id is not null
             and l.whatsapp_consent is distinct from false)
            or (c.channel = 'email' and l.email is not null)
          )
        order by c.due_at
        limit greatest(1, least(p_limit, 100))
        for update of c skip locked
     )
    returning f.id
  )
  select f.id, f.lead_id, l.project_id, f.lead_sequence_id, f.assigned_to_id,
         f.channel::text, f.title, f.body, st.subject,
         l.full_name, l.phone_e164, l.email,
         coalesce(nullif(f.wa_template_name, ''), nullif(st.wa_template_name, '')),
         coalesce(nullif(f.wa_template_language, ''), nullif(st.wa_template_language, ''), 'en'),
         coalesce(f.wa_template_vars, st.wa_template_vars),
         f.wa_template_values,
         st.document_ids,
         app.crm_window_is_open(f.lead_id),
         p.whatsapp_phone_number_id,
         coalesce(nullif(trim(s.whatsapp_display_name), ''), p.name),
         p.name,
         f.purpose::text
    from claimed
    join public.crm_follow_ups f on f.id = claimed.id
    join public.crm_leads l on l.id = f.lead_id
    join public.projects p on p.id = l.project_id
    left join public.crm_project_settings s on s.project_id = p.id
    left join public.crm_lead_sequences ls on ls.id = f.lead_sequence_id
    left join public.crm_sequence_steps st
           on st.sequence_id = ls.sequence_id and st.step_no = f.sequence_step_no
   order by f.due_at
$fn$;

-- ============================================================================
-- RETRIES — the row's own cap and gap, defaulting to today's 8 and 10 minutes
-- ============================================================================

create or replace function app.crm_followup_defer(p_follow_up uuid, p_reason text, p_minutes integer default null)
returns text
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_first timestamptz;
  v_tries integer;
  v_cap   integer;
  v_gap   integer;
begin
  if not app.crm_followup_is_due(p_follow_up) then
    return null;
  end if;

  select coalesce(first_attempt_at, now()), attempts + 1,
         coalesce(max_attempts, 8), coalesce(p_minutes, retry_gap_minutes, 10)
    into v_first, v_tries, v_cap, v_gap
    from public.crm_follow_ups where id = p_follow_up;

  v_gap := greatest(1, least(360, v_gap));

  /* ── Given up on ──────────────────────────────────────────────────────── */
  if v_tries >= v_cap or v_first < now() - interval '6 hours' then
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

  update public.crm_follow_ups
     set due_at = now() + make_interval(mins => v_gap),
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

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  k record;
  d record;
  v_lead uuid;
  v_fu uuid;
begin
  /* ── The defaults say what they must say ─────────────────────────────── */
  select * into d from app.crm_followup_default_conditions('appointment_reminder');
  if d.no_reply or d.not_booked then
    raise exception '247 · an appointment reminder would be held back by a reply or a booking'
      using errcode = 'CR247';
  end if;
  select * into d from app.crm_followup_default_conditions('quotation');
  if not (d.no_reply and d.quote_valid and d.not_booked) then
    raise exception '247 · a quotation chase is not guarded by default' using errcode = 'CR247';
  end if;
  select * into d from app.crm_followup_default_conditions('no_response');
  if d.quote_valid then
    raise exception '247 · a silence chase should not need a live quotation' using errcode = 'CR247';
  end if;

  /* ── And the resolver runs against a REAL row, or says it could not ──── */
  select f.id into v_fu
    from public.crm_follow_ups f
   where f.status in ('planned', 'due')
   order by f.due_at desc
   limit 1;

  if v_fu is null then
    raise notice '247 · ⚠ no open follow-up to resolve against — shape checked, values NOT';
  else
    select * into k from app.crm_followup_conditions(v_fu);
    if k.follow_up_id is null or k.max_attempts is null or k.on_reply is null then
      raise exception '247 · the resolver returned nothing for an open follow-up' using errcode = 'CR247';
    end if;
    if k.max_attempts <> 8 or k.retry_gap_minutes <> 10 then
      raise exception '247 · the retry default changed (% attempts, % min) — delivery must be untouched',
        k.max_attempts, k.retry_gap_minutes using errcode = 'CR247';
    end if;
    raise notice '247 · ✓ resolved % — no_reply=% quote=% booked=% · now: reply_ok=% quote_ok=% booked_ok=% open=% consent=%',
      k.purpose, k.cond_no_reply, k.cond_quote_valid, k.cond_not_booked,
      k.ok_no_reply, k.ok_quote_valid, k.ok_not_booked, k.ok_lead_open, k.ok_consent;
  end if;

  /* ── An override is honoured over the default ─────────────────────────── */
  if v_fu is not null then
    select * into k from app.crm_followup_conditions(v_fu);
    update public.crm_follow_ups set cond_no_reply = not k.no_reply_default where id = v_fu;
    select * into k from app.crm_followup_conditions(v_fu);
    if k.cond_no_reply = k.no_reply_default then
      raise exception '247 · an explicit setting was ignored in favour of the default'
        using errcode = 'CR247';
    end if;
    /* ⚠️ PUT IT BACK. A self-check that leaves a live row overridden has
       changed the business to test itself. */
    update public.crm_follow_ups set cond_no_reply = null where id = v_fu;
    select * into k from app.crm_followup_conditions(v_fu);
    if k.cond_no_reply <> k.no_reply_default then
      raise exception '247 · clearing the override did not fall back to the default'
        using errcode = 'CR247';
    end if;
    raise notice '247 · ✓ an override wins, and clearing it falls back to the purpose default';
  end if;

  /* ── The gate still answers, and still refuses a closed lead ─────────── */
  perform * from app.crm_followups_to_send(1);
  raise notice '247 · ✓ the gate runs with the conditions applied';

  select l.id into v_lead from public.crm_leads l where l.stage in ('won', 'lost') limit 1;
  if v_lead is not null and exists (
    select 1 from app.crm_followups_to_send(100) s
     join public.crm_follow_ups f on f.id = s.follow_up_id
    where f.lead_id = v_lead
  ) then
    raise exception '247 · a closed lead was offered for sending' using errcode = 'CR247';
  end if;

  raise notice '247 · ✓ follow-up conditions belong to the follow-up, and the gate enforces them';
end
$chk$;
