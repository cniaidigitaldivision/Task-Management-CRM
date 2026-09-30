-- ============================================================================
-- 270 · NO WHATSAPP MESSAGE IS LOST
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-30, after being told what the code actually did:
--
--   *"I want to not lose any message, any stranger text to that message, or when
--    they click on the WhatsApp campaigns and message a brand-new person ... They
--    will appear to the sales manager ... Assign it to the salesperson, move it
--    to spam."*
--
-- ── ⚠️ WHAT WAS HAPPENING, MEASURED ──────────────────────────────────────
-- `app.crm_record_inbound_message` opened with this:
--
--     v_lead := app.crm_lead_for_number(p_from_e164);
--     if v_lead is null then
--       return null;
--     end if;
--
-- A number we had never seen produced NOTHING. No lead, no row, no notification,
-- no table to look in — there is no unmatched or inbox table anywhere in this
-- schema; I checked before writing this. The webhook took the null and carried
-- on. Every click-to-WhatsApp enquiry and every stranger who texted the business
-- number was discarded at that line.
--
-- ── ⚠️ AND IT ARRIVES UNASSIGNED, WHICH IS THE POINT ─────────────────────
-- `app.crm_assign_new_lead` hands every ownerless lead to the top of the rota.
-- That is right for a Meta lead and wrong for a stranger: it would put spam on a
-- salesperson's desk with their name against it. The owner asked for these to
-- reach the SALES MANAGER first, so this adds a transaction-local hold that the
-- assigning trigger honours — the same shape as `app.crm_quiet_insert`, which
-- already exists for a neighbouring reason.
--
-- ⚠️ UNASSIGNED IS ALREADY A STATE HERE, not an error. 158's own note says so:
-- *"a lead refused because the rota could not choose loses the enquiry, which is
-- strictly worse than one a manager can see and hand out."* This is that case
-- reached deliberately rather than by accident.
--
-- ── ⚠️ SPAM IS REMEMBERED, OR IT IS NOT DEALT WITH ───────────────────────
-- Marking one message as spam achieves nothing if the next text from the same
-- number makes a fresh lead. The block list is what makes "deal with it as spam
-- properly" true: a blocked number's messages are refused at this function, so
-- the row never comes back.
-- ============================================================================

-- ── the block list ─────────────────────────────────────────────────────────
create table if not exists public.crm_blocked_numbers (
  phone_e164   text primary key,
  reason       text,
  blocked_by_id uuid references public.users (id) on delete set null,
  blocked_at   timestamptz not null default now(),
  /* What it was called when it was blocked, so a list of numbers is readable. */
  last_name    text,
  /* How many messages have been refused since. Counts what the block is worth. */
  refused      integer not null default 0
);

comment on table public.crm_blocked_numbers is
  'WhatsApp numbers marked as spam. Their inbound messages are refused before a lead is made — migration 270.';

grant select on public.crm_blocked_numbers to cni_app;
alter table public.crm_blocked_numbers enable row level security;

/* Reading the block list is a manager's business, and so is adding to it.
   Written argument-free so the helper is an InitPlan, not a call per row. */
drop policy if exists crm_blocked_numbers_select on public.crm_blocked_numbers;
create policy crm_blocked_numbers_select on public.crm_blocked_numbers
  for select using ((select app.crm_is_open_to_caller()));

-- ── the lead carries where it walked in from ───────────────────────────────
alter table public.crm_leads
  add column if not exists inbound_at timestamptz;

comment on column public.crm_leads.inbound_at is
  'When this lead first messaged us out of the blue, rather than arriving from an ad. Null for everything else — migration 270.';

/* The manager's queue is "mine to hand out": no owner, not archived. Indexed
   because it is looked at on every visit to the desk. */
create index if not exists crm_leads_unassigned_idx
  on public.crm_leads (project_id, submitted_at desc)
  where owner_id is null and archived_at is null;

-- ── the assigning trigger learns to hold ───────────────────────────────────
create or replace function app.crm_assign_new_lead()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_top record;
begin
  /* Somebody already decided. Leave it alone. */
  if new.owner_id is not null then
    return null;
  end if;

  if new.archived_at is not null then
    return null;
  end if;

  /* ⚠️ THE HOLD, AND THE ONE REASON IT EXISTS. A stranger's first WhatsApp
     message becomes a lead so it is never lost, and a salesperson must not find
     it on their desk before a human has looked at it. Set for the transaction
     only, so it cannot leak onto the next insert over a pooled connection. */
  if coalesce(current_setting('app.crm_hold_assignment', true), '') = 'on' then
    /* ⚠️ NO ASSIGNMENT ROW, and this is a BUG FOUND WHILE WRITING THIS.
       `crm_lead_assignments_moved` is `to_user_id is not null or from_user_id
       is not null` — an assignment where nobody gave and nobody received is
       refused. The branch below has written exactly that since 158 and would
       throw, which inside a BEFORE trigger fails the whole lead insert: the
       enquiry would be lost outright rather than merely unassigned. It has
       simply never fired, because the rota has always found somebody.

       Both branches now record the reason where it belongs — the activity log,
       which `crm_lead_record_activity` writes for every new lead — and leave the
       assignment table for assignments that actually happened. */
    return null;
  end if;

  select r.* into v_top from app.crm_lead_rota(new.project_id) r limit 1;

  if not found then
    /* ⚠️ UNASSIGNED IS A STATE, NOT A FAILURE — 158's own reasoning, kept.
       The assignment row it used to write is gone for the reason above. */
    return null;
  end if;

  update public.crm_leads set owner_id = v_top.user_id where id = new.id;

  insert into public.crm_lead_assignments
    (lead_id, to_user_id, from_user_id, decided_by_id, rule, reason_text)
  values (new.id, v_top.user_id, null, null, 'rota',
          format('Fewest open leads (%s) and %s.',
                 v_top.open_leads,
                 case when v_top.at_work then 'at work now' else 'next in the rota' end));

  return null;
end $function$;

-- ── and the message itself ─────────────────────────────────────────────────
create or replace function app.crm_record_inbound_message(
  p_from_e164 text,
  p_wamid text,
  p_kind text,
  p_body text,
  p_media_id text,
  p_media_mime text,
  p_filename text,
  p_occurred timestamptz,
  p_reply_to text default null,
  p_voice boolean default false,
  /* ⚠️ NEW, AND BOTH DEFAULT TO NULL so a deployed build that has not been
     updated yet keeps working through the rollout. */
  p_to_phone_number_id text default null,
  p_profile_name text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_lead    uuid;
  v_id      uuid;
  v_run     uuid;
  v_project uuid;
  v_name    text;
begin
  /* ⚠️ THE BLOCK IS CHECKED FIRST, BEFORE THE LEAD LOOKUP, and the self-check
     is what taught me that. Marking spam ARCHIVES the lead but leaves the row,
     and `app.crm_lead_for_number` matches on the number without caring whether
     the lead is archived — so a blocked number still found its old lead, never
     reached a check placed after it, and sailed through. Blocking has to mean
     blocked whatever else exists. */
  if exists (select 1 from public.crm_blocked_numbers b where b.phone_e164 = p_from_e164) then
    update public.crm_blocked_numbers
       set refused = refused + 1
     where phone_e164 = p_from_e164;
    return null;
  end if;

  v_lead := app.crm_lead_for_number(p_from_e164);

  if v_lead is null then
    /* ── a number we have never seen ───────────────────────────────────── */

    /* Which of our numbers did they message? That decides the project. */
    select p.id into v_project
      from public.projects p
     where p.whatsapp_phone_number_id = p_to_phone_number_id
     limit 1;

    if v_project is null then
      /* ⚠️ A FALLBACK, BECAUSE LOSING IT IS THE ONE UNACCEPTABLE OUTCOME.
         Meta only delivers messages for numbers on our own account, so a miss
         here means a project was configured after the number was — a setup gap,
         not a stranger. Landing the lead on the one configured project is
         recoverable by moving it; dropping the message is not. */
      select p.id into v_project
        from public.projects p
       where p.whatsapp_phone_number_id is not null
       order by p.created_at
       limit 1;
    end if;

    if v_project is null then
      /* No WhatsApp is configured at all. Nothing can own this. */
      return null;
    end if;

    /* ⚠️ THEIR OWN WHATSAPP NAME IF THEY HAVE ONE, the number otherwise. A lead
       called "Unknown" is one nobody can pick out of a list. */
    v_name := nullif(btrim(coalesce(p_profile_name, '')), '');
    if v_name is null then
      v_name := p_from_e164;
    end if;

    /* ⚠️ HELD FOR THE MANAGER. See the trigger above. */
    perform set_config('app.crm_hold_assignment', 'on', true);
    /* ⚠️ AND NOT GREETED. A stranger who says "wrong number" must not get an
       automated welcome; the greeting trigger stands down on this flag. */
    perform set_config('app.crm_quiet_insert', 'on', true);

    insert into public.crm_leads
      (project_id, full_name, phone, phone_e164, source, source_detail,
       stage, submitted_at, inbound_at, whatsapp_consent)
    values (v_project, v_name, p_from_e164, p_from_e164,
            'whatsapp'::public.crm_lead_source,
            'Messaged the business number',
            'new'::public.crm_stage, coalesce(p_occurred, now()), coalesce(p_occurred, now()),
            /* ⚠️ THEY WROTE TO US FIRST, which is consent to write back inside
               the 24-hour window and nothing more. The window is enforced in
               `lib/crm/whatsapp.ts`, not here. */
            true)
    returning id into v_lead;

    perform set_config('app.crm_hold_assignment', '', true);
    perform set_config('app.crm_quiet_insert', '', true);
  end if;

  insert into public.crm_lead_messages
    (lead_id, wa_message_id, direction, kind, body, media_id, media_mime,
     media_filename, occurred_at, reply_to_wamid, media_voice)
  values
    (v_lead, p_wamid, 'inbound',
     (case when p_kind = any (enum_range(null::public.crm_message_kind)::text[])
           then p_kind else 'unknown' end)::public.crm_message_kind,
     p_body, p_media_id, p_media_mime, p_filename,
     coalesce(p_occurred, now()), p_reply_to, coalesce(p_voice, false))
  on conflict (wa_message_id) do nothing
  returning id into v_id;

  if v_id is not null then
    perform app.crm_notify_lead_replied(v_lead);

    /* ── 208 · THE CHASE STOPS NOW, NOT ON TUESDAY ────────────────────────
       ⚠️ AFTER THE INSERT, AND THAT ORDER IS THE WHOLE THING. The stop reason is
       answered by looking for an inbound row; asked before this insert it would
       find nothing and cheerfully leave the plan running.

       ⚠️ AND ONLY ON A ROW THAT WAS ACTUALLY NEW. The conflict clause above
       means a redelivered webhook returns null here, and a duplicate delivery
       must not restamp a run a salesperson has since resumed. */
    for v_run in
      select ls.id from public.crm_lead_sequences ls
       where ls.lead_id = v_lead
         and ls.state in ('scheduled', 'active')
    loop
      perform app.crm_sequence_settle(v_run);
    end loop;
  end if;

  return v_id;
end $function$;

-- ── marking one as spam ────────────────────────────────────────────────────
/**
 * Archive the lead AND remember the number, in one act.
 *
 * ⚠️ BOTH HALVES OR NEITHER. Archiving alone leaves the next text from the same
 * number making a fresh lead, which is the manager doing the same work forever.
 */
create or replace function app.crm_mark_spam(p_lead uuid, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_lead record;
begin
  select l.id, l.phone_e164, l.full_name into v_lead
    from public.crm_leads l where l.id = p_lead;
  if not found then
    return false;
  end if;

  /* ⚠️ ONLY A MANAGER. A salesperson must not be able to make a number
     permanently invisible to the whole team. */
  if not app.crm_manages_own_department() and not app.acting_at_least('admin'::public.user_role) then
    raise exception 'Only a manager can mark a number as spam.'
      using errcode = 'check_violation';
  end if;

  update public.crm_leads
     set archived_at = now(),
         archived_reason = coalesce(nullif(btrim(p_reason), ''), 'Marked as spam.')
   where id = p_lead;

  if v_lead.phone_e164 is not null then
    insert into public.crm_blocked_numbers (phone_e164, reason, blocked_by_id, last_name)
    values (v_lead.phone_e164,
            coalesce(nullif(btrim(p_reason), ''), 'Marked as spam.'),
            app.current_user_id(), v_lead.full_name)
    on conflict (phone_e164) do update
      set reason = excluded.reason,
          blocked_by_id = excluded.blocked_by_id,
          blocked_at = now();
  end if;

  return true;
end $function$;

/** Undo it — a wrong call must be as easy to reverse as it was to make. */
create or replace function app.crm_unmark_spam(p_number text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
begin
  if not app.crm_manages_own_department() and not app.acting_at_least('admin'::public.user_role) then
    raise exception 'Only a manager can unblock a number.'
      using errcode = 'check_violation';
  end if;
  delete from public.crm_blocked_numbers where phone_e164 = p_number;
  return found;
end $function$;

revoke all on function app.crm_mark_spam(uuid, text) from public;
revoke all on function app.crm_unmark_spam(text) from public;

-- ============================================================================
-- SELF-CHECK — a stranger is captured, held, and blockable
-- ============================================================================
do $$
declare
  v_admin   uuid;
  v_project uuid;
  v_pid     text;
  v_msg     uuid;
  v_lead    uuid;
  v_owner   uuid;
  v_again   uuid;
  v_before  int;
  v_after   int;
  NUMBER    constant text := '+923000000991';
begin
  select id into v_admin from public.users
   where is_active and role in ('admin','super_admin') order by created_at limit 1;
  perform set_config('app.user_id', v_admin::text, true);

  select p.id, p.whatsapp_phone_number_id into v_project, v_pid
    from public.projects p where p.whatsapp_phone_number_id is not null
    order by p.created_at limit 1;

  if v_project is null then
    raise notice '270 · no project has WhatsApp configured; the capture is untested here';
    return;
  end if;

  select count(*) into v_before from public.crm_leads where phone_e164 = NUMBER;

  -- ── 1 · a stranger is captured rather than dropped ───────────────────────
  v_msg := app.crm_record_inbound_message(
    NUMBER, 'wamid.selfcheck270.a', 'text', 'Do you have 5 marla plots?',
    null, null, null, now(), null, false, v_pid, 'Imran Test');

  if v_msg is null then
    raise exception 'A STRANGER''S MESSAGE WAS STILL DROPPED';
  end if;

  select count(*) into v_after from public.crm_leads where phone_e164 = NUMBER;
  if v_after <> v_before + 1 then
    raise exception 'NO LEAD WAS CREATED FOR THE STRANGER (% -> %)', v_before, v_after;
  end if;

  select id, owner_id into v_lead, v_owner
    from public.crm_leads where phone_e164 = NUMBER order by submitted_at desc limit 1;

  -- ── 2 · and it is HELD, not handed to a salesperson ──────────────────────
  if v_owner is not null then
    raise exception 'A STRANGER WAS ASSIGNED TO A SALESPERSON BEFORE A HUMAN LOOKED';
  end if;

  -- ── 3 · their name and the message came with it ──────────────────────────
  if (select full_name from public.crm_leads where id = v_lead) <> 'Imran Test' then
    raise exception 'THE WHATSAPP PROFILE NAME WAS NOT KEPT';
  end if;
  if not exists (select 1 from public.crm_lead_messages
                  where lead_id = v_lead and body = 'Do you have 5 marla plots?') then
    raise exception 'THE MESSAGE ITSELF WAS NOT STORED';
  end if;

  -- ── 4 · a second message joins the SAME lead ─────────────────────────────
  perform app.crm_record_inbound_message(
    NUMBER, 'wamid.selfcheck270.b', 'text', 'Still there?',
    null, null, null, now(), null, false, v_pid, 'Imran Test');
  select count(*) into v_after from public.crm_leads where phone_e164 = NUMBER;
  if v_after <> v_before + 1 then
    raise exception 'A SECOND MESSAGE MADE A SECOND LEAD';
  end if;

  -- ── 5 · spam blocks the number and refuses the next one ──────────────────
  perform app.crm_mark_spam(v_lead, 'Self-check.');
  if not exists (select 1 from public.crm_blocked_numbers where phone_e164 = NUMBER) then
    raise exception 'MARKING SPAM DID NOT REMEMBER THE NUMBER';
  end if;
  if (select archived_at from public.crm_leads where id = v_lead) is null then
    raise exception 'MARKING SPAM DID NOT ARCHIVE THE LEAD';
  end if;

  v_again := app.crm_record_inbound_message(
    NUMBER, 'wamid.selfcheck270.c', 'text', 'Hello again',
    null, null, null, now(), null, false, v_pid, 'Imran Test');
  if v_again is not null then
    raise exception 'A BLOCKED NUMBER STILL GOT THROUGH';
  end if;
  if (select refused from public.crm_blocked_numbers where phone_e164 = NUMBER) < 1 then
    raise exception 'THE REFUSAL WAS NOT COUNTED';
  end if;

  -- ── 6 · and unblocking works ─────────────────────────────────────────────
  perform app.crm_unmark_spam(NUMBER);
  if exists (select 1 from public.crm_blocked_numbers where phone_e164 = NUMBER) then
    raise exception 'UNBLOCKING DID NOTHING';
  end if;

  -- ── clean up ─────────────────────────────────────────────────────────────
  delete from public.crm_lead_messages where lead_id = v_lead;
  delete from public.crm_lead_assignments where lead_id = v_lead;
  delete from public.crm_lead_activity where lead_id = v_lead;
  delete from public.crm_leads where id = v_lead;
  if exists (select 1 from public.crm_leads where phone_e164 = NUMBER) then
    raise exception 'THE 270 FIXTURE SURVIVED';
  end if;

  raise notice '270 self-check passed: a stranger becomes a held lead with their name and message, a second message joins it, spam blocks and counts, and unblocking works';
end $$;
