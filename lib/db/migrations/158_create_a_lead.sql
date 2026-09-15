-- ============================================================================
-- 158 · CREATING A LEAD, AND REFUSING TO CREATE THE SAME ONE TWICE
-- ----------------------------------------------------------------------------
-- The Phase 1 spec's order of operations, verbatim:
--
--     *"Before creation: Normalize phone and email; Check duplicates; Check
--     whether an open lead exists; Check existing customer history; Check
--     previous lead ownership."*
--     *"After creation, call the existing automatic assignment function."*
--
-- ── ⚠️ WHY THIS IS A DATABASE FUNCTION AND NOT A SERVER ACTION ─────────────
-- Two hard facts make it impossible to do in the app layer:
--
--   1 · `crm_leads_insert` (124) requires `crm_manages_project`. A salesperson
--       CANNOT insert a lead at all. Sarah adding a walk-in is refused by RLS
--       today, and widening that policy would also let her create leads owned by
--       whoever she liked.
--   2 · `crm_lead_assignments_insert` (154) admits only a manager, on purpose:
--       *"a row inserted by hand would be a claim about a decision nobody
--       made."*
--
-- So the write is the server's, in a definer, exactly as 154 anticipated.
--
-- ── ⚠️ AND THE OWNER IS NOT A PARAMETER ────────────────────────────────────
-- The owner's rule is *"the salesperson must not select an owner."* That is
-- enforced by the SIGNATURE, not by a check inside: there is no argument to pass
-- one in. A rule a caller cannot express is a rule that cannot be forgotten,
-- bypassed by a second call site, or lost in a refactor.
--
-- ── ⚠️ SECURITY DEFINER MEANS RLS IS NOT WATCHING ──────────────────────────
-- Everything RLS would have checked is checked here by hand, first, before any
-- write: that there is an acting user, and that they belong to the project's
-- lead department. Getting this wrong would let any signed-in person in any
-- department create leads on any project.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · DO WE ALREADY KNOW THIS PERSON?
-- ----------------------------------------------------------------------------
-- ⚠️ THIS DELIBERATELY DISCLOSES ACROSS THE OWNERSHIP BOUNDARY, and it is the
-- minimum that makes the feature work. Sarah cannot read Sahad's leads — that is
-- the whole point of the RLS — but if she cannot be told "this person is already
-- Sahad's", she types the lead in again, two people ring one client, and the
-- client concludes nobody here talks to each other.
--
-- So it returns four things and nothing else: the person's name, the stage, the
-- owner's name, and which project. No phone, no email, no notes, no budget, no
-- quotation. Enough to stop, not enough to work somebody else's lead.
-- ════════════════════════════════════════════════════════════════════════════
/* ⚠️ DROPPED FIRST, NOT `create or replace`. Postgres refuses to replace a
   function whose OUT parameters changed, and this file is re-runnable — so
   without the drop a corrected column list fails on the second apply with
   "cannot change return type of existing function". */
drop function if exists app.crm_lead_duplicates(uuid, text, text);
create function app.crm_lead_duplicates(
  p_project uuid,
  p_phone_e164 text,
  p_email text
)
returns table (
  kind          text,        -- 'lead' or 'client'
  ref_id        uuid,
  full_name     text,
  project_name  text,
  same_project  boolean,
  stage         text,
  is_open       boolean,
  owner_name    text,
  /* ⚠️ ANSWERS "is this mine?" WITHOUT HANDING OVER AN ID. The screen needs
     to tell "you already have this person" from "a colleague does", and
     those two sentences lead to different buttons. A boolean discloses
     strictly less than the owner's name already beside it. */
  is_mine       boolean,
  matched_on    text,        -- 'phone', 'email', or 'phone and email'
  last_seen_at  timestamptz
)
language plpgsql
security definer
set search_path = public, app, pg_temp
stable
as $fn$
declare
  v_phone text := nullif(trim(coalesce(p_phone_e164, '')), '');
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
begin
  /* ⚠️ THE GATE. A definer with no caller check is a hole in the RLS, and this
     one would turn any signed-in account into a directory lookup for every
     phone number in the CRM. */
  if not app.crm_in_project_department(p_project)
     and not app.crm_manages_project(p_project) then
    return;
  end if;

  /* Nothing to match on is not an error — a lead may legitimately arrive with
     only a name — it simply finds nothing. */
  if v_phone is null and v_email is null then
    return;
  end if;

  return query
  select
    'lead'::text,
    l.id,
    l.full_name,
    p.name,
    l.project_id = p_project,
    l.stage::text,
    l.stage not in ('won','lost'),
    o.full_name,
    l.owner_id = app.current_user_id(),
    case
      when v_phone is not null and l.phone_e164 = v_phone
       and v_email is not null and lower(l.email) = v_email then 'phone and email'
      when v_phone is not null and l.phone_e164 = v_phone then 'phone'
      else 'email'
    end,
    greatest(l.submitted_at, l.imported_at)
  from public.crm_leads l
  join public.projects p on p.id = l.project_id
  left join public.users o on o.id = l.owner_id
 where (v_phone is not null and l.phone_e164 = v_phone)
    or (v_email is not null and lower(l.email) = v_email)

  union all

  /* "Check existing customer history." A client row is created when a lead is
     won (126), so most of these are already above — but 126 also imports
     clients directly, and somebody who bought two years ago and never had a
     lead row is exactly the history a salesperson wants before they open with
     "have you heard of us?". */
  select
    'client'::text,
    c.id,
    c.full_name,
    null::text,
    false,
    null::text,
    false,
    null::text,
    false,
    case
      when v_phone is not null and c.phone_e164 = v_phone
       and v_email is not null and lower(c.email) = v_email then 'phone and email'
      when v_phone is not null and c.phone_e164 = v_phone then 'phone'
      else 'email'
    end,
    c.converted_at
  from public.crm_clients c
 where (v_phone is not null and c.phone_e164 = v_phone)
    or (v_email is not null and lower(c.email) = v_email)

  order by 5 desc, 11 desc;
end
$fn$;

comment on function app.crm_lead_duplicates(uuid, text, text) is
  'Do we already know this person? ⚠️ Discloses name, stage, owner and project '
  'ACROSS the ownership boundary, deliberately and minimally — without it a '
  'salesperson retypes a colleague''s lead and two people ring one client. '
  'Migration 158.';

revoke all on function app.crm_lead_duplicates(uuid, text, text) from public;
grant execute on function app.crm_lead_duplicates(uuid, text, text) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · CREATE IT, AND RECORD WHY IT WENT WHERE IT WENT
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_create_lead(
  p_project            uuid,
  p_full_name          text,
  p_phone              text,
  p_phone_e164         text,
  p_email              text,
  p_city               text,
  p_source             public.crm_lead_source,
  p_source_detail      text,
  p_enquiry            text,
  p_property           uuid,
  p_budget             bigint,
  p_whatsapp_consent   boolean,
  p_preferred_channel  public.crm_followup_channel,
  p_preferred_time     text,
  p_next_action        text,
  p_next_action_at     timestamptz,
  p_next_action_type   public.crm_next_action_kind,
  /* ⚠️ The ONLY override, and it is narrow: it lets somebody go ahead past a
     CLOSED or OWN duplicate, having been shown it. It can never get past an
     open lead belonging to somebody else — see below. */
  p_allow_duplicate    boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_actor  uuid := app.current_user_id();
  v_phone  text := nullif(trim(coalesce(p_phone_e164, '')), '');
  v_raw_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_email  text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_name   text := nullif(trim(coalesce(p_full_name, '')), '');
  v_lead   uuid;
  v_owner  uuid;
  v_demo   boolean;
  v_clash  record;
  v_top    record;
  v_considered int;
  v_eligible   int;
  v_reason jsonb;
  v_text   text;
  v_skipped jsonb;
begin
  -- ── The checks RLS would have made, made by hand ──────────────────────────
  if v_actor is null then
    raise exception 'No acting user — a lead must record who created it'
      using errcode = 'CRM00';
  end if;

  if not app.crm_in_project_department(p_project)
     and not app.crm_manages_project(p_project) then
    raise exception 'You cannot add leads to this project'
      using errcode = 'CRM02';
  end if;

  if v_name is null then
    raise exception 'A lead needs a name' using errcode = 'CRM03';
  end if;

  /* ⚠️ A LEAD WITH NO WAY TO REACH THEM IS NOT A LEAD. It is a row that will sit
     on somebody's desk forever showing as overdue, because no contact attempt
     can ever be made against it.

     ⚠️ AND IT TESTS THE RAW PHONE, NOT THE NORMALISED ONE. `toE164` returns null
     for an Islamabad landline — 051-1234567 is ten digits and matches no mobile
     pattern — and refusing that would throw away a real enquiry because the
     number is not a mobile. `lib/domain/phone.ts` settled this already: *"Null
     is a real answer… it simply does not pretend to have normalised it."*

     What IS lost without an E.164 form is duplicate matching and WhatsApp, and
     the form says so rather than the database refusing. */
  if v_raw_phone is null and v_email is null then
    raise exception 'Add a phone number or an email — there is no way to contact this person otherwise'
      using errcode = 'CRM04';
  end if;

  -- ── "Check whether an open lead exists" ───────────────────────────────────
  /* ⚠️ THE ONE CASE WITH NO OVERRIDE: an OPEN lead for this person, on this
     project, belonging to SOMEBODY ELSE. Letting that through creates the exact
     situation the whole assignment system exists to prevent — two salespeople
     working one client — and it would be the quietest way to poach a colleague's
     lead: retype it, and the rota might hand it to you. */
  select l.id, l.owner_id, coalesce(o.full_name, 'somebody who has since left') as owner_name
    into v_clash
    from public.crm_leads l
    left join public.users o on o.id = l.owner_id
   where l.project_id = p_project
     and l.stage not in ('won','lost')
     and ((v_phone is not null and l.phone_e164 = v_phone)
       or (v_email is not null and lower(l.email) = v_email))
   order by (l.owner_id is distinct from v_actor) desc
   limit 1;

  if v_clash.id is not null then
    if v_clash.owner_id is distinct from v_actor then
      raise exception 'This person already has an open lead on this project, with %. Add a note to that lead instead of creating a second one.',
        v_clash.owner_name
        using errcode = 'CRM05';
    elsif not p_allow_duplicate then
      raise exception 'You already have an open lead for this person on this project.'
        using errcode = 'CRM06';
    end if;
  end if;

  /* ⚠️ THE UNIT MUST BELONG TO THIS PROJECT. `crm_leads.property_id` references
     `crm_properties` and nothing else (150), so a plot from Chitral can be
     attached to an Executive Housing lead and the database will accept it — and
     from then on the quotation, the payment plan and the price all describe a
     property the client was never shown.

     It is reachable from the screen, not a theoretical hole: the Add Lead form
     loads the catalogue for the project in view, and the person can change the
     project inside the form without the list following. */
  if p_property is not null and not exists (
    select 1 from public.crm_properties pr
     where pr.id = p_property and pr.project_id = p_project
  ) then
    raise exception 'That unit belongs to a different project'
      using errcode = 'CRM07';
  end if;

  -- ── Who gets it ──────────────────────────────────────────────────────────
  /* ⚠️ ONE READ OF THE ROTA, and the reason is built from the SAME row that
     decided. 154's requirement: *"built from the same row that made the decision
     rather than from a second query that may disagree with it."* */
  select r.* into v_top from app.crm_lead_rota(p_project) r limit 1;
  select count(*) into v_considered from app.crm_eligible_owners(p_project);
  select count(*) into v_eligible from app.crm_eligible_owners(p_project) where eligible;

  if v_top.user_id is null then
    /* ⚠️ THE LEAD IS STILL CREATED, UNOWNED. Refusing to record a real enquiry
       because the rota could not choose loses the enquiry — which is strictly
       worse than an unassigned lead a manager can see and hand out. */
    v_owner := null;
  else
    v_owner := v_top.user_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('who', e.full_name, 'why', e.why_not)), '[]'::jsonb)
    into v_skipped
    from app.crm_eligible_owners(p_project) e
   where not e.eligible;

  select (p.name like '%[demo]') into v_demo
    from public.projects p where p.id = p_project;

  -- ── Write it ─────────────────────────────────────────────────────────────
  insert into public.crm_leads (
    project_id, owner_id, source, external_id,
    full_name, phone, phone_e164, email, city,
    source_detail, property_id, budget,
    whatsapp_consent, whatsapp_consent_at,
    preferred_channel, preferred_time,
    next_action, next_action_at, next_action_type,
    stage, submitted_at, created_by_id, is_test_data
  ) values (
    p_project, v_owner, p_source,
    /* ⚠️ NULL, never a generated id. `unique (source, external_id)` exists to
       make the Meta importer safe to re-run; NULLs do not collide, so a hand
       entered lead sits outside that rule rather than fighting it. */
    null,
    v_name,
    v_raw_phone,
    v_phone,
    v_email,
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_source_detail, '')), ''),
    p_property,
    p_budget,
    p_whatsapp_consent,
    case when p_whatsapp_consent is not null then now() end,
    p_preferred_channel,
    nullif(trim(coalesce(p_preferred_time, '')), ''),
    nullif(trim(coalesce(p_next_action, '')), ''),
    p_next_action_at,
    p_next_action_type,
    'new',
    /* ⚠️ NOW, not a date somebody picked. `submitted_at` is what response time
       is measured from (111), and a back-dated walk-in would arrive already
       overdue through no fault of the person who gets it. */
    now(),
    v_actor,
    /* The owner's standing rule — everything on the demo project is test data,
       set here rather than by a checkbox somebody has to remember to tick. */
    coalesce(v_demo, false)
  )
  returning id into v_lead;

  -- ── The enquiry, in their words ──────────────────────────────────────────
  if nullif(trim(coalesce(p_enquiry, '')), '') is not null then
    insert into public.crm_lead_notes (lead_id, author_id, body)
    values (v_lead, v_actor, trim(p_enquiry));
  end if;

  -- ── Why this person got it ───────────────────────────────────────────────
  if v_owner is not null then
    v_reason := jsonb_build_object(
      'considered',         v_considered,
      'eligible',           v_eligible,
      'at_work',            v_top.at_work,
      'open_leads',         v_top.open_leads,
      'weighted_open',      v_top.weighted_load,
      'median_minutes',     v_top.median_minutes,
      'days_quiet',         v_top.days_quiet,
      'last_given_at',      v_top.last_given_at,
      'skipped',            v_skipped
    );

    v_text := v_top.full_name || ' — '
      || v_eligible || ' of ' || v_considered || ' eligible; '
      || case when v_top.at_work then 'at work' else 'off shift' end || ', '
      || v_top.weighted_load || ' weighted open, '
      || coalesce(round(v_top.median_minutes)::text || ' min median reply', 'no reply time yet');

    insert into public.crm_lead_assignments
      (lead_id, to_user_id, decided_by_id, rule, reason, reason_text)
    values (v_lead, v_owner, v_actor, 'rota', v_reason, v_text);
  else
    insert into public.crm_lead_assignments
      (lead_id, to_user_id, from_user_id, decided_by_id, rule, reason_text)
    values (v_lead, null, v_actor, v_actor, 'rota',
            'Nobody was eligible on this project, so the lead was left unassigned.');
  end if;

  -- ── The timeline ─────────────────────────────────────────────────────────
  insert into public.crm_lead_activity (lead_id, actor_id, kind, outcome, detail)
  values (
    v_lead, v_actor, 'created', null,
    jsonb_build_object('source', p_source::text, 'detail', nullif(trim(coalesce(p_source_detail, '')), ''))
  );

  if v_owner is not null then
    insert into public.crm_lead_activity (lead_id, actor_id, kind, outcome, detail)
    values (v_lead, v_actor, 'assigned', v_top.full_name,
            jsonb_build_object('rule', 'rota', 'why', v_text));
  end if;

  return v_lead;
end
$fn$;

comment on function app.crm_create_lead is
  'Create a lead by hand and let the rota own it. ⚠️ There is NO owner argument '
  'on purpose — the rule "a salesperson must not select an owner" is enforced by '
  'the signature, which no caller can forget. Migration 158.';

revoke all on function app.crm_create_lead(
  uuid, text, text, text, text, text, public.crm_lead_source, text, text, uuid,
  bigint, boolean, public.crm_followup_channel, text, text, timestamptz,
  public.crm_next_action_kind, boolean) from public;
grant execute on function app.crm_create_lead(
  uuid, text, text, text, text, text, public.crm_lead_source, text, text, uuid,
  bigint, boolean, public.crm_followup_channel, text, text, timestamptz,
  public.crm_next_action_kind, boolean) to cni_app;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
-- ⚠️ EVERY CHECK BELOW RUNS AS A REAL SALESPERSON, in their own session, with
-- `set local role cni_app` and `app.user_id` set. Reasoning about a policy from
-- an admin connection is how one membership bug shipped six times.
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sarah uuid; v_sahad uuid; v_outsider uuid;
  v_lead uuid; v_other uuid; v_owner uuid;
  n int; bad boolean; v_reason jsonb; v_text text; v_other_project uuid;
  v_phone text := '+923001580001';
begin
  select p.id into v_project from public.projects p
    join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;

  if v_project is null then
    raise notice '158 · no demo sales project — functions created, nothing to measure';
    return;
  end if;

  select e.user_id into v_sarah from app.crm_eligible_owners(v_project) e
   where e.eligible order by e.full_name limit 1;
  select e.user_id into v_sahad from app.crm_eligible_owners(v_project) e
   where e.eligible and e.user_id <> v_sarah order by e.full_name limit 1;

  if v_sarah is null then
    raise notice '158 · nobody eligible on the demo project — nothing to measure';
    return;
  end if;

  -- Somebody outside the sales department entirely.
  select u.id into v_outsider from public.users u
    join public.projects p on p.id = v_project
   where u.is_active and u.department_id is distinct from p.lead_department_id
   limit 1;

  delete from public.crm_leads where phone_e164 = v_phone;

  -- 1 · ⚠️ A SALESPERSON CAN CREATE ONE, WHICH RLS ALONE REFUSES.
  set local role cni_app;
  perform set_config('app.user_id', v_sarah::text, true);

  v_lead := app.crm_create_lead(
    v_project, 'Self-check Walk-in', '0300 158-0001', v_phone, null, 'Islamabad',
    'walk_in', 'Showroom desk', 'Asked about a 5 marla corner plot.',
    null, null, true, 'whatsapp', 'Evenings',
    'Call back', now() + interval '1 day', 'call', false);

  reset role;

  if v_lead is null then
    raise exception '158 · the lead was not created';
  end if;

  -- 2 · ⚠️ THE ROTA CHOSE, AND THE REASON IS ON RECORD WITH FIGURES IN IT.
  select l.owner_id into v_owner from public.crm_leads l where l.id = v_lead;
  if v_owner is null then
    raise exception '158 · the lead was created with no owner although people were eligible';
  end if;

  select a.reason, a.reason_text into v_reason, v_text
    from public.crm_lead_assignments a where a.lead_id = v_lead;
  if v_reason is null or v_reason->>'eligible' is null then
    raise exception '158 · the assignment recorded no figures';
  end if;
  if v_text is null or length(v_text) < 20 then
    raise exception '158 · the assignment recorded no sentence, only: %', coalesce(v_text, 'nothing');
  end if;

  -- 3 · ⚠️ AND IT IS FLAGGED AS TEST DATA WITHOUT ANYBODY TICKING A BOX.
  if not exists (select 1 from public.crm_leads where id = v_lead and is_test_data) then
    raise exception '158 · a lead on the demo project was not flagged as test data';
  end if;

  -- 4 · The enquiry and the timeline are both there.
  if not exists (select 1 from public.crm_lead_notes where lead_id = v_lead) then
    raise exception '158 · the enquiry was not kept';
  end if;
  select count(*) into n from public.crm_lead_activity
   where lead_id = v_lead and kind in ('created','assigned');
  if n <> 2 then
    raise exception '158 · the timeline has % of the 2 expected entries', n;
  end if;

  -- 5 · ⚠️ A SECOND OPEN LEAD FOR THE SAME PERSON IS REFUSED — and refused even
  --     with the override, when it belongs to somebody else. This is the poach.
  if v_sahad is not null then
    update public.crm_leads set owner_id = v_sahad where id = v_lead;

    bad := false;
    set local role cni_app;
    perform set_config('app.user_id', v_sarah::text, true);
    begin
      v_other := app.crm_create_lead(
        v_project, 'Self-check Walk-in', '0300 158-0001', v_phone, null, null,
        'walk_in', null, null, null, null, null, null, null, null, null, null,
        /* the override, deliberately on */ true);
      bad := true;
    exception when others then
      if sqlstate <> 'CRM05' then
        reset role;
        raise exception '158 · the duplicate was refused for the wrong reason: % %', sqlstate, sqlerrm;
      end if;
    end;
    reset role;
    if bad then
      raise exception '158 · a salesperson retyped a colleague''s open lead and it was accepted';
    end if;
  end if;

  -- 6 · ⚠️ SOMEBODY OUTSIDE THE DEPARTMENT CANNOT CREATE ONE AT ALL. The definer
  --     turned RLS off; this is the only thing standing in their way.
  if v_outsider is not null then
    bad := false;
    set local role cni_app;
    perform set_config('app.user_id', v_outsider::text, true);
    begin
      perform app.crm_create_lead(
        v_project, 'Self-check Trespass', null, '+923001580002', null, null,
        'walk_in', null, null, null, null, null, null, null, null, null, null, false);
      bad := true;
    exception when others then
      if sqlstate <> 'CRM02' then
        reset role;
        raise exception '158 · the outsider was refused for the wrong reason: % %', sqlstate, sqlerrm;
      end if;
    end;
    reset role;
    if bad then
      raise exception '158 · somebody outside the sales department created a lead';
    end if;
  end if;

  -- 7 · ⚠️ A LEAD WITH NO PHONE AND NO EMAIL IS REFUSED.
  bad := false;
  set local role cni_app;
  perform set_config('app.user_id', v_sarah::text, true);
  begin
    perform app.crm_create_lead(
      v_project, 'Self-check Unreachable', null, null, null, null,
      'walk_in', null, null, null, null, null, null, null, null, null, null, false);
    bad := true;
  exception when others then
    if sqlstate <> 'CRM04' then
      reset role;
      raise exception '158 · the unreachable lead was refused for the wrong reason: %', sqlstate;
    end if;
  end;
  reset role;
  if bad then
    raise exception '158 · a lead was created with no way to contact the person';
  end if;

  -- 8 · ⚠️ THE DUPLICATE READER TELLS SARAH IT IS SAHAD'S, WITHOUT SHOWING HER
  --     THE LEAD. Both halves matter: she must be told, and she must not be
  --     given read access she does not have.
  set local role cni_app;
  perform set_config('app.user_id', v_sarah::text, true);

  select count(*) into n from app.crm_lead_duplicates(v_project, v_phone, null);
  if n = 0 then
    reset role;
    raise exception '158 · the duplicate reader found nothing for a number that exists';
  end if;

  if v_sahad is not null then
    if not exists (
      select 1 from app.crm_lead_duplicates(v_project, v_phone, null) d
       where d.owner_name is not null and d.is_open
    ) then
      reset role;
      raise exception '158 · the duplicate reader did not name the owner';
    end if;
  end if;

  select count(*) into n from public.crm_leads where id = v_lead;
  reset role;
  if v_sahad is not null and n <> 0 then
    raise exception '158 · Sarah can READ a lead that is not hers — the reader widened RLS';
  end if;

  -- 9 · ⚠️ A UNIT FROM ANOTHER PROJECT IS REFUSED. Without this the quotation,
  --     the payment plan and the price all describe a property the client was
  --     never shown, and nothing in the schema says otherwise.
  --
  --     ⚠️ THE FOREIGN UNIT IS CREATED HERE, NOT LOOKED FOR. Written as a
  --     lookup this check SKIPPED SILENTLY — the only two properties in the
  --     database are both on the demo project, so it read as proof while
  --     proving nothing. A self-check that can quietly not run is worse than no
  --     self-check, because somebody trusts it.
  select p.id into v_other_project from public.projects p
   where p.id <> v_project limit 1;

  if v_other_project is null then
    raise exception '158 · only one project exists, so the foreign-unit rule cannot be proven';
  end if;

  insert into public.crm_properties (project_id, code, plot_number, kind, is_test_data)
  values (v_other_project, 'SELFCHECK-158', 'SELFCHECK-158', 'Residential plot', true)
  returning id into v_other;

  if v_other is not null then
    bad := false;
    set local role cni_app;
    perform set_config('app.user_id', v_sarah::text, true);
    begin
      perform app.crm_create_lead(
        v_project, 'Self-check Wrong Unit', '0300 158-0003', '+923001580003', null, null,
        'walk_in', null, null, v_other, null, null, null, null, null, null, null, false);
      bad := true;
    exception when others then
      if sqlstate <> 'CRM07' then
        reset role;
        raise exception '158 · the foreign unit was refused for the wrong reason: %', sqlstate;
      end if;
    end;
    reset role;
    delete from public.crm_properties where id = v_other;
    if bad then
      raise exception '158 · a lead was tagged with a unit from another project';
    end if;

    -- And the project's OWN unit is accepted, so the rule is not simply "no
    -- units at all".
    select pr.id into v_other
      from public.crm_properties pr where pr.project_id = v_project limit 1;
    if v_other is not null then
      set local role cni_app;
      perform set_config('app.user_id', v_sarah::text, true);
      perform app.crm_create_lead(
        v_project, 'Self-check Right Unit', '0300 158-0003', '+923001580003', null, null,
        'walk_in', null, null, v_other, null, null, null, null, null, null, null, false);
      reset role;
    end if;
  end if;

  -- 10 · Clean up everything this check wrote.
  delete from public.crm_leads where phone_e164 in (v_phone, '+923001580002', '+923001580003');

  raise notice '158 · a salesperson can create a lead, the rota owns it with its figures on record, and a colleague''s open lead cannot be retyped';
end $chk$;
