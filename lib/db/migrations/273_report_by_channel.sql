-- ============================================================================
-- 273 · WHICH APP THE LEADS CAME FROM
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-30: *"No need to split the Facebook and Instagram, right? …
-- If it is easy then do that."*
--
-- It was already stored. Migration 160 asked Graph for `platform` and files a
-- Meta lead as `facebook` or `instagram`; on the real Chitral project every
-- lead the application can see now carries one — 13 Instagram, 4 Facebook,
-- 1 WhatsApp. What did not exist was any way to compare them: the desk had no
-- filter for it and "Where the leads came from" groups by FORM, which is a
-- different question and says so in its own notes.
--
-- ⚠️ `archived_at is null` BELOW IS NOT BELT AND BRACES. `crm_leads_not_archived`
-- already hides archived rows from the application, so this line changes nothing
-- for `cni_app` — it is here so the function gives the same answer when the
-- OWNER runs it, which is who runs a self-check and who runs a hand query when
-- somebody asks why a figure moved.
--
-- ── ⚠️ GROUPED BY `source`, WHICH IS AN ENUM, SO EVERY ROW HAS ONE ───────
-- No `coalesce(..., 'Not recorded')` is needed here and none is written. The
-- column is `not null`, and the honest name for a lead Meta never told us about
-- is `meta_lead_ad` — which is what 160 files it as, and what 660 historical
-- leads already are. A separate "Not recorded" bucket would invent a distinction
-- the data does not carry.
--
-- ── ⚠️ THE SAME SHAPE AS `crm_report_sources`, DELIBERATELY ──────────────
-- Same columns, same null-not-zero win rate, same Karachi date boundary, same
-- `crm_manages_project` guard. A reader comparing the two reports is comparing
-- two groupings of one population; a second definition of "contacted" between
-- them would make that comparison quietly wrong.
-- ============================================================================

create or replace function app.crm_report_channels(p_project uuid, p_from date, p_to date)
returns table (source text, leads bigint, contacted bigint, won bigint, lost bigint,
               win_rate numeric)
language sql
stable security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
  select l.source::text,
         count(*),
         count(*) filter (where l.first_contacted_at is not null),
         count(*) filter (where l.stage = 'won'),
         count(*) filter (where l.stage = 'lost'),
         /* ⚠️ NULL, NOT ZERO, when nothing has closed — the same rule as
            `crm_report_sources`. A rate of 0% reads as a fact about the
            channel; null reads as "we cannot say yet", which is the truth
            while the pipeline is three weeks old. */
         case
           when count(*) filter (where l.stage in ('won', 'lost')) = 0 then null
           else round(count(*) filter (where l.stage = 'won') * 100.0
                      / count(*) filter (where l.stage in ('won', 'lost')), 1)
         end
    from (select * from public.crm_leads where archived_at is null) l
   where l.project_id = p_project
     and app.crm_manages_project(p_project)
     and (l.submitted_at at time zone 'Asia/Karachi')::date between p_from and p_to
   group by l.source::text
$function$;

comment on function app.crm_report_channels(uuid, date, date) is
  'Leads grouped by the CHANNEL they arrived on — facebook, instagram, whatsapp, '
  'website. Distinct from crm_report_sources, which groups by the lead form: one '
  'form runs on both apps. Migration 273.';

revoke all on function app.crm_report_channels(uuid, date, date) from public;
grant execute on function app.crm_report_channels(uuid, date, date) to cni_app;

-- ============================================================================
-- SELF-CHECK — AS cni_app, ON A FIXTURE THIS FILE BUILDS
-- ----------------------------------------------------------------------------
-- ⚠️ AS cni_app, BECAUSE 271 HAPPENED. A definer's EXECUTE grant is invisible to
-- any check that runs as the migration owner, and that is exactly how a button
-- shipped that could never be pressed. The grant above is proved, not assumed.
--
-- ⚠️ AND ON ITS OWN ROWS. The check needs leads on both apps in a known period;
-- reading whatever happens to be live would pass today and skip silently the day
-- the data changes. Three leads are created, counted, and deleted by id.
-- ============================================================================
do $$
declare
  v_manager uuid;
  v_project uuid;
  v_ids     uuid[];
  r         record;
  v_fb      bigint := -1;
  v_ig      bigint := -1;
  v_igrate  numeric := -1;
  v_rows    int := 0;
  FROM_DAY  constant date := date '2019-03-01';
  TO_DAY    constant date := date '2019-03-31';
begin
  -- ── the fixture ─────────────────────────────────────────────────────────
  select u.id into v_manager
    from public.users u
   where u.is_active and u.department_role = 'manager'
     and exists (select 1 from public.projects p where p.lead_department_id = u.department_id)
   limit 1;
  if v_manager is null then
    raise exception 'NO DEPARTMENT MANAGER ON ANY PROJECT — this check cannot run, and a pass here would mean nothing';
  end if;

  select p.id into v_project from public.projects p
    join public.users u on u.id = v_manager
   where p.lead_department_id = u.department_id
   limit 1;

  /* ⚠️ MARCH 2019 IS THE POINT. The window is years before this product had a
     lead, so the counts below cannot be contaminated by live rows — and a live
     row cannot be contaminated by these. */
  if exists (select 1 from public.crm_leads
              where project_id = v_project
                and (submitted_at at time zone 'Asia/Karachi')::date between FROM_DAY and TO_DAY) then
    raise exception 'THE 273 FIXTURE WINDOW ALREADY HAS LEADS IN IT — refusing to count live rows';
  end if;

  perform set_config('app.user_id', v_manager::text, true);
  perform set_config('app.crm_quiet_insert', 'on', true);
  perform set_config('app.crm_hold_assignment', 'on', true);

  /* two Instagram leads, one of them won; one Facebook lead, lost.

     ⚠️ THE QUALIFYING ANSWERS ARE FILLED IN, AND THE FIRST DRAFT FORGOT.
     Migration 167's gate refuses `won` on a lead nobody qualified — CRM08, with
     the four missing answers in its detail — so the insert failed. "Not
     disclosed" is a valid answer here and never asking is not, which is the
     rule the gate exists for; a fixture is not an exception to it.

     ⚠️ AND `lost` NEEDS A REASON for the same reason. */
  insert into public.crm_leads (project_id, full_name, phone, phone_e164, source,
      stage, submitted_at, first_contacted_at,
      budget_band, authority, purpose, timeline, lost_reason)
  values
    (v_project, '273 IG won',  '+923000002731', '+923000002731',
     'instagram'::public.crm_lead_source, 'won'::public.crm_stage,
     FROM_DAY + 1, FROM_DAY + 1,
     'not_disclosed'::public.crm_budget_band, 'unknown'::public.crm_authority,
     'unknown'::public.crm_purpose, 'unknown'::public.crm_timeline, null),
    (v_project, '273 IG open', '+923000002732', '+923000002732',
     'instagram'::public.crm_lead_source, 'new'::public.crm_stage,
     FROM_DAY + 2, null, null, null, null, null, null),
    (v_project, '273 FB lost', '+923000002733', '+923000002733',
     'facebook'::public.crm_lead_source, 'lost'::public.crm_stage,
     FROM_DAY + 3, FROM_DAY + 3,
     'not_disclosed'::public.crm_budget_band, 'unknown'::public.crm_authority,
     'unknown'::public.crm_purpose, 'unknown'::public.crm_timeline,
     'not_serious'::public.crm_lost_reason);

  /* ⚠️ NOT `returning id into v_id` — a three-row INSERT returning into a scalar
     raises "query returned more than one row" in plpgsql. The ids are collected
     afterwards, which is also what the clean-up needs. */
  select array_agg(id) into v_ids from public.crm_leads
   where phone_e164 in ('+923000002731', '+923000002732', '+923000002733');
  if array_length(v_ids, 1) <> 3 then
    raise exception 'THE 273 FIXTURE DID NOT INSERT — got % rows', coalesce(array_length(v_ids, 1), 0);
  end if;

  perform set_config('app.crm_quiet_insert', '', true);
  perform set_config('app.crm_hold_assignment', '', true);

  -- ── read it back through the function, as the app's own role ────────────
  set local role cni_app;
  for r in select * from app.crm_report_channels(v_project, FROM_DAY, TO_DAY) loop
    v_rows := v_rows + 1;
    if r.source = 'facebook' then v_fb := r.leads; end if;
    if r.source = 'instagram' then
      v_ig := r.leads;
      v_igrate := r.win_rate;
    end if;
  end loop;
  reset role;

  if v_rows <> 2 then
    raise exception '273 · expected two channels in the window, got %', v_rows;
  end if;
  if v_ig <> 2 then
    raise exception '273 · Instagram should be 2 and is %', v_ig;
  end if;
  if v_fb <> 1 then
    raise exception '273 · Facebook should be 1 and is %', v_fb;
  end if;
  /* One won, one still open, none lost → 1 of 1 closed → 100%. The open lead
     must NOT drag it to 50%, which is the mistake a naive won/total makes. */
  if v_igrate is distinct from 100.0 then
    raise exception '273 · Instagram win rate should be 100.0 (won 1 of 1 CLOSED) and is %', v_igrate;
  end if;

  -- ── clean up, by id ─────────────────────────────────────────────────────
  delete from public.crm_lead_activity where lead_id = any(v_ids);
  delete from public.crm_lead_assignments where lead_id = any(v_ids);
  delete from public.crm_leads where id = any(v_ids);
  if exists (select 1 from public.crm_leads where id = any(v_ids)) then
    raise exception 'THE 273 FIXTURE SURVIVED';
  end if;

  raise notice '273 self-check passed: as cni_app — channels split facebook from instagram, and the win rate counts closed leads only';
exception
  when others then
    reset role;
    raise;
end $$;
