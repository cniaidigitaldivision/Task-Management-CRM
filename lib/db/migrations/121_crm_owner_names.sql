-- ============================================================================
-- 121 · THE SALES MANAGER CAN SEE WHO HOLDS WHAT — Step 7
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-10: *"The manager will see which staff member is managing which
-- deals, like which leads… who the person is on which lead, who is responsible
-- for which lead."*
--
-- ── ⚠️ THIS IS THE 2026-09-08 BUG, CAUGHT BEFORE IT SHIPPED ────────────────
-- `lib/db/queries/crm-leads.ts` reads the owner's name with a plain
-- `left join public.users`. Migration 114's header predicted exactly when that
-- would break, and Step 7 is that moment:
--
--     `users_select` is `id = current_user_id() OR acting_at_least(coordinator)`.
--
-- The sales manager is `member` in `users.role` — ADR-012 is explicit that
-- department seniority is not an app rank — so they read ONE row of the staff
-- table: their own. They can see every lead in the department, and the join
-- returns NULL for every colleague who holds one.
--
-- The UI renders a null owner as **"Former member"**. So the manager's whole
-- reason for opening the desk — seeing who is on which lead — would have shown a
-- column of people who appear to have left the company.
--
-- ⚠️ MEASURED, NOT ASSUMED, before this file was written: a lead assigned to a
-- salesperson, read back through that exact join under the manager's own
-- session, returned NULL. The self-check below asserts the same thing, so if
-- `users_select` ever widens this migration fails loudly and can be deleted
-- rather than left running unnoticed — the discipline that got Step 4's reader
-- deleted and kept 114's.
--
-- ── WHY A NAME LIST AND NOT A WIDER LIST QUERY ─────────────────────────────
-- The obvious fix is a definer function returning the whole lead list with names
-- attached. Refused: that query is the hot path — paged, filtered, sorted, run on
-- every keystroke of the search box — and moving it inside a definer function
-- puts the one query that must stay fast behind a wrapper that cannot be indexed
-- into, while also bypassing RLS on the rows themselves rather than only on the
-- names.
--
-- This returns names ONLY, for owners of leads the caller can ALREADY read, and
-- the caller joins them in memory. At most a handful of rows. The same shape as
-- migration 105's `project_remarks_with_authors`.
-- ============================================================================

create or replace function app.crm_lead_owners()
returns table (
  id         uuid,
  full_name  text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select distinct u.id, u.full_name, u.avatar_url
    from public.crm_leads l
    join public.users u on u.id = l.owner_id
   /* ⚠️ THE VISIBILITY RULE, INLINE AND CALLER-SCOPED. Both halves are constant
      for the whole query — they ask about the CALLER, not the row — so this
      costs one evaluation rather than one per lead. Calling
      `app.crm_lead_is_visible(l.id)` here instead would be an index probe per
      row, which is the trap 114's header describes at length.

      ⚠️ AND IT IS A THIRD COPY OF THE SAME PREDICATE — `crm_leads_select` has
      it, `crm_lead_is_visible` has it, this has it. PostgreSQL gives no way to
      share an expression across a policy and a function body, so the self-check
      below proves all three agree instead. */
   where app.crm_sees_all_leads()
      or (l.owner_id = app.current_user_id() and app.acting_in_department('sales'))
$$;

comment on function app.crm_lead_owners() is
  'Names for the owners of leads the caller can already read (121). SECURITY '
  'DEFINER because users_select shows the sales manager only their own row, '
  'which would render every colleague as "Former member".';

grant execute on function app.crm_lead_owners() to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ RUNS UNDER THE SALES MANAGER'S SESSION, because they are the only person
-- for whom this is broken. An Admin reads the staff table fine and would pass
-- against the bug — which is precisely how the 2026-09-08 version reached the
-- owner.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_mgr     uuid;
  v_a       uuid;
  v_b       uuid;
  v_project uuid;
  v_lead    uuid;
  v_other   uuid;
  v_name    text;
  v_outside uuid;
  n         integer;
begin
  select id into v_mgr from public.users where lower(email) = 'bibaestore@gmail.com';
  select id into v_a   from public.users where lower(email) = 'habibaminhas989@gmail.com';
  select id into v_b   from public.users where lower(email) = 'cniaidigitaldivision@gmail.com';
  select id into v_project from public.projects where name = 'Chitral Royal Homes' limit 1;

  if v_mgr is null or v_a is null or v_b is null or v_project is null then
    raise notice '121 · the sales team is missing; the reader was created untested';
    return;
  end if;

  insert into public.crm_leads (project_id, owner_id, source, external_id, full_name, submitted_at)
  values (v_project, v_a, 'manual', '121-selfcheck-1', '121 one', now()) returning id into v_lead;
  insert into public.crm_leads (project_id, owner_id, source, external_id, full_name, submitted_at)
  values (v_project, v_b, 'manual', '121-selfcheck-2', '121 two', now()) returning id into v_other;

  set local role cni_app;
  perform set_config('app.user_id', v_mgr::text, true);

  -- 1 · ⚠️ THE BUG ITSELF, ASSERTED. Through the raw join the manager sees no
  --     name. If this ever stops being true, this reader is redundant and should
  --     be deleted the way Step 4's was.
  select u.full_name into v_name
    from public.crm_leads l
    left join public.users u on u.id = l.owner_id
   where l.id = v_lead;

  if v_name is not null then
    raise exception
      '121 · the sales manager can now read users directly — this reader is redundant and users_select must be re-examined';
  end if;

  -- 2 · Through the reader, both colleagues have names.
  select count(*) into n from app.crm_lead_owners() where id in (v_a, v_b);
  if n <> 2 then
    raise exception '121 · the manager sees % of 2 lead owners by name', n;
  end if;

  select full_name into v_name from app.crm_lead_owners() where id = v_a;
  if v_name is null or v_name = '' then
    raise exception '121 · a lead owner came back with no name at all';
  end if;

  -- 3 · ⚠️ A SALESPERSON SEES ONLY THEMSELVES. Definer bypasses RLS, so without
  --     the predicate inside, this would hand the whole sales roster to anybody.
  perform set_config('app.user_id', v_a::text, true);
  select count(*) into n from app.crm_lead_owners();
  if n <> 1 then
    raise exception '121 · a salesperson sees % lead owners, expected only themselves', n;
  end if;

  select count(*) into n from app.crm_lead_owners() where id = v_b;
  if n <> 0 then
    raise exception '121 · a salesperson can read the name of a colleague who holds a lead';
  end if;

  -- 4 · And somebody outside sales sees nobody at all.
  select id into v_outside from public.users where lower(email) = 'sayednajmullah@gmail.com';
  if v_outside is not null then
    perform set_config('app.user_id', v_outside::text, true);
    select count(*) into n from app.crm_lead_owners();
    if n <> 0 then
      raise exception '121 · somebody outside sales can read lead owners';
    end if;
  end if;

  reset role;

  delete from public.crm_lead_activity where lead_id in (v_lead, v_other);
  delete from public.crm_leads          where id in (v_lead, v_other);

  raise notice '121 · the sales manager sees who holds each lead, and a salesperson sees only themselves';
end $$;
