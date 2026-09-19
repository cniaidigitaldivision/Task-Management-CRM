-- ============================================================================
-- 213 · A CONNECTION STARTS FROM A DATE, NOT FROM THE BEGINNING OF TIME
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-19: *"These 665 leads are old leads. I don't need all these
-- leads for any purpose… When we connect, take leads that are just 1 week old…
-- I don't want to dump a lot of data into my database… start taking leads from
-- today. When any new leads come up, they fall into the CRM."*
--
-- ── ⚠️ THE IMPORTER HAS NO CUTOFF AT ALL, AND THAT IS THE BUG ──────────────
-- `leadsForForm` follows Meta's paging **to the end of the form**, so connecting
-- a page pulls every lead it has ever collected. That is how 660 leads from
-- two and three months ago arrived — most never worked, some already handled by
-- hand outside the system, and every one of them now noise in the desk's counts,
-- the reports, and the "who has been neglected" alerts.
--
-- ── ⚠️ AND IT IS NOT ONLY CLUTTER ──────────────────────────────────────────
-- A greeting, a sequence or an agent switched on later reads the lead table. An
-- old lead that looks new is a person who gets messaged about an enquiry they
-- made in July and have forgotten. **The cutoff is a safety rule as much as a
-- storage one.**
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
-- One column: `crm_project_settings.leads_from`. Only leads SUBMITTED on or
-- after it are taken. Null means "everything", which is today's behaviour and
-- stays the behaviour for anybody who does not set it.
--
-- ⚠️ ON `submitted_at`, NEVER ON WHEN WE IMPORTED. The owner's sentence is about
-- when the PERSON enquired. Filtering on our own import clock would let a
-- three-month-old lead through on the day we first happen to see it, which is
-- exactly the case being excluded.
-- ============================================================================

alter table public.crm_project_settings
  add column if not exists leads_from timestamptz;

comment on column public.crm_project_settings.leads_from is
  'Only import leads SUBMITTED on or after this moment. Null imports everything — the old behaviour. Set it to now() when connecting a campaign so the CRM starts from today rather than swallowing the form''s whole history. 213.';


-- ── The importer asks for it, per project ───────────────────────────────────
-- ⚠️ REPRODUCED FROM THE LIVE DEFINITION with one column added, and DROPPED
-- first because `create or replace` cannot widen a return type. The body is
-- 160's, unchanged — including the Facebook-only rule, which exists because
-- lead forms belong to a PAGE and asking an Instagram account for `leadgen_forms`
-- returns an error that reads like a permission problem.
drop function if exists app.crm_lead_sources(uuid);

create or replace function app.crm_lead_sources(p_project_id uuid default null)
returns table (
  meta_account_id uuid,
  project_id uuid,
  project_name text,
  page_id text,
  portfolio_name text,
  token text,
  expects_vault_token boolean,
  leads_from timestamptz
)
language sql
stable
security definer
set search_path = public, app, vault, pg_temp
as $fn$
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
         f.token_secret_name is not null,
         /* 213 · the cutoff, or null for "everything" — the old behaviour. */
         st.leads_from
    from public.meta_accounts a
    join public.projects  p  on p.id  = a.project_id
    join public.platforms pl on pl.id = a.platform_id
    left join public.meta_portfolios f on f.id = a.portfolio_id
    left join public.crm_project_settings st on st.project_id = p.id
   where a.is_active
     and coalesce(f.is_active, true)
     and pl.slug = 'facebook'
     and (p_project_id is null or p.id = p_project_id)
   order by p.name;
$fn$;

grant execute on function app.crm_lead_sources(uuid) to cni_app;


-- ============================================================================
-- SELF-CHECK — the column exists, the function returns it, and null still means
-- "everything" so nobody's existing import changes under them
-- ============================================================================
do $chk$
declare
  v_project uuid;
  v_has_column boolean;
  v_returned boolean;
  v_null_default boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_project_settings'
       and column_name = 'leads_from')
    into v_has_column;
  if not v_has_column then
    raise exception '213 · leads_from was not added';
  end if;

  select exists (
    select 1 from information_schema.routines r
      join information_schema.parameters pm on pm.specific_name = r.specific_name
     where r.routine_schema = 'app' and r.routine_name = 'crm_lead_sources'
       and pm.parameter_name = 'leads_from')
    into v_returned;
  if not v_returned then
    raise exception '213 · crm_lead_sources does not hand the importer the cutoff';
  end if;

  /* ⚠️ EVERY EXISTING PROJECT MUST STILL BE NULL. A migration that quietly set a
     cutoff would stop an import somebody is relying on, with no message. */
  select not exists (select 1 from public.crm_project_settings where leads_from is not null)
    into v_null_default;
  if not v_null_default then
    raise exception '213 · a project was given a cutoff by the migration itself';
  end if;

  select p.id into v_project from public.projects p limit 1;
  if v_project is null then
    raise notice '213 · no projects to check the join against';
  end if;

  raise notice '213 · leads_from exists, is null everywhere, and reaches the importer';
end $chk$;
