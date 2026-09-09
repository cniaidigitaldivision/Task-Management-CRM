-- ============================================================================
-- 112 · THE LEAD IMPORTER'S TWO FUNCTIONS — Step 2 of docs/crm/08-TWELVE-STEPS
-- ----------------------------------------------------------------------------
-- One reader and one writer, both SECURITY DEFINER, because the importer runs
-- from `pg_cron` with **no session at all**.
--
-- ── ⚠️ WHY THAT DETAIL DECIDES THE WHOLE SHAPE ─────────────────────────────
-- RLS fails CLOSED. A cron job with no `app.current_user_id()` satisfies no
-- policy, so a direct `select` returns zero rows and a direct `insert` writes
-- nothing — and neither raises. The job then reports success having done
-- nothing, which is the worst possible failure: silent, and it looks fine on
-- every dashboard.
--
-- This exact bug has been paid for twice in this codebase already (see the note
-- on `app.meta_accounts_to_sync` in lib/meta/sync.ts, which says it "bit
-- twice"). So the importer never touches a table directly. It calls these two
-- functions and nothing else.
--
-- ⚠️ AND NEITHER IS A GENERAL-PURPOSE BACKDOOR. The reader returns lead SOURCES
-- and their tokens — not leads. The writer accepts leads for a project it
-- resolves itself from the Meta page id, so a caller cannot file a lead against
-- a project by guessing a uuid.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · THE READER — which pages to pull leads from, and with which token
-- ----------------------------------------------------------------------------
-- Deliberately shaped like `app.meta_accounts_to_sync`, because it answers the
-- same question for a different purpose and the two should be read side by side.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_lead_sources(p_project_id uuid default null)
returns table (
  meta_account_id     uuid,
  project_id          uuid,
  project_name        text,
  page_id             text,
  portfolio_name      text,
  token               text,
  expects_vault_token boolean
)
language sql
security definer
set search_path = public, app, vault, pg_temp
stable
as $$
  select a.id,
         p.id,
         p.name,
         a.meta_object_id,
         coalesce(f.name, 'CNI AI & Digital Division'),
         /* Resolved here rather than exposed as a lookup — a general
            `token_for(name)` would let anything holding `cni_app` read any
            secret in the vault by guessing its name. */
         (select s.decrypted_secret
            from vault.decrypted_secrets s
           where s.name = f.token_secret_name
           limit 1),
         f.token_secret_name is not null
    from public.meta_accounts a
    join public.projects  p  on p.id  = a.project_id
    join public.platforms pl on pl.id = a.platform_id
    left join public.meta_portfolios f on f.id = a.portfolio_id
   where a.is_active
     and coalesce(f.is_active, true)
     /* ⚠️ FACEBOOK ONLY. Lead forms belong to a PAGE. Instagram accounts are in
        `meta_accounts` too and have no `leadgen_forms` edge — asking for one
        returns an error that reads like a permission problem. */
     and pl.slug = 'facebook'
     and (p_project_id is null or p.id = p_project_id)
   order by p.name;
$$;

comment on function app.crm_lead_sources(uuid) is
  'Facebook pages to pull lead forms from, with each suite''s system-user token '
  '(112). Null token with expects_vault_token = false means use the environment.';

grant execute on function app.crm_lead_sources(uuid) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · THE WRITER — the only path that stores a lead
-- ----------------------------------------------------------------------------
-- Takes one page's worth of forms and leads as jsonb and upserts the lot in one
-- transaction. Modelled on `app.record_meta_sync` (093), for the same reasons:
-- all-or-nothing, idempotent, and the single place a write can happen.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_record_leads(
  p_page_id text,
  p_forms   jsonb default '[]'::jsonb,
  p_leads   jsonb default '[]'::jsonb
)
returns table (forms_written integer, leads_new integer, leads_updated integer)
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_project   uuid;
  v_form      uuid;
  v_lead      uuid;
  v_existing  uuid;
  r           jsonb;
  n_forms     integer := 0;
  n_new       integer := 0;
  n_updated   integer := 0;
begin
  /* ⚠️ THE PROJECT IS RESOLVED FROM THE PAGE, NOT PASSED IN. The caller says
     which Meta page it pulled from; the database decides which project that is.
     A `p_project_id` parameter would let a bug — or a crafted call — file one
     client's leads under another client's project. */
  select a.project_id into v_project
    from public.meta_accounts a
    join public.platforms pl on pl.id = a.platform_id
   where a.meta_object_id = p_page_id
     and pl.slug = 'facebook'
     and a.is_active
   limit 1;

  if v_project is null then
    raise exception 'crm_record_leads: page % is not linked to any project', p_page_id;
  end if;

  -- ── Forms first: a lead references one ───────────────────────────────────
  for r in select * from jsonb_array_elements(p_forms)
  loop
    insert into public.crm_lead_forms (project_id, meta_form_id, name, page_id, status)
    values (
      v_project,
      r->>'meta_form_id',
      coalesce(r->>'name', 'Untitled form'),
      p_page_id,
      r->>'status'
    )
    on conflict (meta_form_id) do update
       set name       = excluded.name,
           status     = excluded.status,
           /* ⚠️ `project_id` is NOT updated. If somebody has re-mapped a form to
              a different project by hand, an import must not silently undo it. */
           updated_at = now();

    n_forms := n_forms + 1;
  end loop;

  -- ── Then the leads ───────────────────────────────────────────────────────
  for r in select * from jsonb_array_elements(p_leads)
  loop
    select id into v_form from public.crm_lead_forms
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
        v_project, v_form, 'meta_lead_ad', r->>'external_id',
        nullif(trim(coalesce(r->>'full_name', '')), ''),
        nullif(trim(coalesce(r->>'phone', '')), ''),
        nullif(trim(coalesce(r->>'phone_e164', '')), ''),
        nullif(trim(coalesce(r->>'email', '')), ''),
        nullif(trim(coalesce(r->>'city', '')), ''),
        coalesce(r->'answers', '{}'::jsonb),
        (r->>'submitted_at')::timestamptz
      )
      returning id into v_lead;

      /* The timeline starts the moment we learn about them. `occurred_at` is
         when they SUBMITTED, not when we imported — importing a month of
         backlog must not make every lead look like it arrived today. */
      insert into public.crm_lead_activity (lead_id, kind, occurred_at, detail)
      values (v_lead, 'imported', (r->>'submitted_at')::timestamptz,
              jsonb_build_object('form', r->>'form_meta_id'));

      n_new := n_new + 1;
    else
      /* ⚠️ A RE-IMPORT REFRESHES WHAT META OWNS AND TOUCHES NOTHING ELSE.
         Stage, owner, notes, next action and temperature are OURS — a second
         import must never reset a lead somebody has been working. This is what
         makes the job safe to run every fifteen minutes. */
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
  'The only path that writes leads (112). Resolves the project from the Meta '
  'page itself, upserts forms and leads, and never overwrites the fields a '
  'salesperson owns. Safe to run twice — and it will be.';

grant execute on function app.crm_record_leads(text, jsonb, jsonb) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ⚠️ RUNS AS `cni_app` WITH NO SESSION — exactly how the cron will call it. A
-- check made as the schema owner, or with an identity set, proves nothing about
-- the case that actually matters.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_page      text;
  v_project   uuid;
  v_lead      uuid;
  v_admin     uuid;
  n           integer;
  r           record;
begin
  select id into v_admin from public.users
   where role = 'super_admin' and is_active order by created_at limit 1;

  select a.meta_object_id, a.project_id into v_page, v_project
    from public.meta_accounts a
    join public.platforms pl on pl.id = a.platform_id
    join public.projects p on p.id = a.project_id
   where pl.slug = 'facebook' and a.is_active and p.name = 'Chitral Royal Homes'
   limit 1;

  if v_page is null then
    raise notice '112 · no Chitral Facebook page linked; functions created untested';
    return;
  end if;

  set local role cni_app;
  perform set_config('app.user_id', '', true);   -- ⚠️ no session, like the cron

  -- 1 · The reader answers a session-less caller.
  select count(*) into n from app.crm_lead_sources(null);
  if n = 0 then
    raise exception '112 · the reader returned nothing to a session-less caller';
  end if;

  -- 2 · ⚠️ INSTAGRAM IS EXCLUDED. A lead form belongs to a PAGE; asking an
  --     Instagram account for one fails with an error that reads like a
  --     permission problem and costs an hour.
  select count(*) into n
    from app.crm_lead_sources(null) s
    join public.meta_accounts a on a.id = s.meta_account_id
    join public.platforms pl on pl.id = a.platform_id
   where pl.slug <> 'facebook';
  if n > 0 then
    raise exception '112 · the reader returned a non-Facebook account';
  end if;

  -- 3 · The writer stores a lead with no session at all.
  select * into r from app.crm_record_leads(
    v_page,
    '[{"meta_form_id":"112-selfcheck-form","name":"112 self-check","status":"ACTIVE"}]'::jsonb,
    ('[{"external_id":"112-selfcheck-lead","form_meta_id":"112-selfcheck-form",'
     || '"full_name":"112 self-check","phone":"0300-0000000",'
     || '"phone_e164":"+923000000000","answers":{"a":"b"},'
     || '"submitted_at":"2026-01-01T00:00:00Z"}]')::jsonb
  );

  if r.leads_new <> 1 then
    raise exception '112 · the writer stored % new leads, expected 1', r.leads_new;
  end if;

  -- 4 · ⚠️ THE ONE THAT MATTERS MOST. Running it again must add nothing.
  select * into r from app.crm_record_leads(
    v_page,
    '[{"meta_form_id":"112-selfcheck-form","name":"112 self-check","status":"ACTIVE"}]'::jsonb,
    ('[{"external_id":"112-selfcheck-lead","form_meta_id":"112-selfcheck-form",'
     || '"full_name":"112 self-check","phone":"0300-0000000",'
     || '"phone_e164":"+923000000000","answers":{"a":"b"},'
     || '"submitted_at":"2026-01-01T00:00:00Z"}]')::jsonb
  );

  if r.leads_new <> 0 or r.leads_updated <> 1 then
    raise exception '112 · re-import created % new leads; it must create none', r.leads_new;
  end if;


  -- 5 · ⚠️ A RE-IMPORT MUST NOT RESET WORK. Somebody moves the lead along; the
  --     next import leaves that alone.
  --
  --     ⚠️ THE WORK IS DONE UNDER AN IDENTITY, AND THE IMPORT IS NOT. The first
  --     version of this check ran the update with no session and it silently
  --     affected zero rows — `crm_leads_update` needs a coordinator or the
  --     owner, and a session-less caller is neither. The check then failed,
  --     correctly, and for the right reason: it is exactly the "RLS fails
  --     closed and writes nothing while raising nothing" trap this whole
  --     migration is shaped around. Kept as two explicit sessions so the
  --     difference between a person acting and a cron acting is visible.
  perform set_config('app.user_id', v_admin::text, true);

  /* ⚠️ READ UNDER THE IDENTITY, NOT BEFORE IT. The first version fetched this
     id while still session-less; `crm_leads_select` returned no row, `v_lead`
     was NULL, and the update below quietly matched nothing. Two rounds of the
     same trap in one self-check — which is the argument for having written the
     self-check at all. */
  select id into v_lead from public.crm_leads where external_id = '112-selfcheck-lead';
  if v_lead is null then
    raise exception '112 · the self-check could not read back the lead it wrote';
  end if;

  update public.crm_leads set stage = 'qualified', next_action = 'call back'
   where id = v_lead;

  select count(*) into n from public.crm_leads
   where id = v_lead and stage = 'qualified';
  if n <> 1 then
    raise exception '112 · the self-check could not set up its own state';
  end if;

  /* ⚠️ THE IMPORT RUNS SESSION-LESS — that is the thing being proved — and
     every ASSERTION about the result runs under an identity, because a
     session-less read returns nothing and would make each check pass or fail
     for the wrong reason. Getting this backwards cost three runs of this
     migration, each failing with a message that pointed at the writer when the
     fault was in the reading. */
  perform set_config('app.user_id', '', true);   -- the cron's world

  perform app.crm_record_leads(
    v_page, '[]'::jsonb,
    ('[{"external_id":"112-selfcheck-lead","form_meta_id":"112-selfcheck-form",'
     || '"full_name":"112 self-check","submitted_at":"2026-01-01T00:00:00Z"}]')::jsonb
  );

  perform set_config('app.user_id', v_admin::text, true);   -- back to a person

  select count(*) into n from public.crm_leads
   where id = v_lead and stage = 'qualified' and next_action = 'call back';
  if n <> 1 then
    raise exception '112 · a re-import reset work a salesperson had done';
  end if;

  -- 6 · The project came from the page, and is the right one.
  select count(*) into n from public.crm_leads
   where id = v_lead and project_id = v_project;
  if n <> 1 then
    raise exception '112 · the lead was filed against the wrong project';
  end if;

  -- 7 · An unlinked page is refused rather than filed somewhere plausible.
  perform set_config('app.user_id', '', true);
  begin
    perform app.crm_record_leads('000-not-a-linked-page', '[]'::jsonb, '[]'::jsonb);
    raise exception '112 · leads were accepted for a page linked to no project';
  exception when raise_exception then
    if sqlerrm like '%not linked to any project%' then null; else raise; end if;
  end;

  reset role;

  -- ⚠️ BY ID / BY KEY, never by predicate over live rows. Migration 082.
  delete from public.crm_lead_activity where lead_id = v_lead;
  delete from public.crm_leads         where id = v_lead;
  delete from public.crm_lead_forms    where meta_form_id = '112-selfcheck-form';

  raise notice '112 · importer functions work with no session, and a re-import changes nothing';
end $$;
