-- ============================================================================
-- 154 · WHY THIS PERSON GOT THIS LEAD
-- ----------------------------------------------------------------------------
-- The owner's Phase 1 spec asks for it twice — *"Record why the person was
-- selected"* and *"Record the assignment reason in the activity log"* — and it
-- is the single most useful thing an automatic rota can leave behind.
--
-- ── ⚠️ A ROTA NOBODY CAN INTERROGATE IS A ROTA PEOPLE STOP TRUSTING ────────
-- The four signals already work (133). What is missing is the sentence. When
-- Sahad asks why Sarah got the Chitral enquiry, "the algorithm decided" is the
-- answer that ends with somebody keeping their own spreadsheet. This table
-- stores the figures the decision was made on, at the moment it was made:
--
--     eligible        3 of 5 considered
--     chosen          Sarah
--     because         at work · 12 weighted open · 6 min median · 42 min idle
--
-- ⚠️ AND THE NUMBERS ARE FROZEN, NOT RE-DERIVED. Recomputing "why" a week later
-- gives a different answer — the workload has moved — and an audit trail that
-- changes when you read it is not one.
--
-- ── ⚠️ ONE ROW PER ASSIGNMENT, INCLUDING THE MANUAL ONES ───────────────────
-- A manager sharing a lead out by hand is an assignment too, and the history is
-- worth as much: "reassigned by the manager, no reason given" is itself a fact
-- somebody may need.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_assignment_rule') then
    create type public.crm_assignment_rule as enum (
      'rota',            -- the four signals chose
      'existing_owner',  -- a returning enquiry stayed where it was
      'manual',          -- a person picked
      'handoff',         -- the owner asked to pass it on, and it was approved
      'import'           -- arrived already owned
    );
  end if;
end $$;

create table if not exists public.crm_lead_assignments (
  id        uuid primary key default gen_random_uuid(),
  lead_id   uuid not null references public.crm_leads (id) on delete cascade,

  /* ⚠️ `set null`, NOT cascade, on BOTH. Deleting a person must never delete the
     record that they once held a lead — that is exactly the history somebody
     needs when a colleague has left and a client asks who they spoke to. */
  to_user_id   uuid references public.users (id) on delete set null,
  from_user_id uuid references public.users (id) on delete set null,
  decided_by_id uuid references public.users (id) on delete set null,

  rule      public.crm_assignment_rule not null default 'rota',

  /* ⚠️ THE FIGURES AT THE MOMENT OF THE DECISION, frozen. Shape, per the four
     signals: { eligible, considered, at_work, weighted_open, median_minutes,
     minutes_since_last, skipped: [{ who, why }] }. jsonb rather than columns
     because the signals will change and an audit row must keep the shape it was
     written with. */
  reason    jsonb,
  /* The same thing in a sentence, for a screen that has no room for the object.
     ⚠️ Written at the same time from the same values — never regenerated. */
  reason_text text,

  assigned_at timestamptz not null default now(),

  constraint crm_lead_assignments_moved check (
    to_user_id is not null or from_user_id is not null
  )
);

create index if not exists crm_lead_assignments_lead_idx
  on public.crm_lead_assignments (lead_id, assigned_at desc);
create index if not exists crm_lead_assignments_user_idx
  on public.crm_lead_assignments (to_user_id, assigned_at desc);

comment on table public.crm_lead_assignments is
  'Every time a lead changed hands, and WHY — the rota''s figures frozen at the '
  'moment it decided. A rota nobody can interrogate is one people stop trusting. '
  'Migration 154.';

alter table public.crm_lead_assignments enable row level security;

do $$
begin
  /* Readable by whoever can read the lead — a salesperson can see why they were
     given their own lead, which is the point. */
  if not exists (select 1 from pg_policy where polname = 'crm_lead_assignments_select') then
    create policy crm_lead_assignments_select on public.crm_lead_assignments
      for select to cni_app
      using (exists (select 1 from public.crm_leads l where l.id = lead_id));
  end if;

  /* ⚠️ INSERT ONLY, AND NO UPDATE OR DELETE POLICY FOR ANY SESSION. This is an
     audit trail; a history that can be edited answers nothing. The same stance
     as `crm_lead_activity` (111) and `crm_lead_messages` (138).

     ⚠️ AND THE WRITE IS THE SERVER'S, not the salesperson's — the rota runs in a
     definer. A row inserted by hand would be a claim about a decision nobody
     made, so this policy admits only a manager or an Admin. */
  if not exists (select 1 from pg_policy where polname = 'crm_lead_assignments_insert') then
    create policy crm_lead_assignments_insert on public.crm_lead_assignments
      for insert to cni_app
      with check (
        exists (
          select 1 from public.crm_leads l
           where l.id = lead_id and app.crm_manages_project(l.project_id)
        )
      );
  end if;
end $$;

grant select, insert on public.crm_lead_assignments to cni_app;
revoke all on public.crm_lead_assignments from anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- BACKFILL — the assignments that already happened
-- ----------------------------------------------------------------------------
-- ⚠️ `rule = 'import'` AND NO REASON, WHICH IS THE TRUTH. 21 leads already have
-- an owner and nobody recorded why. Inventing a plausible rota reason for them
-- would put fiction into an audit table on its first day — the worst possible
-- thing to find there later. "We do not know" is a fact; a fabricated figure is
-- not.
-- ════════════════════════════════════════════════════════════════════════════
insert into public.crm_lead_assignments (lead_id, to_user_id, rule, reason_text, assigned_at)
select l.id, l.owner_id, 'import',
       'Assigned before the rota kept records. No reason was captured at the time.',
       coalesce(l.imported_at, l.submitted_at, now())
  from public.crm_leads l
 where l.owner_id is not null
   and not exists (
     select 1 from public.crm_lead_assignments a where a.lead_id = l.id
   );

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  v_lead uuid; v_owner uuid; v_mgr uuid; v_sales uuid;
  n int; bad boolean;
begin
  select count(*) into n from public.crm_lead_assignments;
  raise notice '154 · % assignment row(s) after the backfill', n;

  select l.id, l.owner_id into v_lead, v_owner
    from public.crm_leads l where l.owner_id is not null limit 1;
  if v_lead is null then
    raise notice '154 · no owned lead — table created, nothing to measure';
    return;
  end if;

  -- 1 · ⚠️ EVERY OWNED LEAD HAS A HISTORY NOW. A lead with an owner and no
  --     assignment row is a lead nobody can explain.
  select count(*) into n
    from public.crm_leads l
   where l.owner_id is not null
     and not exists (select 1 from public.crm_lead_assignments a where a.lead_id = l.id);
  if n <> 0 then
    raise exception '154 · % owned leads have no assignment history', n;
  end if;

  -- 2 · ⚠️ AND THE BACKFILL DID NOT INVENT A REASON. If a `rota` row appeared
  --     with figures nobody computed, the table would be lying on day one.
  select count(*) into n from public.crm_lead_assignments
   where rule = 'import' and reason is not null;
  if n <> 0 then
    raise exception '154 · the backfill fabricated % rota reasons', n;
  end if;

  -- 3 · ⚠️ A SALESPERSON CANNOT WRITE THEIR OWN ASSIGNMENT. Otherwise anybody
  --     could claim the rota gave them a lead.
  select u.id into v_sales
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active
     and u.department_role is distinct from 'manager'::public.department_role
   limit 1;

  if v_sales is not null then
    bad := false;
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);
    begin
      insert into public.crm_lead_assignments (lead_id, to_user_id, rule)
      values (v_lead, v_sales, 'rota');
      bad := true;
    exception when insufficient_privilege or check_violation then null;
    end;
    reset role;
    if bad then
      raise exception '154 · a salesperson wrote their own assignment record';
    end if;
  end if;

  -- 4 · ⚠️ AND NOBODY CAN REWRITE HISTORY. There is no UPDATE policy AND no
  --     UPDATE grant, so the attempt is refused at the privilege level — which
  --     is a harder stop than RLS and fails LOUDLY rather than silently changing
  --     nothing. Both outcomes pass; what must not happen is a successful edit.
  if v_owner is not null then
    bad := false;
    begin
      set local role cni_app;
      perform set_config('app.user_id', v_owner::text, true);
      update public.crm_lead_assignments set reason_text = 'edited' where lead_id = v_lead;
      get diagnostics n = row_count;
      reset role;
      if n <> 0 then bad := true; end if;
    exception when insufficient_privilege then
      /* Refused by the grant. Reset the role the exception skipped past. */
      reset role;
    end;
    if bad then
      raise exception '154 · an assignment record was edited after the fact';
    end if;
  end if;

  raise notice '154 · every owned lead has a history, the backfill invented nothing, and nobody can edit it';
end $$;
