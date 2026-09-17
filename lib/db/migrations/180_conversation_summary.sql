-- ============================================================================
-- 180 · WHAT THE CONVERSATION HAS SAID SO FAR, KEPT
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17, on the Summary view: *"I will not add the summary. If I want
-- to add it I can add it on, but the AI will also summarize my chat. I want there
-- to be a summary of my chat that will be auto-summarized."*
--
-- That answers `docs/crm-ai/00-STATE-AND-TRACKER.md` open question 2 — may a
-- model read a WhatsApp conversation — for this purpose: yes. The thread goes to
-- the same provider Q18 already cleared for names and numbers.
--
-- ── ⚠️ STORED, BECAUSE `06-CONVERSATION-MEMORY.md` IS RIGHT ABOUT THE RISK ──
-- *"Re-summarising the whole thread on every reply is slow, expensive, and
-- different every time — so the same history would produce a different answer on
-- Tuesday than on Monday."* So the summary is written once and re-read for free,
-- and is only rewritten when the thread has actually moved: `source_fingerprint`
-- is the message count, the newest message and the note count. A salesperson
-- opening the same lead ten times a day pays for it once.
--
-- ── ⚠️ ITS OWN TABLE, NOT A ROW IN `crm_lead_notes` ────────────────────────
-- The same document's rule that makes the memory trustworthy: *"an agent-written
-- note and a salesperson-written note must be distinguishable at a glance."*
-- `crm_lead_notes.author_id` cannot say "a model", and putting generated text in
-- there would make every note in the table a question. This table is only ever
-- generated; `crm_lead_notes` is only ever typed by a person.
--
-- ── ⚠️ AND IT IS NOT EVIDENCE ──────────────────────────────────────────────
-- Not in `crm_lead_activity`, which the reports count, for the reason 137 gave:
-- a model's reading must never end up counted as something that happened. It is
-- a cache — replaceable, deletable, and wrong the moment a message arrives.
-- ============================================================================

create table public.crm_lead_conversation_summaries (
  lead_id            uuid primary key references public.crm_leads(id) on delete cascade,
  /* Two or three sentences: where this conversation stands. */
  overview           text        not null,
  /* ⚠️ THE OWNER'S FOUR HEADINGS, as {kind, text} pairs — *"I have told him this,
     I have heard this, and we are in agreement on this"* — plus what is still
     open. jsonb, to match `crm_lead_insights.talking_points`. */
  points             jsonb       not null default '[]'::jsonb
                     check (jsonb_typeof(points) = 'array'),
  /* ⚠️ WHAT IT WAS WRITTEN FROM. The screen compares these against the thread it
     already holds and says "3 new messages since" rather than presenting a
     summary that stops before the client's last reply as if it were current. */
  message_count      integer     not null check (message_count >= 0),
  last_message_id    uuid,
  note_count         integer     not null default 0 check (note_count >= 0),
  source_fingerprint text        not null,
  model              text        not null,
  generated_at       timestamptz not null default now(),
  generated_by_id    uuid        references public.users(id) on delete set null
);

comment on table public.crm_lead_conversation_summaries is
  'One AI summary of a lead''s conversation, in English, rewritten only when the thread moves. Never a note, never activity. 180.';

alter table public.crm_lead_conversation_summaries enable row level security;

/* ⚠️ DELEGATED TO THE LEAD, exactly as 137 does for the insight. The summary
   repeats the conversation in prose — what they can pay, what they objected to —
   so it must be visible to precisely the people who can see the lead, and a
   second copy of `crm_leads_select`'s predicate is how those two drift apart. */
create policy crm_lead_conversation_summaries_select on public.crm_lead_conversation_summaries
  for select using (
    exists (select 1 from public.crm_leads l where l.id = crm_lead_conversation_summaries.lead_id)
  );

create policy crm_lead_conversation_summaries_write on public.crm_lead_conversation_summaries
  for all using (
    exists (select 1 from public.crm_leads l where l.id = crm_lead_conversation_summaries.lead_id)
  ) with check (
    exists (select 1 from public.crm_leads l where l.id = crm_lead_conversation_summaries.lead_id)
  );

/* ⚠️ ALL FOUR, AND UPDATE IS NOT OPTIONAL. The write is an upsert, and an upsert
   needs an UPDATE policy AND an UPDATE grant or it fails with an error that does
   not mention either — see memory `upsert-needs-update-policy`. */
grant select, insert, update, delete on public.crm_lead_conversation_summaries to cni_app;

-- ============================================================================
-- SELF-CHECK — as `cni_app`, for EVERY active user, never as the owner
-- ----------------------------------------------------------------------------
-- ⚠️ EXHAUSTIVE, NOT ONE FIXTURE. The membership-predicate bug has shipped ten
-- times here, and every one would have passed a check run as an admin. So for
-- each active person this asks the only question that matters: does seeing the
-- summary match seeing the lead? A single mismatch anywhere refuses the commit.
-- ⚠️ AND IT FAILS RATHER THAN SKIPS if there is nothing to check against — a
-- check that prints a tick for a rule it never ran is worse than none.
-- ============================================================================
do $$
declare
  v_lead      uuid;
  v_owner     uuid;
  u           record;
  sees_lead   int;
  sees_sum    int;
  checked     int := 0;
  refused     int := 0;
begin
  select l.id, l.owner_id into v_lead, v_owner
    from public.crm_leads l
   where l.owner_id is not null
     and l.is_test_data
     and not exists (select 1 from public.crm_lead_conversation_summaries s where s.lead_id = l.id)
   limit 1;
  if v_lead is null then
    raise exception '180 · no assigned test lead to check against — refusing to skip the check';
  end if;

  -- The owner writes one, through RLS, as themselves.
  set local role cni_app;
  perform set_config('app.user_id', v_owner::text, true);
  insert into public.crm_lead_conversation_summaries
    (lead_id, overview, message_count, source_fingerprint, model, generated_by_id)
  values (v_lead, '180 self-check', 0, 'fp-180', 'test', v_owner);
  -- 1 · ⚠️ AND CAN REPLACE IT — the upsert path. A summary that cannot be
  --     rewritten is stale the moment the client replies.
  insert into public.crm_lead_conversation_summaries
    (lead_id, overview, message_count, source_fingerprint, model, generated_by_id)
  values (v_lead, '180 replaced', 1, 'fp-180b', 'test', v_owner)
  on conflict (lead_id) do update
    set overview = excluded.overview, source_fingerprint = excluded.source_fingerprint;
  reset role;

  -- 2 · Everybody: sight of the summary is exactly sight of the lead.
  for u in select id, full_name from public.users where is_active loop
    set local role cni_app;
    perform set_config('app.user_id', u.id::text, true);
    select count(*) into sees_lead from public.crm_leads where id = v_lead;
    select count(*) into sees_sum
      from public.crm_lead_conversation_summaries where lead_id = v_lead;
    reset role;

    if sees_lead <> sees_sum then
      raise exception '180 · % sees the lead % time(s) but its summary % time(s)',
        u.full_name, sees_lead, sees_sum;
    end if;
    checked := checked + 1;

    -- 3 · ⚠️ AND SOMEBODY WHO CANNOT SEE THE LEAD CANNOT WRITE ITS SUMMARY
    --     EITHER. Otherwise this table is a way to plant text on a colleague's
    --     lead that its owner then reads as the conversation.
    if sees_lead = 0 then
      begin
        set local role cni_app;
        perform set_config('app.user_id', u.id::text, true);
        update public.crm_lead_conversation_summaries
           set overview = '180 · planted' where lead_id = v_lead;
        reset role;
      exception when others then
        reset role;
      end;
      refused := refused + 1;
    end if;
  end loop;

  if (select overview from public.crm_lead_conversation_summaries where lead_id = v_lead)
     <> '180 replaced' then
    raise exception '180 · somebody who cannot see the lead rewrote its summary';
  end if;
  if refused = 0 then
    raise exception '180 · every active user can see the test lead — the refusal was never exercised';
  end if;

  -- Clean up, as the owner.
  set local role cni_app;
  perform set_config('app.user_id', v_owner::text, true);
  delete from public.crm_lead_conversation_summaries where lead_id = v_lead;
  reset role;

  raise notice '180 · summary visibility matches lead visibility for all % active users; % could not touch it',
    checked, refused;
end $$;
