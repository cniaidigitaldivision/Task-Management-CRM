-- ============================================================================
-- 147 · WHERE A LEAD IS IN ITS FOLLOW-UP SEQUENCE
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-14, pointing at the supplied design: *"Add some dummy data so I
-- can see all these things in the Next Sequence column… Add some dummy sequences
-- and all that stuff."*
--
-- ── ⚠️ THIS IS THE STATE, NOT THE ENGINE ───────────────────────────────────
-- A sequence feature is a scheduler, a step table, message templates and a
-- worker. None of that is built, and none of it is what was asked for today —
-- what was asked for is that the column shows the real states so the screen can
-- be judged. So this stores WHERE a lead is, and nothing advances it yet.
--
-- That is a deliberate half, and it is the honest half: every value here was put
-- there by a person or a seed, so nothing on screen claims an automation ran.
-- When the engine lands it writes these same three columns and the desk does not
-- change at all.
--
-- ⚠️ THREE COLUMNS RATHER THAN ONE STRING. "Scheduled · 1/3" rendered from a
-- text blob cannot be filtered, counted or sorted, and the owner's own design
-- already has an "Active sequences (2)" tab that needs a count.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_sequence_state') then
    create type public.crm_sequence_state as enum (
      'not_started',  -- the default, and where all 650 leads are today
      'scheduled',    -- steps are queued, none sent yet
      'active',       -- part-way through
      'paused',       -- deliberately held, by a person
      'stopped'       -- ended early, usually because the lead replied or booked
    );
  end if;
end $$;

alter table public.crm_leads
  add column if not exists sequence_state public.crm_sequence_state
    not null default 'not_started',
  /* How far through. NULL for a sequence that has no steps yet — a `scheduled`
     lead legitimately has 0 of 3 done, which is not the same as "no sequence". */
  add column if not exists sequence_step  smallint,
  add column if not exists sequence_total smallint,
  /* Why it stopped, in the words the desk prints — "Booked", "Replied". Free
     text because the reasons are the sales team's, not ours to enumerate before
     they have named any. */
  add column if not exists sequence_note  text;

comment on column public.crm_leads.sequence_state is
  'Where this lead sits in its follow-up sequence. ⚠️ STATE ONLY — nothing '
  'advances it yet; the scheduler is not built. Migration 147.';

alter table public.crm_leads
  drop constraint if exists crm_leads_sequence_steps_sane;
alter table public.crm_leads
  add constraint crm_leads_sequence_steps_sane check (
    /* ⚠️ A step count cannot exceed its total, and neither can be negative.
       "Active · 4/3" is the kind of figure that makes somebody distrust the
       whole screen, and it costs one constraint to make impossible. */
    (sequence_step is null and sequence_total is null)
    or (
      sequence_total is not null
      and sequence_total > 0
      and sequence_step is not null
      and sequence_step >= 0
      and sequence_step <= sequence_total
    )
  );

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  n_leads  int;
  n_reset  int;
  bad      boolean;
  v_lead   uuid;
begin
  select count(*) into n_leads from public.crm_leads;

  -- 1 · ⚠️ EVERY EXISTING LEAD IS `not_started`, which is true rather than
  --     convenient: no sequence has ever run.
  select count(*) into n_reset from public.crm_leads where sequence_state = 'not_started';
  if n_reset <> n_leads then
    raise exception '147 · % of % leads are not "not_started" on the day the column was added',
      n_leads - n_reset, n_leads;
  end if;

  -- 2 · ⚠️ AND "4 of 3" IS REFUSED. Checked by actually attempting it inside a
  --     subtransaction, not by reading the constraint text.
  select id into v_lead from public.crm_leads limit 1;
  if v_lead is not null then
    bad := false;
    begin
      update public.crm_leads
         set sequence_state = 'active', sequence_step = 4, sequence_total = 3
       where id = v_lead;
      bad := true;
    exception when check_violation then
      null;  -- refused, which is the point
    end;
    if bad then
      raise exception '147 · a lead was allowed to be on step 4 of 3';
    end if;

    -- and a sane one is accepted, then rolled back
    begin
      update public.crm_leads
         set sequence_state = 'active', sequence_step = 2, sequence_total = 3
       where id = v_lead;
      update public.crm_leads
         set sequence_state = 'not_started', sequence_step = null, sequence_total = null
       where id = v_lead;
    end;
  end if;

  raise notice '147 · % leads carry a sequence state, all of them "not started"', n_leads;
end $$;
