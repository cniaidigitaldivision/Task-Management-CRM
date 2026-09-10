-- ============================================================================
-- 120 · HANDING A LEAD TO SOMEBODY — Step 7 of docs/crm/08-TWELVE-STEPS.md
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-10: *"The manager will see which staff member is managing which
-- deals… Plus he can add or move some leads to the other salesperson. The system
-- will automatically, smartly and intelligently divide the leads to the
-- salesperson."*
--
-- And on what "intelligently" means, pressed: *"For example, one salesperson has
-- 2 leads. Definitely the person who has fewer leads will get the lead. Proper
-- intelligence, right?… You still have the equal distribution of leads."*
--
-- Correct, and it needed no defending. Distribution is arithmetic. What needs
-- outcomes to learn from is SCORING — "this lead is 80% likely to close" — and
-- that is Step 12. The two were conflated in an earlier note and are separated
-- here: this file divides work fairly, and it does so with a `count(*)` and an
-- `order by` that anybody can check.
--
-- ── ⚠️ THE RULE, AND THE TWO DECISIONS INSIDE IT ───────────────────────────
--
--   1 · Fewest OPEN leads wins.
--
--       ⚠️ OPEN, NOT LIFETIME, and this is the decision that matters. Counting
--       every lead a person has ever held would permanently punish whoever
--       closes fastest: somebody who worked fifty leads to Won and holds none
--       would sit at the bottom of the queue for ever, while a colleague sat on
--       five untouched ones and kept receiving more. `won` and `lost` are exits,
--       not progress — the same rule `lib/domain/crm-stages.ts` states.
--
--   2 · On a tie, whoever went longest without one.
--
--       Owner: *"if everyone has equal leads, then the main question arises. You
--       can decide to whom it will give it."* So: least recently assigned, and
--       somebody who has never had one goes first. It is fair, it is predictable,
--       and a salesperson can verify it from their own timeline.
--
--       ⚠️ READ FROM `crm_lead_activity`, which migration 116 already writes on
--       every owner change. No new bookkeeping column, and no second version of
--       the truth that could disagree with the timeline the manager reads.
--
--       ⚠️ RESPONSE TIME IS THE BETTER TIE-BREAK AND IS NOT USED YET. 116 stamps
--       `first_contacted_at` on every logged call, so the data is accumulating
--       from today — but there is none, and ranking people by a number computed
--       from nothing is exactly the confident noise `07-AI-PLAN.md` refuses.
--       When there are a few weeks of calls, this ORDER BY gains one clause.
--
-- ── ⚠️ AND THE MANAGER IS NOT IN THE ROTATION ──────────────────────────────
-- Owner: *"they have one sales manager and all other sales persons."* Automatic
-- distribution goes to salespeople; the manager can still be given a lead BY
-- HAND, because a manager who takes a difficult client personally is normal and
-- the rota should not fight it.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · WHO MAY HAND OUT A LEAD
-- ----------------------------------------------------------------------------
-- ⚠️ `owner_id` WAS DELIBERATELY LEFT OUT OF 116's COLUMN GRANT. This is the
-- migration that adds it, and it cannot simply be granted: with a plain grant
-- any salesperson could push their own difficult leads onto a colleague, and
-- `crm_leads_update` would allow it because the row is theirs.
--
-- PostgreSQL has no per-column policy, so the rule lives in a trigger. The grant
-- opens the column; the trigger decides who may actually move it.
-- ════════════════════════════════════════════════════════════════════════════
grant update (owner_id) on public.crm_leads to cni_app;

create or replace function app.crm_guard_reassign()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    /* ⚠️ `current_user_id() is null` IS THE IMPORTER, and it must pass. The cron
       runs with no session; a guard that refused it would block a re-import the
       moment anything touched owner_id. It never does today, and a rule that
       depends on that staying true is a trap. */
    if app.current_user_id() is not null and not app.crm_sees_all_leads() then
      raise exception
        'Only the sales manager or an Admin can hand a lead to somebody.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists crm_leads_guard_reassign on public.crm_leads;
create trigger crm_leads_guard_reassign
  before update on public.crm_leads
  for each row execute function app.crm_guard_reassign();


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · WHOSE TURN IT IS
-- ----------------------------------------------------------------------------
-- Returns one salesperson, or NULL when there is nobody to give a lead to —
-- which the caller must report rather than swallow. A silent no-op here would
-- look like "assigned" and leave the lead sitting unowned.
--
-- ⚠️ SECURITY DEFINER because it reads `users` and `departments` to decide, and
-- `users_select` shows a Member one row. It discloses nothing: the answer is a
-- single uuid the caller is about to be shown anyway.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_next_owner()
returns uuid
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select u.id
    from public.users u
    join public.departments d on d.id = u.department_id
   where d.key = 'sales'
     and u.is_active
     /* The manager runs the department; the rota is for the salespeople. */
     and u.department_role = 'member'
   order by
     /* 1 · Fewest OPEN leads. `won` and `lost` are exits — see the header. */
     (select count(*) from public.crm_leads l
       where l.owner_id = u.id and l.stage not in ('won', 'lost')) asc,
     /* 2 · Then whoever went longest without one. NULLS FIRST, so somebody who
        has never been given a lead is always ahead of somebody who has. */
     (select max(a.occurred_at) from public.crm_lead_activity a
       where a.kind = 'assigned' and (a.detail->>'to')::uuid = u.id) asc nulls first,
     /* 3 · And a stable tie-break, so two runs never disagree. */
     u.full_name
   limit 1
$$;

comment on function app.crm_next_owner() is
  'The salesperson whose turn it is (120): fewest OPEN leads, then longest '
  'without one. Excludes the sales manager. Arithmetic, not a model.';

grant execute on function app.crm_next_owner() to cni_app;


-- ── What the manager sees when deciding ────────────────────────────────────
-- The same arithmetic, for every salesperson, so the rota is a table anybody can
-- check rather than a number that appears from nowhere. `07-AI-PLAN.md`: *"a
-- conclusion nobody can reconstruct gets ignored the first time it disagrees
-- with somebody's gut."*
create or replace function app.crm_sales_roster()
returns table (
  user_id      uuid,
  full_name    text,
  avatar_url   text,
  is_manager   boolean,
  open_leads   bigint,
  total_leads  bigint,
  won_leads    bigint,
  last_given   timestamptz,
  /* ⚠️ NULL until somebody logs a call. Shown as "no calls yet", never as 0 —
     a zero-minute response time would read as instant. */
  median_response_minutes numeric
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select u.id, u.full_name, u.avatar_url,
         u.department_role = 'manager',
         (select count(*) from public.crm_leads l
           where l.owner_id = u.id and l.stage not in ('won', 'lost')),
         (select count(*) from public.crm_leads l where l.owner_id = u.id),
         (select count(*) from public.crm_leads l
           where l.owner_id = u.id and l.stage = 'won'),
         (select max(a.occurred_at) from public.crm_lead_activity a
           where a.kind = 'assigned' and (a.detail->>'to')::uuid = u.id),
         (select percentile_cont(0.5) within group (
                   order by extract(epoch from (l.first_contacted_at - l.submitted_at)) / 60.0)
            from public.crm_leads l
           where l.owner_id = u.id and l.first_contacted_at is not null)
    from public.users u
    join public.departments d on d.id = u.department_id
   where d.key = 'sales'
     and u.is_active
     /* ⚠️ Only for people who may see the whole pipeline. Definer bypasses RLS,
        so without this a salesperson could read their colleagues' figures. */
     and app.crm_sees_all_leads()
   order by u.department_role desc, u.full_name
$$;

grant execute on function app.crm_sales_roster() to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ RUNS AS `cni_app` UNDER REAL SESSIONS, and the salesperson's is the one
-- that matters — a check as Admin passes against a missing trigger and proves
-- nothing.
--
-- ⚠️ AND IT REMOVES ITS OWN ROWS BY ID. Migration 082 ate a live attendance row
-- with a tidy-up delete keyed on a date.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin   uuid;
  v_mgr     uuid;
  v_a       uuid;
  v_b       uuid;
  v_project uuid;
  v_ids     uuid[] := '{}';
  v_id      uuid;
  v_pick    uuid;
  n         integer;
begin
  select id into v_admin from public.users where role in ('admin','super_admin') and is_active order by created_at limit 1;
  select id into v_mgr   from public.users where lower(email) = 'bibaestore@gmail.com';
  select id into v_a     from public.users where lower(email) = 'habibaminhas989@gmail.com';
  select id into v_b     from public.users where lower(email) = 'cniaidigitaldivision@gmail.com';
  select id into v_project from public.projects where name = 'Chitral Royal Homes' limit 1;

  if v_admin is null or v_mgr is null or v_a is null or v_b is null or v_project is null then
    raise notice '120 · the sales team or Chitral is missing; assignment applied untested';
    return;
  end if;

  for n in 1..5 loop
    insert into public.crm_leads (project_id, source, external_id, full_name, submitted_at)
    values (v_project, 'manual', '120-selfcheck-' || n, '120 lead ' || n, now())
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  set local role cni_app;
  perform set_config('app.user_id', v_mgr::text, true);

  -- ── The manager hands out three to A ────────────────────────────────────
  update public.crm_leads set owner_id = v_a where id = any(v_ids[1:3]);

  -- 1 · Every one is logged by 116's trigger, with the manager as the actor.
  select count(*) into n from public.crm_lead_activity
   where kind = 'assigned' and actor_id = v_mgr and lead_id = any(v_ids[1:3]);
  if n <> 3 then
    raise exception '120 · handing out leads wrote % timeline rows, expected 3', n;
  end if;

  -- 2 · ⚠️ THE ROTA GIVES TO WHOEVER HOLDS FEWEST. A holds 3, B holds none.
  select app.crm_next_owner() into v_pick;
  if v_pick <> v_b then
    raise exception '120 · the rota picked the salesperson who already holds more';
  end if;

  -- ── Now set up the case that isolates OPEN from LIFETIME ────────────────
  --    A: 3 held, 2 closed  →  1 open, 3 lifetime
  --    B: 2 held, 0 closed  →  2 open, 2 lifetime
  --    Fewest OPEN says A. Fewest LIFETIME would say B. So the pick proves it.
  update public.crm_leads set owner_id = v_b where id = any(v_ids[4:5]);

  perform set_config('app.user_id', v_a::text, true);
  update public.crm_leads set stage = 'won'  where id = v_ids[1];
  update public.crm_leads set stage = 'lost', lost_reason = 'not_serious' where id = v_ids[2];

  perform set_config('app.user_id', v_mgr::text, true);

  -- 3 · ⚠️ CLOSED LEADS DO NOT COUNT, and BOTH exits are exits. Counting
  --     lifetime would put whoever closes fastest behind for ever.
  select app.crm_next_owner() into v_pick;
  if v_pick <> v_a then
    raise exception
      '120 · a closed lead is still being counted; whoever closes fastest would be punished for it';
  end if;

  -- ── The tie-break, on a level count ─────────────────────────────────────
  -- ⚠️ THE TIMESTAMPS HAVE TO BE SET BY HAND, and finding that out is worth
  --    recording: `now()` is TRANSACTION START TIME, so every `assigned` row
  --    written inside this one migration shares a single value. The first
  --    version of this check assigned to A and then to B and asserted that A
  --    was "longer without one" — both were equal to the microsecond, the
  --    ordering fell through to `full_name`, and the check failed against a
  --    function that was behaving correctly.
  --
  --    ⚠️ IT IS NOT A PRODUCTION PROBLEM, for a reason worth stating: a manager
  --    bulk-assigning twenty leads in one transaction also stamps them all
  --    identically, but the OPEN COUNT changes as each one lands — later
  --    statements see earlier ones — so the first ordering key does the work and
  --    the tie-break is never reached inside a batch.
  reset role;
  update public.crm_lead_activity
     set occurred_at = now() - interval '2 days'
   where kind = 'assigned' and (detail->>'to')::uuid = v_a and lead_id = any(v_ids);
  update public.crm_lead_activity
     set occurred_at = now() - interval '1 hour'
   where kind = 'assigned' and (detail->>'to')::uuid = v_b and lead_id = any(v_ids);

  set local role cni_app;
  perform set_config('app.user_id', v_mgr::text, true);

  -- Level them: A has 1 open, B has 2 — close one of B's.
  perform set_config('app.user_id', v_b::text, true);
  update public.crm_leads set stage = 'won' where id = v_ids[4];
  perform set_config('app.user_id', v_mgr::text, true);

  -- 4 · Both hold one open. A waited two days, B waited an hour → A.
  select app.crm_next_owner() into v_pick;
  if v_pick <> v_a then
    raise exception
      '120 · on a level count the rota ignored who had waited longest';
  end if;

  -- 5 · ⚠️ A SALESPERSON CANNOT HAND THEIR LEAD TO A COLLEAGUE. The whole
  --     reason owner_id needed a trigger and not just a grant.
  perform set_config('app.user_id', v_a::text, true);
  begin
    update public.crm_leads set owner_id = v_b where id = v_ids[3];
    raise exception '120 · a salesperson was allowed to push a lead onto a colleague';
  exception when insufficient_privilege then
    null;
  end;

  -- 6 · But they can still work it — 116's five columns are untouched.
  update public.crm_leads set stage = 'contacted' where id = v_ids[3];
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception '120 · a salesperson can no longer work their own lead';
  end if;

  -- 7 · ⚠️ AND CANNOT READ THE ROSTER. Definer bypasses RLS, so the guard is
  --     inside the function; without it a salesperson reads colleagues'
  --     response times and win counts.
  select count(*) into n from app.crm_sales_roster();
  if n <> 0 then
    raise exception '120 · a salesperson can read the whole sales roster';
  end if;

  -- 8 · The manager can, and sees all three of them.
  perform set_config('app.user_id', v_mgr::text, true);
  select count(*) into n from app.crm_sales_roster();
  if n <> 3 then
    raise exception '120 · the sales roster shows % people, expected 3', n;
  end if;

  -- 9 · ⚠️ AND THE MANAGER IS NEVER IN THE ROTATION, though they are on the
  --     roster. They can still be handed a lead by hand, which is the point.
  for n in 1..6 loop
    select app.crm_next_owner() into v_pick;
    if v_pick = v_mgr then
      raise exception '120 · the rota handed a lead to the sales manager';
    end if;
    if v_pick is null then
      raise exception '120 · the rota returned nobody while two salespeople are active';
    end if;
  end loop;

  reset role;

  -- ⚠️ BY ID. See the header note about migration 082.
  delete from public.crm_lead_activity where lead_id = any(v_ids);
  delete from public.crm_leads          where id = any(v_ids);

  raise notice '120 · the rota gives to whoever holds fewest OPEN leads, then whoever waited longest; the manager is excluded and a salesperson cannot reassign';
end $$;
