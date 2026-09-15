-- ============================================================================
-- 162 · THE OUTCOME COLUMNS CAN ACTUALLY BE WRITTEN
-- ----------------------------------------------------------------------------
-- Reported by the owner, as a 500 on the Record Outcome form:
--
--     PostgresError: permission denied for table crm_leads
--
-- ⚠️ "PERMISSION DENIED" IS A GRANT, NEVER RLS. RLS fails CLOSED and SILENTLY —
-- an update it refuses touches zero rows and raises nothing. A refusal that
-- speaks is the privilege system, and the two are diagnosed in different places.
-- Reading this as a policy problem would have sent somebody into `crm_leads`'s
-- policies, which are correct.
--
-- ── WHAT ACTUALLY HAPPENED, AND IT IS MY OWN REGRESSION ────────────────────
-- Migration 116 deliberately revoked table-wide UPDATE and granted FIVE named
-- columns, with the reasoning written out: a salesperson may move a lead through
-- the funnel and may not edit what a stranger typed into Meta's form.
--
-- Migration 155 then added `last_outcome`, `last_outcome_at`,
-- `last_outcome_by_id` and `next_action_type` — and `recordOutcomeAction` writes
-- all four. The grant was never widened, so the form has been dead since 155.
--
-- ── ⚠️ WHY NO TEST CAUGHT IT, WHICH IS THE PART WORTH REMEMBERING ──────────
-- `scripts/check-add-lead.mjs` runs as a real salesperson and passes — because
-- everything it exercises goes through `app.crm_create_lead`, which is SECURITY
-- DEFINER and therefore runs with the FUNCTION OWNER's privileges. A definer
-- masks a missing grant completely.
--
-- `recordOutcomeAction` has no definer. It runs as `cni_app` and meets the
-- column grant head-on. So: a path that writes through a definer proves nothing
-- about a path that does not, and the only check that finds this is one that
-- performs the actual UPDATE under a real session — which is what this file ends
-- with.
--
-- ── ⚠️ `closed_at` IS NOT GRANTED, AND THAT IS DELIBERATE ──────────────────
-- 116 excluded it on purpose: *"stamped by the triggers above, so the
-- response-time figures cannot be doctored."* `crm_leads_close_stamp` sets it
-- when a stage becomes won or lost and clears it when a lead reopens.
--
-- `recordOutcomeAction` was writing it anyway — and writing it WRONG:
-- `closed_at = ${closing ? null : null}` is null on both branches, followed by a
-- second statement setting `now()`. Both writes are removed rather than
-- permitted; the trigger already did the job correctly and the grant stays
-- narrow.
-- ============================================================================

-- ⚠️ The five from 116 are restated. `grant update (…)` on named columns REPLACES
-- nothing — it adds — but listing the whole set is what makes this file readable
-- as the current truth rather than as a diff against a migration from August.
grant update (
  stage,
  temperature,
  lost_reason,
  next_action,
  next_action_at,
  owner_id,          -- Step 7: reassignment, guarded by its own trigger
  -- ── added by 155, and the reason this migration exists ──
  last_outcome,
  last_outcome_at,
  last_outcome_by_id,
  next_action_type
) on public.crm_leads to cni_app;

-- ============================================================================
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ IT PERFORMS THE WRITE, AS A REAL SALESPERSON, WITHOUT A DEFINER. Asking
-- `information_schema.column_privileges` would confirm the grant exists and
-- prove nothing about whether the statement the application actually sends is
-- allowed to run. This sends that statement.
-- ============================================================================
do $chk$
declare
  v_sales uuid; v_lead uuid;
  v_stage public.crm_stage; v_reason public.crm_lost_reason;
  v_outcome public.crm_outcome; v_at timestamptz; v_by uuid;
  v_kind public.crm_next_action_kind; v_action text; v_action_at timestamptz;
  v_closed timestamptz;
begin
  select l.id, l.owner_id into v_lead, v_sales
    from public.crm_leads l
    join public.projects p on p.id = l.project_id
   where p.name like '%[demo]' and l.owner_id is not null
     and l.stage not in ('won','lost')
   limit 1;

  if v_lead is null then
    raise notice '162 · no open demo lead with an owner — grant applied, nothing to measure';
    return;
  end if;

  select stage, lost_reason, last_outcome, last_outcome_at, last_outcome_by_id,
         next_action_type, next_action, next_action_at, closed_at
    into v_stage, v_reason, v_outcome, v_at, v_by, v_kind, v_action, v_action_at, v_closed
    from public.crm_leads where id = v_lead;

  -- 1 · ⚠️ THE EXACT STATEMENT `recordOutcomeAction` SENDS, as the salesperson.
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);

  update public.crm_leads
     set stage = 'qualified'::public.crm_stage,
         lost_reason = null,
         last_outcome = 'interested'::public.crm_outcome,
         last_outcome_at = now(),
         last_outcome_by_id = v_sales,
         next_action = 'Self-check 162',
         next_action_type = 'call'::public.crm_next_action_kind,
         next_action_at = now() + interval '1 day'
   where id = v_lead;

  reset role;

  if not exists (select 1 from public.crm_leads
                  where id = v_lead and last_outcome = 'interested') then
    raise exception '162 · the outcome write did not take effect';
  end if;

  -- 2 · ⚠️ AND THE TRIGGER STILL OWNS `closed_at`. Closing through the same
  --     narrow grant must stamp it WITHOUT the application touching the column.
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  update public.crm_leads
     set stage = 'lost'::public.crm_stage,
         lost_reason = 'no_answer'::public.crm_lost_reason
   where id = v_lead;
  reset role;

  if (select closed_at from public.crm_leads where id = v_lead) is null then
    raise exception '162 · closing a lead left closed_at null — the trigger is not stamping it';
  end if;

  -- 3 · ⚠️ AND THE COLUMNS 116 PROTECTED ARE STILL REFUSED. A grant written too
  --     wide would pass checks 1 and 2 and quietly hand a salesperson the right
  --     to edit what a stranger typed into Meta's form.
  declare bad boolean := false;
  begin
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);
    begin
      update public.crm_leads set full_name = 'Doctored' where id = v_lead;
      bad := true;
    exception when insufficient_privilege then null;
    end;
    reset role;
    if bad then
      raise exception '162 · a salesperson can now edit full_name — the grant is too wide';
    end if;
  end;

  -- Put the lead back exactly as it was.
  update public.crm_leads
     set stage = v_stage, lost_reason = v_reason, last_outcome = v_outcome,
         last_outcome_at = v_at, last_outcome_by_id = v_by, next_action_type = v_kind,
         next_action = v_action, next_action_at = v_action_at, closed_at = v_closed
   where id = v_lead;

  raise notice '162 · the outcome write succeeds as a salesperson, the trigger still stamps closed_at, and full_name is still refused';
end $chk$;
