-- ============================================================================
-- 203 · ONE DEFINITION OF "DUE" — 202 widened the queue and nothing else
-- ----------------------------------------------------------------------------
-- The owner's 1 pm follow-up was picked up by the sender and refused:
--
--   {"ok":true,"due":1,"sent":0,"failed":1,
--    "results":[{"leadName":"Umm e e Habiba","outcome":"failed",
--                "detail":"no longer due"}]}
--
-- ⚠️ THIS IS 202'S FAULT, AND MINE. That migration taught
-- `app.crm_followups_to_send` that a `planned` row whose `due_at` has passed is
-- due — and left the other three functions in the same chain still testing
-- `status = 'due'` exactly:
--
--   crm_followups_to_send   OFFERS the row      ← widened by 202
--   crm_followup_tokens     fills its {{names}} ← still demanded 'due'  ✗
--   crm_followup_attachments its files          ← still demanded 'due'  ✗
--   crm_followup_sent       SETTLES it          ← still demanded 'due'  ✗
--
-- So the sender was handed a row it was then told did not exist. It stopped at
-- the first step, reported "no longer due", and **nothing was sent** — which is
-- the one mercy here: the failure was before Meta, not after, so no client was
-- messaged and no row is half-settled.
--
-- ⚠️ A PREDICATE COPIED INTO FOUR FUNCTIONS IS ONE DEFINITION IN NAME ONLY.
-- That is the actual lesson: `status = 'due'` appeared four times, I changed one,
-- and the three that disagreed were invisible until a real send hit them. So it
-- is now written ONCE, as `app.crm_followup_is_due(uuid)`, and all four ask it.
-- The next person to change what "due" means changes it in one place, and cannot
-- half-change it.
--
-- ⚠️ AND IT IS STILL `auto_send` ONLY. The guard is about WHEN a row may be sent,
-- never about WHETHER a machine may send it — a reminder stays a person's job.
-- ============================================================================

/**
 * May the sender act on this row right now?
 *
 * ⚠️ `STABLE`, NOT `IMMUTABLE`: it reads `now()` and a table. And it takes the
 * row's id rather than its columns, because every caller has the id and none of
 * them should restate the rule.
 */
create or replace function app.crm_followup_is_due(p_follow_up uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select exists (
    select 1 from public.crm_follow_ups f
     where f.id = p_follow_up
       /* 202: nothing ever moves 'planned' to 'due', so the clock decides. */
       and f.status in ('planned', 'due')
       and f.due_at <= now()
       and f.mode = 'auto_send'
  )
$fn$;

comment on function app.crm_followup_is_due(uuid) is
  '203 · the ONE definition of a follow-up the sender may act on. Every step of the send asks this.';

revoke all on function app.crm_followup_is_due(uuid) from public;
grant execute on function app.crm_followup_is_due(uuid) to cni_app;

/* ── The three that disagreed ──────────────────────────────────────────────── */

create or replace function app.crm_followup_tokens(p_follow_up uuid)
returns table (
  lead_first text, lead_name text, owner_first text, owner_name text,
  company text, project text, quotation text, visit_when text
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select
    coalesce(nullif(split_part(btrim(l.full_name), ' ', 1), ''), 'Sir/Madam'),
    coalesce(nullif(btrim(l.full_name), ''), 'Sir/Madam'),
    coalesce(nullif(split_part(btrim(u.full_name), ' ', 1), ''), ''),
    coalesce(u.full_name, ''),
    coalesce(nullif(btrim(s.whatsapp_display_name), ''), p.name),
    p.name,
    coalesce((
      select q.number from public.crm_quotations q
       where q.lead_id = l.id
         and q.status not in ('superseded', 'rejected', 'expired')
       order by q.version desc, q.created_at desc
       limit 1), 'the quotation'),
    coalesce((
      select to_char(a.scheduled_at at time zone 'Asia/Karachi', 'FMDay FMDD FMMon, FMHH12:MI AM')
        from public.crm_appointments a
       where a.lead_id = l.id
         and a.status in ('scheduled', 'confirmed')
         and a.scheduled_at >= now()
       order by a.scheduled_at
       limit 1), 'the agreed time')
    from public.crm_follow_ups f
    join public.crm_leads l on l.id = f.lead_id
    join public.projects p on p.id = l.project_id
    left join public.crm_project_settings s on s.project_id = p.id
    left join public.users u on u.id = f.assigned_to_id
   where f.id = p_follow_up
     and app.crm_followup_is_due(f.id)
$fn$;

create or replace function app.crm_followup_attachments(p_follow_up uuid)
returns table (storage_path text, mime text, title text, size_bytes bigint)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select d.storage_path, d.mime, d.title, d.size_bytes
    from public.crm_follow_ups f
    join public.crm_leads l on l.id = f.lead_id
    join public.crm_lead_sequences ls on ls.id = f.lead_sequence_id
    join public.crm_sequence_steps st
      on st.sequence_id = ls.sequence_id and st.step_no = f.sequence_step_no
    join public.crm_documents d
      on d.id = any (st.document_ids)
     /* ⚠️ THE DOCUMENT MUST BELONG TO THIS LEAD OR ITS PROJECT. A step could
        otherwise name any document id and the machine would post it to a
        client. */
     and d.project_id = l.project_id
     and (d.lead_id is null or d.lead_id = l.id)
   where f.id = p_follow_up
     and app.crm_followup_is_due(f.id)
     /* 20 MB is Resend's ceiling for the whole message; this keeps one file
        well under it and the sender counts the total. */
     and d.size_bytes <= 15 * 1024 * 1024
   order by d.created_at
   limit 5
$fn$;

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
         updated_at = now()
   where id = p_follow_up
     /* ⚠️ THE SAME QUESTION THE QUEUE ASKED, so a row that was offered can always
        be settled. 202 widened the queue alone and this refused every row it
        produced — the message could not even be composed. */
     and app.crm_followup_is_due(id);
  get diagnostics n = row_count;
  /* ⚠️ FALSE MEANS SOMEBODY ELSE SETTLED IT FIRST — another runner, or a person
     completing it by hand. The caller must not then write a thread row. */
  return n > 0;
end;
$fn$;

-- ============================================================================
-- SELF-CHECK — the whole chain agrees, on the same row
-- ============================================================================
do $chk$
declare
  v_project uuid; v_lead uuid; v_owner uuid; v_id uuid;
  n_queue int := -1; n_tokens int := -1; n_settled int := -1; n_twice int := -1;
  n_future_queue int := -1; n_future_tokens int := -1;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.whatsapp_phone_number_id is not null limit 1;

  select l.id, l.owner_id into v_lead, v_owner
    from public.crm_leads l
   where l.project_id = v_project
     and l.phone_e164 is not null
     and l.whatsapp_consent is distinct from false
     and l.stage not in ('won', 'lost')
     and app.crm_window_is_open(l.id)
   limit 1;

  if v_lead is null then
    raise exception '203 · no lead with an open window — the chain could not be proved';
  end if;

  begin
    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at, assigned_to_id, created_by_id)
    values (v_lead, 'no_response', 'whatsapp', 'auto_send', 'planned',
            'SELFCHECK-203', 'body', now() - interval '1 minute', v_owner, v_owner)
    returning id into v_id;

    /* 1 · Offered by the queue… */
    select count(*)::int into n_queue from app.crm_followups_to_send(100) q where q.follow_up_id = v_id;
    /* 2 · …and every other step agrees it exists. */
    select count(*)::int into n_tokens from app.crm_followup_tokens(v_id);
    /* 3 · …and it can be settled. */
    select case when app.crm_followup_sent(v_id, 'wamid.selfcheck', null) then 1 else 0 end into n_settled;
    /* 4 · ⚠️ AND ONLY ONCE. A second runner must be told no, or one client gets
       the same message twice. */
    select case when app.crm_followup_sent(v_id, 'wamid.again', null) then 1 else 0 end into n_twice;

    /* 5 · A row whose moment has NOT come is invisible to the whole chain. */
    update public.crm_follow_ups
       set status = 'planned', done_at = null, due_at = now() + interval '1 hour' where id = v_id;
    select count(*)::int into n_future_queue from app.crm_followups_to_send(100) q where q.follow_up_id = v_id;
    select count(*)::int into n_future_tokens from app.crm_followup_tokens(v_id);

    raise exception using errcode = 'P0203', message = '203 rollback';
  exception when sqlstate 'P0203' then
    null;
  end;

  if n_queue <> 1 then raise exception '203 · the queue no longer offers a planned, overdue auto-send'; end if;
  if n_tokens <> 1 then raise exception '203 · crm_followup_tokens still refuses a row the queue offered'; end if;
  if n_settled <> 1 then raise exception '203 · crm_followup_sent still refuses a row the queue offered'; end if;
  if n_twice <> 0 then raise exception '203 · a settled follow-up could be settled again — a client would be messaged twice'; end if;
  if n_future_queue <> 0 then raise exception '203 · a follow-up due in an hour was offered to the sender'; end if;
  if n_future_tokens <> 0 then raise exception '203 · crm_followup_tokens answered for a row that is not due yet'; end if;

  raise notice '203 ✓ queue, tokens, attachments and settle all agree — and settling twice is refused';
end $chk$;
