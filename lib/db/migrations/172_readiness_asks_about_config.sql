-- ============================================================================
-- 172 · READINESS ASKS ABOUT CONFIGURATION, NOT ABOUT WHO IS ASKING
-- ----------------------------------------------------------------------------
-- ⚠️ A BUG IN 171, FOUND THE SAME DAY AND BEFORE ANY SCREEN READ IT.
--
-- `app.crm_project_readiness()` called `app.crm_project_can_whatsapp()`, which
-- answers TWO questions at once:
--
--     whatsapp_phone_number_id is not null          -- is it configured?
--   AND (crm_manages_project OR crm_in_project_department)  -- may YOU send?
--
-- That pairing is exactly right for the desk's send button. It is wrong here.
-- Readiness runs inside a SECURITY DEFINER with no `app.user_id`, so both access
-- predicates were false, so **every project came back "no WhatsApp number"** —
-- including the demo project, which has one configured and 17 real messages
-- already sent through it.
--
-- ⚠️ AND IT WOULD HAVE BEEN WRONG FOR AN ADMIN TOO, who is a member of nothing
-- and manages nothing. Same family as migrations 105, 121, 125, 129, 130, 140
-- and `crmAddLeadProjects` — the tenth time in this codebase that an access
-- predicate was asked a question that was not about access.
--
-- ── ⚠️ WHY THIS ONE MATTERED MORE THAN THE USUAL ───────────────────────────
-- The owner asked for exactly this feature: *"mention it again and again with a
-- red flag… each time they should know that I have to provide this."* **A
-- red-flag list that is wrong on every row teaches people to ignore red flags.**
-- A readiness report is only worth having if it is never crying wolf, so this is
-- a correctness bug in the one place where being wrong is self-defeating.
-- ============================================================================

create or replace function app.crm_project_readiness(p_project uuid)
returns table (code text, severity text, what text, blocks text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  with s as (select * from public.crm_project_settings where project_id = p_project),
       items as (select * from public.crm_properties where project_id = p_project)

  select 'no_catalogue', 'blocking',
         'No plots or services have been listed for this project.',
         'quotations, proposals'
   where not exists (select 1 from items)

  union all
  select 'incomplete_prices', 'blocking',
         (select count(*)::text from items where price_mid is null or price_floor is null)
           || ' item(s) are missing their second or third price.',
         'the quotation ladder'
   where exists (select 1 from items where price_mid is null or price_floor is null)

  union all
  select 'incomplete_plots', 'warning',
         (select count(*)::text from items
           where catalogue_kind in ('plot', 'unit')
             and (plot_number is null or block is null or size_marla is null))
           || ' plot(s) have no plot number, block or size.',
         'what the quotation can print'
   where exists (
     select 1 from items where catalogue_kind in ('plot', 'unit')
       and (plot_number is null or block is null or size_marla is null)
   )

  union all
  select 'service_no_scope', 'warning',
         (select count(*)::text from items
           where catalogue_kind = 'service' and coalesce(trim(scope_note), '') = '')
           || ' service(s) have no scope written.',
         'what the client is agreeing to'
   where exists (
     select 1 from items where catalogue_kind = 'service'
       and coalesce(trim(scope_note), '') = ''
   )

  union all
  select 'no_letterhead', 'blocking',
         'No letterhead has been uploaded for this project.',
         'printing a quotation or proposal'
   where not exists (select 1 from s where coalesce(trim(letterhead_path), '') <> '')

  union all
  select 'no_settings', 'blocking',
         'This project has no CRM settings.',
         'the response clock and every reminder'
   where not exists (select 1 from s)

  union all
  /* ⚠️ THE COLUMN, NOT `crm_project_can_whatsapp()`. "Is a number configured" is
     a fact about the PROJECT and the same for everybody who asks. "May I send"
     is a fact about the CALLER. Readiness is only ever asking the first. */
  select 'no_whatsapp', 'warning',
         'No WhatsApp number is configured for this project.',
         'WhatsApp conversations and sequences'
   where not exists (
     select 1 from public.projects p
      where p.id = p_project and p.whatsapp_phone_number_id is not null
   )

  union all
  select 'no_sequence', 'warning',
         'No follow-up sequence has been set up.',
         'the chase running itself'
   where not exists (
     select 1 from public.crm_sequences q
      where q.project_id = p_project and q.is_active
   )
$$;


-- ============================================================================
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ THE REGRESSION GUARD IS THAT THE ANSWER DOES NOT DEPEND ON WHO ASKS.
-- Reading the fixed function once would have passed before this migration too,
-- as long as it was read by somebody with access. The bug only showed up from a
-- sessionless caller — so the check runs it BOTH ways and compares.
-- ============================================================================
do $chk$
declare
  v_configured uuid; v_sales uuid;
  as_nobody boolean; as_person boolean; as_admin boolean;
  v_admin uuid;
begin
  select id into v_configured
    from public.projects
   where whatsapp_phone_number_id is not null and lead_department_id is not null
   limit 1;
  if v_configured is null then
    raise exception '172 · no project with a WhatsApp number — the bug this fixes cannot be proved';
  end if;

  select e.user_id into v_sales
    from app.crm_eligible_owners(v_configured) e where e.eligible limit 1;
  select id into v_admin from public.users
   where role in ('admin', 'super_admin') and is_active limit 1;

  /* 1 · As nobody at all — the sessionless definer path that broke. */
  as_nobody := exists (
    select 1 from app.crm_project_readiness(v_configured) where code = 'no_whatsapp'
  );
  if as_nobody then
    raise exception '172 · a project WITH a configured number still reported no_whatsapp';
  end if;

  /* 2 · As the salesperson who works it. */
  if v_sales is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);
    as_person := exists (
      select 1 from app.crm_project_readiness(v_configured) where code = 'no_whatsapp'
    );
    reset role;
    if as_person is distinct from as_nobody then
      raise exception '172 · readiness gave a different answer to a salesperson than to nobody';
    end if;
  end if;

  /* 3 · ⚠️ AND AS AN ADMIN, who is a member of nothing and manages nothing —
     the session that hides this entire class of bug. */
  if v_admin is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_admin::text, true);
    as_admin := exists (
      select 1 from app.crm_project_readiness(v_configured) where code = 'no_whatsapp'
    );
    reset role;
    if as_admin is distinct from as_nobody then
      raise exception '172 · readiness gave a different answer to an admin than to nobody';
    end if;
  end if;

  /* 4 · And a project with NO number must still be flagged, or the fix has
     simply switched the check off. */
  if exists (select 1 from public.projects where whatsapp_phone_number_id is null
               and lead_department_id is not null) then
    if not exists (
      select 1 from app.crm_project_readiness(
        (select id from public.projects
          where whatsapp_phone_number_id is null and lead_department_id is not null limit 1))
       where code = 'no_whatsapp'
    ) then
      raise exception '172 · a project with no number was no longer flagged';
    end if;
  end if;

  raise notice '172 · readiness now reports the CONFIGURATION, identically to nobody, to a salesperson and to an admin — and still flags a project that genuinely has no number';
end $chk$;
