-- ============================================================================
-- 127 · THE FORM DECIDES THE PROJECT — owner, 2026-09-10
-- ----------------------------------------------------------------------------
-- *"Its three campaigns will be live today: ERP campaign, CRM campaign, Taskly
-- campaign… The point over here is to keep this in your mind, right? Smartly
-- link."*
--
-- ── ⚠️ THE PROBLEM, AND IT ARRIVES TODAY ───────────────────────────────────
-- Migration 112 resolves a lead's project from the **page**, deliberately:
--
--     *"The caller says which Meta page it pulled from; the database decides
--      which project that is. A p_project_id parameter would let a bug — or a
--      crafted call — file one client's leads under another client's project."*
--
-- That reasoning is still right, and it is not enough any more. All three new
-- campaigns run on ONE page — AI & Digital's — so all three would file their
-- leads under one project, and an ERP enquiry would be indistinguishable from
-- somebody asking about Taskly. The three campaigns are three different products
-- with three different conversations.
--
-- ⚠️ AND THE CAMPAIGN CANNOT ANSWER IT. `campaign_name` comes back EMPTY on
-- every lead — verified 2026-09-09, and `06-CAMPAIGNS-AND-COVERAGE.md` explains
-- why: the page and the ad account that runs its campaigns sit in different
-- portfolios, so no token we hold has both. Until that is changed in Meta, the
-- campaign is not a usable key.
--
-- ── WHAT IS LEFT IS THE FORM, AND IT IS ENOUGH ─────────────────────────────
-- Meta returns the form id on every single lead. Each campaign gets its own lead
-- form, so the form IS the campaign for our purposes — and 112 already had the
-- foresight not to overwrite a form's project on re-import:
--
--     *"project_id is NOT updated. If somebody has re-mapped a form to a
--      different project by hand, an import must not silently undo it."*
--
-- So the hook exists and nothing used it: the LEAD took the page's project
-- regardless. This makes the lead inherit the FORM's project, falling back to
-- the page when a form has not been re-mapped.
--
-- ⚠️ THE ORIGINAL SAFETY IS KEPT. The caller still cannot name a project. The
-- form's project can only have been set by a previous import (from the page) or
-- by an Admin through `crm_lead_forms`, which is policy-protected. A crafted
-- call still cannot file one client's leads under another's.
-- ============================================================================

/* ⚠️ THE DEFAULTS ARE 112'S AND MUST BE REPEATED VERBATIM. `CREATE OR REPLACE`
   refuses to remove a parameter default — omitting them is not "leaving them
   alone", it is a change to the signature, and the only way past it is a DROP.
   Dropping and recreating this function would work and is the wrong instinct
   here: for the moments between, the ONLY path that writes leads would not
   exist, and if anything later in the file failed the transaction would roll
   back to a schema where the cron had no writer. Matching the signature keeps
   this a replacement. */
create or replace function app.crm_record_leads(
  p_page_id text,
  p_forms   jsonb default '[]'::jsonb,
  p_leads   jsonb default '[]'::jsonb
)
/* ⚠️ `forms_written`, NOT `forms` — 112's exact column names. Renaming one
   changes the function's return TYPE, which PostgreSQL refuses on a
   CREATE OR REPLACE and which would have forced a DROP. The caller in
   `lib/crm/lead-import.ts` reads `leads_new` and `leads_updated` by name, so a
   drop-and-recreate that got a name wrong would compile, run, and report zero
   imports for ever. */
returns table (forms_written integer, leads_new integer, leads_updated integer)
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_page_project uuid;
  v_form         uuid;
  v_form_project uuid;
  v_lead         uuid;
  v_existing     uuid;
  r              jsonb;
  n_forms        integer := 0;
  n_new          integer := 0;
  n_updated      integer := 0;
begin
  /* Unchanged from 112, and for the reason 112 gives: the caller says which
     PAGE it pulled from and the database decides what that means. */
  select a.project_id into v_page_project
    from public.meta_accounts a
    join public.platforms pl on pl.id = a.platform_id
   where a.meta_object_id = p_page_id
     and pl.slug = 'facebook'
     and a.is_active
   limit 1;

  if v_page_project is null then
    raise exception 'crm_record_leads: page % is not linked to any project', p_page_id;
  end if;

  -- ── Forms first: a lead references one ───────────────────────────────────
  for r in select * from jsonb_array_elements(p_forms)
  loop
    insert into public.crm_lead_forms (project_id, meta_form_id, name, page_id, status)
    values (
      v_page_project,
      r->>'meta_form_id',
      coalesce(r->>'name', 'Untitled form'),
      p_page_id,
      r->>'status'
    )
    on conflict (meta_form_id) do update
       set name       = excluded.name,
           status     = excluded.status,
           /* ⚠️ STILL NOT UPDATED, and now it is load-bearing rather than
              merely careful: this is the column an Admin sets to say "this
              form's leads are ERP enquiries", and an import that reset it would
              undo that every fifteen minutes. */
           updated_at = now();

    n_forms := n_forms + 1;
  end loop;

  -- ── Then the leads ───────────────────────────────────────────────────────
  for r in select * from jsonb_array_elements(p_leads)
  loop
    /* ⚠️ THE FORM'S PROJECT WINS. One page can run campaigns for several
       products — the owner's ERP, CRM and Taskly campaigns all post to the
       AI & Digital page — and the form is the only thing Meta gives us on every
       lead that can tell them apart. Falls back to the page for any form nobody
       has re-mapped, which is every form until somebody does. */
    select id, project_id into v_form, v_form_project
      from public.crm_lead_forms
     where meta_form_id = r->>'form_meta_id' limit 1;

    select id into v_existing from public.crm_leads
     where source = 'meta_lead_ad' and external_id = r->>'external_id' limit 1;

    if v_existing is null then
      insert into public.crm_leads (
        project_id, form_id, source, external_id,
        full_name, phone, phone_e164, email, city,
        answers, submitted_at
      )
      values (
        coalesce(v_form_project, v_page_project), v_form, 'meta_lead_ad', r->>'external_id',
        nullif(trim(coalesce(r->>'full_name', '')), ''),
        nullif(trim(coalesce(r->>'phone', '')), ''),
        nullif(trim(coalesce(r->>'phone_e164', '')), ''),
        nullif(trim(coalesce(r->>'email', '')), ''),
        nullif(trim(coalesce(r->>'city', '')), ''),
        coalesce(r->'answers', '{}'::jsonb),
        (r->>'submitted_at')::timestamptz
      )
      returning id into v_lead;

      insert into public.crm_lead_activity (lead_id, kind, occurred_at, detail)
      values (v_lead, 'imported', (r->>'submitted_at')::timestamptz,
              jsonb_build_object('form', r->>'form_meta_id'));

      n_new := n_new + 1;
    else
      /* ⚠️ A RE-IMPORT REFRESHES WHAT META OWNS AND TOUCHES NOTHING ELSE.
         Stage, owner, notes, next action and temperature are OURS.

         ⚠️ AND `project_id` IS NOT AMONG THEM, WHICH IS NEW AND DELIBERATE. A
         lead already imported keeps the project it has: re-mapping a form is a
         decision about FUTURE leads, and silently moving six hundred existing
         ones between departments — changing who can read them — is not
         something a fifteen-minute cron should do. Moving the ones already
         imported is a separate, deliberate act. */
      update public.crm_leads
         set full_name  = coalesce(nullif(trim(coalesce(r->>'full_name', '')), ''), full_name),
             phone      = coalesce(nullif(trim(coalesce(r->>'phone', '')), ''), phone),
             phone_e164 = coalesce(nullif(trim(coalesce(r->>'phone_e164', '')), ''), phone_e164),
             email      = coalesce(nullif(trim(coalesce(r->>'email', '')), ''), email),
             city       = coalesce(nullif(trim(coalesce(r->>'city', '')), ''), city),
             answers    = coalesce(r->'answers', answers),
             form_id    = coalesce(v_form, form_id)
       where id = v_existing;

      n_updated := n_updated + 1;
    end if;
  end loop;

  return query select n_forms, n_new, n_updated;
end;
$$;

comment on function app.crm_record_leads(text, jsonb, jsonb) is
  'The only path that writes leads (112, amended 127). The FORM decides the '
  'project, falling back to the page — one page can run campaigns for several '
  'products. Never overwrites what a salesperson owns. Safe to run twice.';


-- ════════════════════════════════════════════════════════════════════════════
-- RE-FILING A FORM, AND THE LEADS ALREADY UNDER IT
-- ----------------------------------------------------------------------------
-- Two separate acts, deliberately, because they have different consequences.
-- Pointing a form at another project changes where FUTURE leads go and is
-- harmless. Moving the existing ones changes who can read a stranger's phone
-- number, which is an access change and should be asked for explicitly.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_refile_form(
  p_meta_form_id  text,
  p_project_id    uuid,
  p_move_existing boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_form  uuid;
  n_moved integer := 0;
begin
  /* ⚠️ ADMIN ONLY. Re-filing a form moves a whole campaign's leads between
     departments, which is the same kind of act as moving a person between them
     — and 117 put that with the two accounts that manage people. */
  if not app.acting_at_least('admin'::public.user_role) then
    raise exception 'Only an Admin can re-file a lead form.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.crm_lead_forms
     set project_id = p_project_id, updated_at = now()
   where meta_form_id = p_meta_form_id
   returning id into v_form;

  if v_form is null then
    raise exception 'crm_refile_form: no form with meta id %', p_meta_form_id;
  end if;

  if p_move_existing then
    update public.crm_leads
       set project_id = p_project_id
     where form_id = v_form;
    get diagnostics n_moved = row_count;
  end if;

  return n_moved;
end $$;

comment on function app.crm_refile_form(text, uuid, boolean) is
  'Points a lead form at a project (127). Future leads follow immediately; the '
  'ones already imported move only when asked, because that changes who can '
  'read them.';

grant execute on function app.crm_refile_form(text, uuid, boolean) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ RUNS AS `cni_app` WITH NO SESSION for the importer, exactly as the cron
-- calls it, because RLS fails closed there and a blocked insert returns zero
-- rows while reporting success. 112's own header makes the same point.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin  uuid;
  v_page   text;
  v_pageP  uuid;
  v_other  uuid;
  v_form   uuid;
  v_l1     uuid;
  v_l2     uuid;
  n        integer;
  v_proj   uuid;
begin
  select id into v_admin from public.users where role in ('admin','super_admin') and is_active order by created_at limit 1;

  /* Any linked page, and a DIFFERENT project to re-file onto. */
  select a.meta_object_id, a.project_id into v_page, v_pageP
    from public.meta_accounts a
    join public.platforms pl on pl.id = a.platform_id
   where pl.slug = 'facebook' and a.is_active and a.project_id is not null
   limit 1;

  select id into v_other from public.projects
   where not is_draft and id <> v_pageP limit 1;

  if v_admin is null or v_page is null or v_other is null then
    raise notice '127 · no linked page or second project; the change was applied untested';
    return;
  end if;

  set local role cni_app;
  perform set_config('app.user_id', '', true);   -- the cron has no session

  -- 1 · A first import files by the PAGE, exactly as before.
  perform app.crm_record_leads(
    v_page,
    jsonb_build_array(jsonb_build_object(
      'meta_form_id', '127-form', 'name', '127 ERP campaign', 'status', 'ACTIVE')),
    jsonb_build_array(jsonb_build_object(
      'external_id', '127-lead-a', 'form_meta_id', '127-form',
      'full_name', '127 one', 'submitted_at', now()::text))
  );

  select project_id into v_proj from public.crm_leads where external_id = '127-lead-a';
  if v_proj <> v_pageP then
    raise exception '127 · the first import did not file by the page';
  end if;

  reset role;

  -- 2 · An Admin re-files the form, leaving the existing lead where it is.
  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);
  n := app.crm_refile_form('127-form', v_other, false);
  if n <> 0 then
    raise exception '127 · re-filing moved % existing leads without being asked', n;
  end if;
  reset role;

  select project_id into v_proj from public.crm_leads where external_id = '127-lead-a';
  if v_proj <> v_pageP then
    raise exception
      '127 · re-filing a form silently moved leads already imported, changing who can read them';
  end if;

  -- 3 · ⚠️ THE POINT OF THE FILE. The NEXT lead on that form follows the form,
  --     not the page — which is what tells an ERP enquiry from a Taskly one.
  set local role cni_app;
  perform set_config('app.user_id', '', true);
  perform app.crm_record_leads(
    v_page,
    jsonb_build_array(jsonb_build_object(
      'meta_form_id', '127-form', 'name', '127 ERP campaign', 'status', 'ACTIVE')),
    jsonb_build_array(jsonb_build_object(
      'external_id', '127-lead-b', 'form_meta_id', '127-form',
      'full_name', '127 two', 'submitted_at', now()::text))
  );
  reset role;

  select project_id into v_proj from public.crm_leads where external_id = '127-lead-b';
  if v_proj <> v_other then
    raise exception '127 · a new lead ignored the form''s project';
  end if;

  -- 4 · ⚠️ AND THE RE-IMPORT DID NOT RESET THE FORM. A cron that undid the
  --     re-filing every fifteen minutes would be worse than no re-filing.
  select project_id into v_proj from public.crm_lead_forms where meta_form_id = '127-form';
  if v_proj <> v_other then
    raise exception '127 · the import reset the form''s project';
  end if;

  -- 5 · Moving the existing ones, when asked explicitly.
  set local role cni_app;
  perform set_config('app.user_id', v_admin::text, true);
  n := app.crm_refile_form('127-form', v_other, true);
  if n < 1 then
    raise exception '127 · asking to move the existing leads moved none';
  end if;

  -- 6 · ⚠️ AND NOBODY BELOW ADMIN CAN DO IT. Re-filing a campaign moves a
  --     stranger's phone number between departments.
  perform set_config('app.user_id',
    (select id::text from public.users where role = 'member' and is_active limit 1), true);
  begin
    perform app.crm_refile_form('127-form', v_pageP, false);
    raise exception '127 · a member was allowed to re-file a campaign';
  exception when insufficient_privilege then
    null;
  end;

  reset role;

  select id into v_form from public.crm_lead_forms where meta_form_id = '127-form';
  delete from public.crm_lead_activity
   where lead_id in (select id from public.crm_leads where external_id in ('127-lead-a','127-lead-b'));
  delete from public.crm_leads where external_id in ('127-lead-a', '127-lead-b');
  delete from public.crm_lead_forms where id = v_form;

  raise notice '127 · the form decides the project, a re-file does not move leads already imported, and only an Admin may re-file';
end $$;
