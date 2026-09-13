-- ============================================================================
-- 142 · A REPLY LANDS IN THE THREAD IT IS REPLYING TO
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-13: *"Messaging messages are sending but when I reply back from
-- there, it is not receiving in a chat."*
--
-- The reply WAS received. The webhook is fine. It was filed against a different
-- lead than the one the conversation is happening in:
--
--     outbound  'utdfg'   12:51:07Z   → Mohsin Testing     +923121531511
--     outbound  'good'    12:51:16Z   → Mohsin Testing     +923121531511
--     inbound   'I know'  12:51:36Z   → Mohsin Testing 2   +923121531511   ⚠️
--
-- Two leads, one number. 138's resolver ordered by "open first, then newest
-- `submitted_at`", so every inbound went to whichever of the siblings enquired
-- most recently — regardless of which one somebody was actually talking to. The
-- message is in the database and invisible on the screen that sent to it.
--
-- ── ⚠️ THIS IS NOT A DEMO-DATA ARTEFACT ────────────────────────────────────
-- About 18 of the 615 real leads share a number with another. One person
-- enquiring twice is ordinary — it is the entire reason the record has an
-- "also enquired" panel. So this would have happened on Chitral's pipeline too,
-- silently, and the salesperson would have reported the customer never replied.
--
-- ── WHY NOT MERGE THE THREAD ACROSS SIBLINGS ───────────────────────────────
-- Showing one conversation per NUMBER rather than per lead is tempting: it is
-- one human and one WhatsApp chat. It was rejected because the two siblings can
-- have different owners, and the owner's rule is explicit —
-- *"The lead, which is attached to salesperson 1, will always reply to him."*
-- Merging would put one salesperson's conversation on another's screen, which is
-- the exact thing that rule forbids.
--
-- ── THE RULE, AND THE WRONG VERSION OF IT I WROTE FIRST ────────────────────
-- A reply belongs to the thread it is replying to. The obvious reading of that
-- is "the sibling with the most recent message wins" — and it is wrong, because
-- an INBOUND message is a message. Once one reply lands on the wrong sibling,
-- that sibling now holds the most recent message and every following reply
-- follows it there. The bug becomes self-sustaining, and the self-check passes
-- while it happens, because the check and the rule share the same mistake.
--
-- ⚠️ SO THE ANCHOR IS THE LAST THING **WE** SAID. A customer is replying to an
-- outbound message; that message belongs to exactly one lead, and that is the
-- lead the reply belongs to. Only an outbound moves the anchor — inbound follows
-- it. Where nobody has ever replied to this person, there is nothing to be a
-- reply TO, and 138's "open, then newest" decides it as before.
-- ============================================================================

create or replace function app.crm_lead_for_number(p_e164 text)
returns uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select l.id
    from public.crm_leads l
    /* ⚠️ OUTBOUND ONLY. The last thing WE said is what a reply is replying to.
       Counting inbound here makes the rule self-sustaining in the wrong place:
       one misfiled reply gives that sibling the newest message, and every
       reply after it follows. NULL for a lead we have never written to. */
    left join lateral (
      select max(m.occurred_at) as last_sent
        from public.crm_lead_messages m
       where m.lead_id = l.id
         and m.direction = 'outbound'
    ) ours on true
   where l.phone_e164 = p_e164
   order by
     /* ⚠️ `nulls last`, not the default — in `desc` order a NULL sorts FIRST in
        Postgres, so without this every reply would go to the sibling nobody has
        ever written to. That is this bug with the sign flipped. */
     ours.last_sent desc nulls last,
     (l.stage not in ('won','lost')) desc,   -- then an open lead
     l.submitted_at desc,                    -- then the most recent enquiry
     l.id                                    -- and a stable tiebreak
   limit 1
$$;

comment on function app.crm_lead_for_number(text) is
  'The lead a WhatsApp number belongs to: the sibling we most recently SENT to, '
  'because that is the message a reply is replying to. Inbound does not move the '
  'anchor. Falls back to newest OPEN lead, as 138 had it. ~18 of 615 leads share '
  'a number. Migration 142.';

revoke all on function app.crm_lead_for_number(text) from public;
grant execute on function app.crm_lead_for_number(text) to cni_app;

-- ============================================================================
-- SELF-CHECK — against the real rows that caused it.
-- ============================================================================
do $$
declare
  v_num      text;
  v_sent_to  uuid;   -- the sibling WE last sent to
  v_newest   uuid;   -- the sibling with the newest message of any kind
  v_picked   uuid;
  v_silent   uuid;
  n_share    int;
begin
  /* A number more than one lead shares, with an outbound on it — the shape the
     owner hit. */
  select l.phone_e164 into v_num
    from public.crm_leads l
   where l.phone_e164 is not null
   group by l.phone_e164
  having count(*) > 1
     and exists (
       select 1 from public.crm_lead_messages m
        join public.crm_leads l2 on l2.id = m.lead_id
       where l2.phone_e164 = l.phone_e164 and m.direction = 'outbound')
   limit 1;

  if v_num is null then
    raise notice '142 · no shared number with an outbound on it — resolver replaced, nothing to measure';
    return;
  end if;

  select m.lead_id into v_sent_to
    from public.crm_lead_messages m
    join public.crm_leads l on l.id = m.lead_id
   where l.phone_e164 = v_num and m.direction = 'outbound'
   order by m.occurred_at desc limit 1;

  select m.lead_id into v_newest
    from public.crm_lead_messages m
    join public.crm_leads l on l.id = m.lead_id
   where l.phone_e164 = v_num
   order by m.occurred_at desc limit 1;

  v_picked := app.crm_lead_for_number(v_num);

  -- 1 · ⚠️ THE RULE: the reply goes where we last wrote.
  if v_picked is distinct from v_sent_to then
    raise exception '142 · a reply on % lands on %, but we last wrote to %',
      v_num, v_picked, v_sent_to;
  end if;

  -- 2 · ⚠️ AND THE CHECK THAT CATCHES THE VERSION I WROTE FIRST. Where a
  --     misfiled INBOUND is the newest message, that sibling must NOT win —
  --     otherwise the first mistake pins every reply after it.
  if v_newest is distinct from v_sent_to and v_picked = v_newest then
    raise exception '142 · an inbound message moved the anchor to % — the bug is self-sustaining',
      v_newest;
  end if;

  -- 3 · ⚠️ AND A SIBLING WE HAVE NEVER WRITTEN TO MUST NOT WIN. This is the
  --     `nulls last` clause; without it every reply goes to the silent sibling.
  select l.id into v_silent
    from public.crm_leads l
   where l.phone_e164 = v_num
     and l.id <> v_sent_to
     and not exists (
       select 1 from public.crm_lead_messages m
        where m.lead_id = l.id and m.direction = 'outbound')
   limit 1;

  if v_silent is not null and v_picked = v_silent then
    raise exception '142 · NULL last_sent sorted first — every reply would go to a silent sibling';
  end if;

  select count(*) into n_share from public.crm_leads where phone_e164 = v_num;

  raise notice '142 · a reply on % (% leads share it) lands on the lead we last wrote to', v_num, n_share;
end $$;
