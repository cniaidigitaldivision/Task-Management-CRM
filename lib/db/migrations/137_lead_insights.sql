-- ============================================================================
-- 137 · WHERE A LEAD'S AI READING IS KEPT
-- ----------------------------------------------------------------------------
-- Step 11 of the twelve, and step 6 of the nine. A two-line summary of what
-- somebody wants, three things to open a call with, and a drafted first message
-- the salesperson edits before sending.
--
-- ── ⚠️ CACHED, AND THE CACHE IS THE WHOLE COST CONTROL ─────────────────────
-- `07-AI-PLAN.md`: *"Summaries are cached on the row and regenerated only when
-- the lead changes. Generating on every page load is the difference between a
-- few dollars a month and a few hundred."* With 647 leads and a desk somebody
-- opens all day, that is not a rounding error.
--
-- So the reading is written once and re-read for free. `source_fingerprint` is
-- what decides when it is stale: a hash of the material facts — the answers,
-- the stage, how many notes and how much activity exist. A colleague opening
-- the same lead an hour later pays nothing; a lead that has genuinely moved on
-- offers a refresh.
--
-- ⚠️ AND IT IS NEVER GENERATED ON PAGE LOAD. A button, always. An automatic
-- call would spend money on every lead anybody glances at, including the 627
-- nobody has ever rung — which is precisely the set most likely to be scrolled
-- past.
--
-- ── ⚠️ ITS OWN TABLE, NOT COLUMNS ON `crm_leads` ───────────────────────────
-- `crm_leads` is written by the importer every fifteen minutes, for all 647
-- rows. Hanging AI text off it would put a wide, rarely-read text column in the
-- hottest write path in this CRM, and every import would carry it. A separate
-- row, joined only when somebody opens one lead, keeps the import narrow.
--
-- ── ⚠️ AND NOTHING HERE IS EVIDENCE ────────────────────────────────────────
-- This is a *suggestion*, generated from the record, and the screen says so.
-- It is deliberately NOT in `crm_lead_activity`, which is append-only and is
-- what the reports read: a model's guess must never end up counted as something
-- that happened.
-- ============================================================================

create table if not exists public.crm_lead_insights (
  lead_id            uuid primary key references public.crm_leads(id) on delete cascade,
  summary            text        not null,
  /* An array of short strings. jsonb rather than text[] to match how `answers`
     is already stored on the lead, so one shape travels the whole feature. */
  talking_points     jsonb       not null default '[]'::jsonb,
  draft_message      text,
  /* ⚠️ What it was generated FROM. Compared, not trusted: if the lead has moved
     since, the screen offers a refresh instead of quietly showing stale advice
     about a stage the lead has left. */
  source_fingerprint text        not null,
  model              text        not null,
  generated_at       timestamptz not null default now(),
  generated_by_id    uuid        references public.users(id) on delete set null
);

comment on table public.crm_lead_insights is
  'One AI reading per lead, cached. Regenerated only when source_fingerprint '
  'changes. Never written by the importer; never counted as activity. 137.';

alter table public.crm_lead_insights enable row level security;

/* ⚠️ THE SAME AUDIENCE AS THE LEAD ITSELF, EXPRESSED BY DELEGATION rather than
   by a second copy of the predicate. `crm_leads_select` is
   `crm_manages_project(...) OR (crm_in_project_department(...) AND owner_id = me)`,
   and restating that here would be two rules to keep in step — which migrations
   105, 121, 125, 129 and 130 have each demonstrated the cost of. An EXISTS over
   the lead inherits whatever that policy says today and whatever it says next. */
drop policy if exists crm_lead_insights_select on public.crm_lead_insights;
create policy crm_lead_insights_select on public.crm_lead_insights
  for select using (
    exists (select 1 from public.crm_leads l where l.id = crm_lead_insights.lead_id)
  );

drop policy if exists crm_lead_insights_write on public.crm_lead_insights;
create policy crm_lead_insights_write on public.crm_lead_insights
  for all using (
    exists (select 1 from public.crm_leads l where l.id = crm_lead_insights.lead_id)
  ) with check (
    exists (select 1 from public.crm_leads l where l.id = crm_lead_insights.lead_id)
  );

/* ⚠️ UPDATE AND DELETE ARE BOTH ALLOWED HERE, unlike the activity log and the
   stored reports. Those are evidence and are append-only on purpose. This is a
   cache: regenerating must be able to replace it, and a stale suggestion is
   worth less than no suggestion. */

grant select, insert, update, delete on public.crm_lead_insights to cni_app;

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  v_lead    uuid;
  v_owner   uuid;
  v_other   uuid;
  v_admin   uuid;
  n         int;
begin
  select id, owner_id into v_lead, v_owner
    from public.crm_leads where owner_id is not null limit 1;
  if v_lead is null then
    raise notice '137 · no assigned lead to check against — skipping';
    return;
  end if;

  select id into v_admin from public.users where role = 'admin' and is_active limit 1;
  select u.id into v_other from public.users u
   where u.is_active and u.id <> v_owner
     and u.role not in ('admin','super_admin')
     and u.department_id is distinct from (select department_id from public.users where id = v_owner)
   limit 1;

  /* Seed one, as the admin. */
  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);
  insert into public.crm_lead_insights (lead_id, summary, source_fingerprint, model)
  values (v_lead, '137 self-check', 'fp-1', 'test')
  on conflict (lead_id) do update set summary = excluded.summary;
  reset role;

  -- 1 · The lead's owner can read it.
  set local role cni_app;
  perform set_config('app.user_id', v_owner::text, true);
  select count(*) into n from public.crm_lead_insights where lead_id = v_lead;
  reset role;
  if n <> 1 then
    raise exception '137 · the owner of a lead cannot read its insight';
  end if;

  -- 2 · ⚠️ AND SOMEBODY WITH NO CLAIM ON THE LEAD CANNOT. The insight repeats
  --     what the lead says — the person's situation, in prose. If this leaked
  --     where the lead does not, the summary would be a way around the policy
  --     that protects the lead itself.
  if v_other is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_other::text, true);
    select count(*) into n from public.crm_lead_insights where lead_id = v_lead;
    reset role;
    if n <> 0 then
      raise exception '137 · somebody who cannot read the lead can read its AI summary';
    end if;
  end if;

  -- 3 · ⚠️ IT IS A CACHE, SO IT MUST BE REPLACEABLE. The activity log refuses
  --     updates by design; this must not, or a lead could never be re-read.
  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);
  update public.crm_lead_insights set summary = '137 replaced' where lead_id = v_lead;
  select count(*) into n from public.crm_lead_insights
   where lead_id = v_lead and summary = '137 replaced';
  reset role;
  if n <> 1 then
    raise exception '137 · a cached insight cannot be regenerated';
  end if;

  -- 4 · Clean up after the check.
  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);
  delete from public.crm_lead_insights where lead_id = v_lead;
  reset role;

  raise notice '137 · a lead''s AI reading is readable by exactly who may read the lead';
end $$;
