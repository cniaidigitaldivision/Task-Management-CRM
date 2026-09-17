-- ============================================================================
-- 182 · RESUMING A SEQUENCE HAS TO STICK
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17, on the drawer's Follow-ups tab: Review reply · Reschedule ·
-- Stop, on a sequence paused because the client replied.
--
-- ⚠️⚠️ RESCHEDULE COULD NOT HAVE WORKED. 170's stop-condition pauses a sequence
-- when the client has sent ANY message since the sequence STARTED. That is right
-- the first time. But once a salesperson has read the reply and chosen to carry
-- on, the same reply is still "since it started" — so the next run of the engine
-- would pause it again at once, and the button would appear to work and quietly
-- undo itself. Nobody would have seen an error.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
-- `resumed_at`, stamped whenever a person resumes or reschedules. A reply only
-- pauses the chase if it arrived after that moment. Every other stop-condition —
-- closed lead, a stated no, a switched-off sequence, a dead quotation, a booked
-- visit — is untouched and still stops it regardless.
-- ============================================================================

alter table public.crm_lead_sequences
  add column resumed_at timestamptz;

comment on column public.crm_lead_sequences.resumed_at is
  'When a person last resumed or rescheduled this sequence. A client reply pauses it only if it arrived after this. 182.';

create or replace function app.crm_sequence_stop_reason(p_lead_sequence uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  r record;
begin
  select ls.id, ls.lead_id, ls.started_at, ls.resumed_at, ls.quotation_id,
         s.stop_on_reply, s.is_active,
         l.stage, l.whatsapp_consent
    into r
    from public.crm_lead_sequences ls
    join public.crm_sequences s on s.id = ls.sequence_id
    join public.crm_leads l on l.id = ls.lead_id
   where ls.id = p_lead_sequence;

  if not found then
    return 'the sequence no longer exists';
  end if;

  /* ⚠️ CLOSED FIRST, because it is the one that makes every other check moot. */
  if r.stage in ('won', 'lost') then
    return 'the lead is closed';
  end if;

  /* ⚠️ `false` STOPS IT; `NULL` DOES NOT, AND THAT IS NOT A LOOPHOLE. NULL means
     nobody has ever asked — 640 of 641 real leads. Treating it as a refusal would
     mean no sequence could ever run; treating it as consent is the incident in
     `docs/crm-ai/05-GUARDRAILS.md` §5. So it is neither: the SENDER refuses a
     NULL, and this function reports only a stated no. */
  if r.whatsapp_consent is false then
    return 'they asked not to be messaged';
  end if;

  if not r.is_active then
    return 'the sequence was switched off';
  end if;

  /* ⚠️ THE CLIENT REPLIED — the single most important rule in any chase engine.
     Measured from the moment the sequence STARTED, not from the last step: a
     reply that arrived while step two was pending still means somebody is
     talking to us, and firing step three at them is the behaviour that gets a
     business muted. */
  /* ⚠️ 182: AND SINCE IT WAS LAST RESUMED. A salesperson who has read the reply
     and chosen to carry on has answered it; without this the same old reply
     re-paused the sequence on the very next tick, and Resume did nothing. */
  if r.stop_on_reply and exists (
    select 1 from public.crm_lead_messages m
     where m.lead_id = r.lead_id
       and m.direction = 'inbound'
       and m.created_at >= r.started_at
       and (r.resumed_at is null or m.created_at > r.resumed_at)
  ) then
    return 'the client replied';
  end if;

  /* A chase for a quotation that has expired is an advertisement for a price we
     are no longer offering. */
  if r.quotation_id is not null and exists (
    select 1 from public.crm_quotations q
     where q.id = r.quotation_id
       and (q.status in ('expired', 'rejected', 'superseded')
            or (q.valid_until is not null
                and q.valid_until < (now() at time zone 'Asia/Karachi')::date))
  ) then
    return 'the quotation is no longer live';
  end if;

  /* ⚠️ ALREADY BOOKED. Somebody who has agreed to come does not need chasing to
     come; they need a reminder, which is a different sequence with a different
     purpose. */
  if exists (
    select 1 from public.crm_appointments a
     where a.lead_id = r.lead_id
       and a.status in ('scheduled', 'confirmed')
       and a.scheduled_at >= now()
  ) then
    return 'a visit is already booked';
  end if;

  return null;
end;
$fn$;

-- ============================================================================
-- SELF-CHECK — and it leaves nothing behind
-- ----------------------------------------------------------------------------
-- ⚠️ The fixtures are written inside an inner block that ends by RAISING, so
-- every row it wrote is rolled back; only the verdict survives. A self-check that
-- wrote to live leads and forgot to clean up is how 082 ate a real attendance row.
-- ============================================================================
do $$
declare
  v_lead   uuid;
  v_seq    uuid;
  v_ls     uuid;
  v_before text;
  v_after  text;
  v_again  text;
begin
  select l.id into v_lead
    from public.crm_leads l
   where l.is_test_data
     and l.stage not in ('won', 'lost')
     and l.whatsapp_consent is not false
     and not exists (select 1 from public.crm_lead_sequences ls
                      where ls.lead_id = l.id and ls.state in ('scheduled', 'active', 'paused'))
     and not exists (select 1 from public.crm_appointments a
                      where a.lead_id = l.id and a.status in ('scheduled', 'confirmed') and a.scheduled_at >= now())
   limit 1;
  if v_lead is null then
    raise exception '182 · no test lead free to check against — refusing to skip';
  end if;

  begin
    insert into public.crm_sequences (name, purpose, stop_on_reply, is_active, is_test_data)
    values ('182 self-check', 'no_response', true, true, true) returning id into v_seq;
    insert into public.crm_lead_sequences
      (lead_id, sequence_id, state, total_steps, started_at, paused_at, pause_reason)
    values (v_lead, v_seq, 'paused', 2, now() - interval '2 days', now() - interval '1 day', 'the client replied')
    returning id into v_ls;

    -- a reply yesterday, after the start
    insert into public.crm_lead_messages (lead_id, direction, kind, body, created_at, occurred_at)
    values (v_lead, 'inbound', 'text', '182 self-check', now() - interval '1 day', now() - interval '1 day');
    v_before := app.crm_sequence_stop_reason(v_ls);

    -- the salesperson reads it and resumes an hour ago
    update public.crm_lead_sequences set resumed_at = now() - interval '1 hour' where id = v_ls;
    v_after := app.crm_sequence_stop_reason(v_ls);

    -- and the client writes again after that
    insert into public.crm_lead_messages (lead_id, direction, kind, body, created_at, occurred_at)
    values (v_lead, 'inbound', 'text', '182 self-check', now() - interval '5 minutes', now() - interval '5 minutes');
    v_again := app.crm_sequence_stop_reason(v_ls);

    raise exception using errcode = 'P0182', message = '182 rollback';
  exception when sqlstate 'P0182' then
    null;
  end;

  if v_before is distinct from 'the client replied' then
    raise exception '182 · a reply since the start no longer pauses (got %)', v_before;
  end if;
  if v_after is not null then
    raise exception '182 · a reply the salesperson already resumed past still pauses (got %)', v_after;
  end if;
  if v_again is distinct from 'the client replied' then
    raise exception '182 · a NEW reply after resuming does not pause (got %)', v_again;
  end if;
  if exists (select 1 from public.crm_sequences where name = '182 self-check') then
    raise exception '182 · the self-check left its fixtures behind';
  end if;

  raise notice '182 · an old reply no longer undoes Resume; a new one still pauses; nothing left behind';
end $$;
