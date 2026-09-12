-- ============================================================================
-- 114 · A NOTE AND A TIMELINE ENTRY SAY WHO — Step 5 of docs/crm/08-TWELVE-STEPS.md
-- ----------------------------------------------------------------------------
-- The lead detail shows the note thread and the activity timeline. Both name a
-- person, and naming a person from a join against `public.users` is the bug this
-- codebase has already shipped once — migration 105, the remarks modal calling
-- live colleagues "Former member".
--
-- ── ⚠️ WHY THIS IS *NOT* THE CASE STEP 4 PROVED REDUNDANT ──────────────────
-- Step 4 wrote a reader for the lead LIST's owner column, its self-check proved
-- it unnecessary, and it was deleted rather than shipped unused. The reasoning
-- was sound and it does not carry over:
--
--     a Member only ever sees leads ASSIGNED TO THEM, so the owner of every
--     lead they can see IS them, so that join reads their own users row.
--
-- A note author and an activity actor are somebody ELSE by design. An Admin
-- assigns a lead to a salesperson; the `assigned` row's actor is the Admin, and
-- the salesperson can read that row — `crm_lead_activity_select` grants it,
-- because the lead is theirs. The join to `users` then returns NULL, because
-- `users_select` is:
--
--     id = app.current_user_id() OR app.acting_at_least('team_coordinator')
--
-- and the screen renders a null person as a former member. Same failure, a
-- different table, and this time the policies do not rule it out.
--
-- ⚠️ IT IS UNREACHABLE TODAY AND THAT IS NOT A REASON TO WAIT. `/leads` is
-- Admin-only (app/(app)/leads/layout.tsx), and an Admin reads the staff table
-- fine — so nothing is broken on screen this afternoon. But that floor is
-- documented as the narrow start and Step 7 is what widens it. A safety that
-- holds only because of a floor scheduled to move is a bug with a date on it,
-- and the self-check below asserts the bug is REAL rather than assuming it: if
-- a Member can read an author's name directly, this migration fails and these
-- functions should be deleted the way Step 4's was.
--
-- ── ⚠️ WHY THE POLICY IS NOT REWRITTEN TO SHARE THE PREDICATE ──────────────
-- The obvious tidy — have `crm_leads_select` call `app.crm_lead_is_visible` so
-- there is one definition — is refused deliberately. That policy is evaluated
-- once PER ROW, and today it is a row-local expression: `owner_id` is a column
-- already in hand. Routing it through a function that looks the row up BY ID
-- turns one comparison into an index probe on every one of 615 rows, on the
-- hot path of the only query this CRM will ever run at volume.
--
-- So this is a deliberate second copy of the same rule, for the by-id case, and
-- the self-check below proves the two AGREE — coordinator, assigned member and
-- unassigned member — rather than trusting that they still do.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · MAY THE CALLER READ THIS LEAD?
-- ----------------------------------------------------------------------------
-- ⚠️ SECURITY DEFINER, and it has to be. It is called from inside the definer
-- readers below, where RLS is already bypassed — an invoker function there would
-- run as the definer too and answer for the wrong person. Reading `crm_leads`
-- with RLS off is also what stops this recursing when the answer is "no".
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_lead_is_visible(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select p_lead_id is not null
     and (
       app.acting_at_least('team_coordinator'::public.user_role)
       or exists (
         select 1 from public.crm_leads l
          where l.id = p_lead_id
            and l.owner_id = app.current_user_id()
       )
     );
$$;

comment on function app.crm_lead_is_visible(uuid) is
  'Whether the caller may read one lead (114). A deliberate by-id copy of '
  'crm_leads_select, which stays row-local for speed; 114''s self-check proves '
  'the two agree.';

grant execute on function app.crm_lead_is_visible(uuid) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · THE NOTE THREAD, WITH ITS AUTHORS
-- ----------------------------------------------------------------------------
-- ⚠️ The visibility check is INSIDE, because definer bypasses RLS. Without it
-- this function hands a stranger's phone conversation to anybody who can guess a
-- uuid — the exact hole a SECURITY DEFINER function exists to avoid opening.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_lead_notes_with_authors(p_lead_id uuid)
returns table (
  id                uuid,
  body              text,
  created_at        timestamptz,
  author_id         uuid,
  author_name       text,
  author_avatar_url text
)
language plpgsql
security definer
set search_path = public, app, pg_temp
stable
as $$
begin
  if not app.crm_lead_is_visible(p_lead_id) then
    return;   -- the same empty answer the table itself would have given
  end if;

  return query
    select n.id, n.body, n.created_at,
           n.author_id, u.full_name, u.avatar_url
      from public.crm_lead_notes n
      left join public.users u on u.id = n.author_id
     where n.lead_id = p_lead_id
     order by n.created_at desc;   -- newest first: the last thing said is the thing needed
end;
$$;

comment on function app.crm_lead_notes_with_authors(uuid) is
  'One lead''s notes with each author''s name and picture (114). SECURITY '
  'DEFINER because users_select hides the staff table from a sales member; '
  'checks app.crm_lead_is_visible itself and discloses nothing else.';

grant execute on function app.crm_lead_notes_with_authors(uuid) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · THE TIMELINE, WITH ITS ACTORS
-- ----------------------------------------------------------------------------
-- ⚠️ ORDERED BY `occurred_at`, NOT `created_at`. A call logged an hour late
-- HAPPENED an hour ago, and a timeline sorted by when somebody got round to
-- typing it tells a different story from the one that took place.
--
-- ⚠️ `actor_id` IS NULL FOR EVERY ROW WE HOLD TODAY. All 615 activity rows are
-- `imported`, written by the cron with no session. That is not a missing person
-- and the screen must not label it as one — the importer is not somebody who
-- left. `actor_id is null` on an `imported` row means the system did it.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_lead_activity_with_actors(p_lead_id uuid)
returns table (
  id               uuid,
  kind             public.crm_activity_kind,
  outcome          text,
  detail           jsonb,
  occurred_at      timestamptz,
  actor_id         uuid,
  actor_name       text,
  actor_avatar_url text
)
language plpgsql
security definer
set search_path = public, app, pg_temp
stable
as $$
begin
  if not app.crm_lead_is_visible(p_lead_id) then
    return;
  end if;

  return query
    select a.id, a.kind, a.outcome, a.detail, a.occurred_at,
           a.actor_id, u.full_name, u.avatar_url
      from public.crm_lead_activity a
      left join public.users u on u.id = a.actor_id
     where a.lead_id = p_lead_id
     order by a.occurred_at desc, a.created_at desc;
end;
$$;

comment on function app.crm_lead_activity_with_actors(uuid) is
  'One lead''s activity with each actor''s name and picture (114). A null actor '
  'on an imported row is the importer, not a deleted person.';

grant execute on function app.crm_lead_activity_with_actors(uuid) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ RUNS AS `cni_app` UNDER A MEMBER'S SESSION. A Member is the only person for
-- whom any of this is ever wrong; checking it as an Admin passes against the
-- broken code too and proves nothing — which is exactly how 105's bug reached
-- the owner.
--
-- ⚠️ AND IT REMOVES ITS OWN ROWS BY ID, NEVER BY PREDICATE. Migration 082 ate a
-- live attendance row with a tidy-up delete keyed on a date.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin   uuid;
  v_member  uuid;
  v_project uuid;
  v_lead    uuid;
  v_note    uuid;
  v_act     uuid;
  v_name    text;
  v_visible boolean;
  n         integer;
begin
  select id into v_admin from public.users
   where role in ('admin', 'super_admin') and is_active order by created_at limit 1;
  select id into v_member from public.users
   where role = 'member' and is_active order by created_at limit 1;
  select id into v_project from public.projects where name = 'Chitral Royal Homes' limit 1;

  if v_admin is null or v_member is null or v_project is null then
    raise notice '114 · no admin, member or Chitral project to check against; functions created untested';
    return;
  end if;

  /* A lead assigned to the MEMBER, with a note and an activity row written by
     the ADMIN — the exact pair the bug needs, and the shape Step 7 creates on
     every single assignment. */
  insert into public.crm_leads
    (project_id, owner_id, source, external_id, full_name, submitted_at)
  values
    (v_project, v_member, 'manual', '114-selfcheck-lead', '114 self-check', now())
  returning id into v_lead;

  insert into public.crm_lead_notes (lead_id, author_id, body)
  values (v_lead, v_admin, '114 self-check — removed by this migration')
  returning id into v_note;

  insert into public.crm_lead_activity (lead_id, actor_id, kind, outcome)
  values (v_lead, v_admin, 'assigned', '114 self-check')
  returning id into v_act;

  -- ── As the member the lead belongs to ───────────────────────────────────
  set local role cni_app;
  perform set_config('app.user_id', v_member::text, true);

  -- 1 · ⚠️ THE BUG ITSELF, ASSERTED RATHER THAN ASSUMED. Through the raw join
  --     the author has no name. If this ever stops being true these functions
  --     are redundant and should be deleted, the way Step 4's reader was.
  select u.full_name into v_name
    from public.crm_lead_notes nt
    left join public.users u on u.id = nt.author_id
   where nt.id = v_note;

  if v_name is not null then
    raise exception
      '114 · a Member can now read users directly — these readers are redundant and users_select must be re-examined';
  end if;

  select u.full_name into v_name
    from public.crm_lead_activity a
    left join public.users u on u.id = a.actor_id
   where a.id = v_act;

  if v_name is not null then
    raise exception
      '114 · a Member can now read the actor of an activity row directly — see above';
  end if;

  -- 2 · Through the readers, the same Member sees who did it.
  select author_name into v_name
    from app.crm_lead_notes_with_authors(v_lead) where id = v_note;
  if v_name is null then
    raise exception '114 · a Member still cannot see who wrote a note on their own lead';
  end if;

  select actor_name into v_name
    from app.crm_lead_activity_with_actors(v_lead) where id = v_act;
  if v_name is null then
    raise exception '114 · a Member still cannot see who assigned them their own lead';
  end if;

  -- 3 · ⚠️ THE PREDICATE AGREES WITH THE POLICY — assigned member. This is the
  --     assertion that makes the second copy safe; see the header.
  select count(*) into n from public.crm_leads where id = v_lead;
  select app.crm_lead_is_visible(v_lead) into v_visible;
  if (n = 1) is distinct from v_visible then
    raise exception
      '114 · crm_lead_is_visible and crm_leads_select disagree for the assigned member (policy %, function %)', n, v_visible;
  end if;

  -- ── Now take it away from them ──────────────────────────────────────────
  reset role;
  update public.crm_leads set owner_id = null where id = v_lead;

  set local role cni_app;
  perform set_config('app.user_id', v_member::text, true);

  -- 4 · The readers close with the lead. A definer function that kept answering
  --     here would be a hole straight past RLS.
  select count(*) into n from app.crm_lead_notes_with_authors(v_lead);
  if n <> 0 then
    raise exception '114 · notes were disclosed for a lead the caller cannot read';
  end if;

  select count(*) into n from app.crm_lead_activity_with_actors(v_lead);
  if n <> 0 then
    raise exception '114 · activity was disclosed for a lead the caller cannot read';
  end if;

  -- 5 · And the predicate still agrees with the policy — unassigned member.
  select count(*) into n from public.crm_leads where id = v_lead;
  select app.crm_lead_is_visible(v_lead) into v_visible;
  if (n = 1) is distinct from v_visible then
    raise exception
      '114 · crm_lead_is_visible and crm_leads_select disagree for the unassigned member (policy %, function %)', n, v_visible;
  end if;

  -- 6 · And for a coordinator-and-above, who sees every lead either way.
  perform set_config('app.user_id', v_admin::text, true);
  select count(*) into n from public.crm_leads where id = v_lead;
  select app.crm_lead_is_visible(v_lead) into v_visible;
  if (n = 1) is distinct from v_visible then
    raise exception
      '114 · crm_lead_is_visible and crm_leads_select disagree for an admin (policy %, function %)', n, v_visible;
  end if;

  reset role;

  -- ⚠️ BY ID. See the header note about migration 082.
  delete from public.crm_lead_activity where id = v_act;
  delete from public.crm_lead_notes     where id = v_note;
  delete from public.crm_leads          where id = v_lead;

  raise notice '114 · a sales member sees who wrote a note and who assigned the lead, and only on leads that are theirs';
end $$;
