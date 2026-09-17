-- ============================================================================
-- 171 · THE CATALOGUE SELLS SERVICES TOO, AND EVERY ITEM CARRIES THREE PRICES
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17: *"For every project you will set three quotations… Give me
-- three quotation files for CRM. Give me three quotation files for ERP. Total
-- six files… keep them separate with their proper service names."*
--
-- And the ladder itself, in the owner's own worked example: **2 lakh → 1.5 lakh
-- → 1 lakh.** The client's budget picks which one OPENS. Tier 3 is the floor and
-- nothing goes below it.
--
-- ── ⚠️ `crm_properties` NOW HOLDS THINGS THAT ARE NOT PROPERTIES ───────────
-- The table keeps its name deliberately. Renaming it would rewrite 150's
-- policies, `crm_leads.property_id`, `crm_quotations.property_id`,
-- `crm_appointments.property_id` and every query over them — a large, risky
-- change that buys a better noun. `catalogue_kind` is the discriminator and this
-- comment is the explanation. **Read it as "a thing we can sell".**
--
-- ⚠️ AND THE PLOT FIELDS WERE ALREADY NULLABLE, which is the only reason this is
-- cheap. A service simply leaves `plot_number`, `block`, `size_marla` and
-- `is_corner` empty, and the screens ask `catalogue_kind` before drawing them —
-- the per-project switch Phase C flagged, arriving as a real column.
-- ============================================================================

create type public.crm_catalogue_kind as enum ('plot', 'unit', 'service');

alter table public.crm_properties
  /* ⚠️ NOT THE SAME AS `kind`. That is free text — "Residential plot", "5 Marla
     corner" — written for a human to read on a quotation. This is the structural
     answer the CODE asks: which fields apply, and what a quotation prints. */
  add column catalogue_kind public.crm_catalogue_kind not null default 'plot',

  /* ── The ladder. `base_price` is already tier 1 and keeps its name. ────── */
  add column price_mid   numeric(14,2),
  add column price_floor numeric(14,2),

  /* For a service, what the buyer actually gets. A plot's description is its
     dimensions; a service's is its scope, and quoting one without it is how a
     dispute about "what was included" starts. */
  add column scope_note text;

comment on column public.crm_properties.catalogue_kind is
  'plot | unit | service. Decides which fields apply and what a quotation prints. `kind` is the human label; this is the structural one.';
comment on column public.crm_properties.base_price is
  'Tier 1 — list. The opening price for anyone who has not pushed back.';
comment on column public.crm_properties.price_mid is
  'Tier 2 — the negotiable opener, used when the stated budget is below list.';
comment on column public.crm_properties.price_floor is
  'Tier 3 — THE FLOOR. The last quotation. Nothing may be sold below it.';

/* ⚠️ THE LADDER MUST DESCEND. A floor above the list price is a typo that would
   otherwise be discovered by a client being quoted more for pushing back. Nulls
   pass, because an item mid-setup is not yet wrong — the readiness report below
   is what chases those. */
alter table public.crm_properties
  add constraint crm_properties_ladder_descends check (
    (price_mid is null or base_price is null or price_mid <= base_price)
    and (price_floor is null or price_mid is null or price_floor <= price_mid)
    and (price_floor is null or base_price is null or price_floor <= base_price)
  );

grant update (price_mid, price_floor, scope_note, catalogue_kind)
  on public.crm_properties to cni_app;
/* ⚠️ Still no grant on `base_price`, and that is 150's rule standing: a price is
   the company's, not the seller's. These three are added for whoever maintains
   the catalogue, and 150's policy already limits writes to somebody who manages
   the project's department. */


-- ════════════════════════════════════════════════════════════════════════════
-- THE FLOOR IS ENFORCED, NOT ADVISED
-- ----------------------------------------------------------------------------
-- ⚠️ A TRIGGER, NOT A CHECK, because it reads another table. And it fires on the
-- APPROVED figure as well as the asked-for one: the whole point of a floor is
-- that it survives a manager having a generous afternoon.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.crm_quotation_respects_floor()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_floor numeric(14,2);
  v_code  text;
begin
  if new.property_id is null then
    return new;
  end if;

  select price_floor, code into v_floor, v_code
    from public.crm_properties where id = new.property_id;

  /* No floor set is not a licence to go to zero — it means nobody has decided
     yet, and the readiness report is already asking them to. */
  if v_floor is null then
    return new;
  end if;

  if new.net_amount < v_floor then
    raise exception
      using errcode = 'CRM09',
            message = 'That is below the floor price for this item.',
            detail  = coalesce(v_code, 'This item') || ' may not be sold below '
                      || to_char(v_floor, 'FM999,999,999'),
            hint    = 'The floor is the last quotation. Below it, the answer is a smaller item or a lost lead.';
  end if;

  return new;
end;
$fn$;

create trigger crm_quotations_respect_floor
  before insert or update of net_amount, approved_discount on public.crm_quotations
  for each row execute function app.crm_quotation_respects_floor();


-- ════════════════════════════════════════════════════════════════════════════
-- THE LETTERHEAD
-- ----------------------------------------------------------------------------
-- Owner: *"For AI and Digital I am giving you a letterhead in which you will put
-- all the information. In the same way for any project like Investo, I will
-- provide you with the Investo letterhead."*
-- ⚠️ PER PROJECT, because it is the CLIENT's brand on the page, not ours. One
-- shared letterhead would print Chitral's quotation on the division's paper.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.crm_project_settings
  add column letterhead_path text,
  add column quotation_terms text;

comment on column public.crm_project_settings.letterhead_path is
  'Storage path to this project''s letterhead. NULL means a quotation cannot be printed for it — see app.crm_project_readiness().';


-- ════════════════════════════════════════════════════════════════════════════
-- WHAT IS MISSING — "mention it again and again with a red flag"
-- ----------------------------------------------------------------------------
-- Owner: *"If the information is absent you will say: please give me a correct
-- file with all these things… Each time they should know that I have to provide
-- this, then I can send a campaign or a quotation or a proposal."*
--
-- ⚠️ A FUNCTION, NOT A SCREEN'S OWN ARITHMETIC. The same answer is needed by the
-- catalogue page, the quotation form, the campaign setup and eventually the
-- agent — four places that would otherwise each decide for themselves what
-- "ready" means, and disagree by the second month.
--
-- ⚠️ AND IT NAMES THE FIX, NOT THE FAULT. "No letterhead" is a complaint;
-- "upload the letterhead and a quotation can be printed" is an instruction.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.crm_project_readiness(p_project uuid)
returns table (code text, severity text, what text, blocks text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  with s as (select * from public.crm_project_settings where project_id = p_project),
       items as (select * from public.crm_properties where project_id = p_project)

  -- 1 · Nothing to sell at all.
  select 'no_catalogue', 'blocking',
         'No plots or services have been listed for this project.',
         'quotations, proposals'
   where not exists (select 1 from items)

  union all
  -- 2 · ⚠️ THE OWNER'S OWN COMPLAINT, made machine-readable. An item with only
  --     one price cannot run the ladder — there is nothing to open at and
  --     nothing to stop at.
  select 'incomplete_prices', 'blocking',
         (select count(*)::text from items where price_mid is null or price_floor is null)
           || ' item(s) are missing their second or third price.',
         'the quotation ladder'
   where exists (select 1 from items where price_mid is null or price_floor is null)

  union all
  -- 3 · Plot detail a quotation is supposed to print.
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
  -- 4 · A service quoted with no scope is a dispute about what was included.
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
  -- 5 · The letterhead.
  select 'no_letterhead', 'blocking',
         'No letterhead has been uploaded for this project.',
         'printing a quotation or proposal'
   where not exists (select 1 from s where coalesce(trim(letterhead_path), '') <> '')

  union all
  -- 6 · No settings row at all — no SLA, no reminder, no ladder policy.
  select 'no_settings', 'blocking',
         'This project has no CRM settings.',
         'the response clock and every reminder'
   where not exists (select 1 from s)

  union all
  -- 7 · Nothing to send from. ⚠️ A warning rather than blocking: a quotation can
  --     still go by email, which is exactly why email matters.
  select 'no_whatsapp', 'warning',
         'No WhatsApp number is configured for this project.',
         'WhatsApp conversations and sequences'
   where not app.crm_project_can_whatsapp(p_project)

  union all
  -- 8 · No chase defined.
  select 'no_sequence', 'warning',
         'No follow-up sequence has been set up.',
         'the chase running itself'
   where not exists (
     select 1 from public.crm_sequences q
      where q.project_id = p_project and q.is_active
   )
$$;

comment on function app.crm_project_readiness(uuid) is
  'What is still missing before this project can quote, propose or campaign. Severity is blocking or warning. Named so the answer is the same everywhere it is asked.';

grant execute on function app.crm_project_readiness(uuid) to cni_app;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_item uuid; v_lead uuid; v_quote uuid;
  refused boolean; n_blocking integer; v_codes text;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  if v_project is null then
    raise exception '171 · no demo sales project — the fixture this check needs does not exist';
  end if;

  select e.user_id into v_sales
    from app.crm_eligible_owners(v_project) e where e.eligible limit 1;
  if v_sales is null then raise exception '171 · nobody eligible'; end if;

  -- 1 · ⚠️ A SERVICE IS A CATALOGUE ITEM. The owner's own example: our CRM at
  --     2 lakh / 1.5 lakh / 1 lakh, with no plot number anywhere.
  insert into public.crm_properties
    (project_id, code, kind, catalogue_kind, base_price, price_mid, price_floor,
     scope_note, is_test_data, created_by_id)
  values
    (v_project, 'SELFCHECK-171-CRM', 'CRM implementation', 'service',
     200000, 150000, 100000, 'Setup, training, three months support.', true, v_sales)
  returning id into v_item;

  if (select plot_number from public.crm_properties where id = v_item) is not null then
    delete from public.crm_properties where id = v_item;
    raise exception '171 · a service was forced to carry plot fields';
  end if;

  -- 2 · ⚠️ THE LADDER MUST DESCEND.
  refused := false;
  begin
    update public.crm_properties set price_floor = 250000 where id = v_item;
  exception when check_violation then refused := true;
  end;
  if not refused then
    delete from public.crm_properties where id = v_item;
    raise exception '171 · a floor ABOVE the list price was accepted';
  end if;

  -- 3 · ⚠️ THE FLOOR IS ENFORCED ON A QUOTATION, not merely advised.
  insert into public.crm_leads
    (project_id, owner_id, source, full_name, phone, stage, is_test_data,
     submitted_at, property_id, budget_band, authority, purpose, timeline)
  values
    (v_project, v_sales, 'manual', 'SELFCHECK-171', '+920000000171', 'qualified', true,
     now(), v_item, 'not_disclosed', 'unknown', 'unknown', 'unknown')
  returning id into v_lead;

  refused := false;
  begin
    insert into public.crm_quotations
      (lead_id, property_id, project_id, number, version, base_price,
       premium_charges, requested_discount, net_amount, status, prepared_by_id, is_test_data)
    values (v_lead, v_item, v_project, 'SELFCHECK-171', 1, 200000, 0, 150000,
            50000, 'draft', v_sales, true);
  exception when sqlstate 'CRM09' then refused := true;
  end;
  if not refused then
    delete from public.crm_quotations where number = 'SELFCHECK-171';
    delete from public.crm_leads where id = v_lead;
    delete from public.crm_properties where id = v_item;
    raise exception '171 · a quotation below the floor was accepted';
  end if;

  -- 4 · And AT the floor is fine — the floor is the last quotation, not a wall
  --     one rupee above it.
  insert into public.crm_quotations
    (lead_id, property_id, project_id, number, version, base_price,
     premium_charges, requested_discount, net_amount, status, prepared_by_id, is_test_data)
  values (v_lead, v_item, v_project, 'SELFCHECK-171', 1, 200000, 0, 100000,
          100000, 'draft', v_sales, true)
  returning id into v_quote;

  -- 5 · ⚠️ THE READINESS REPORT NAMES WHAT IS MISSING. The demo project has no
  --     letterhead, so at minimum that must come back as blocking.
  select count(*) filter (where severity = 'blocking'),
         string_agg(code, ', ' order by code)
    into n_blocking, v_codes
    from app.crm_project_readiness(v_project);

  if n_blocking = 0 then
    raise exception '171 · readiness reported nothing blocking on a project with no letterhead';
  end if;
  if position('no_letterhead' in coalesce(v_codes, '')) = 0 then
    raise exception '171 · readiness did not flag the missing letterhead (got: %)', v_codes;
  end if;

  -- 6 · ⚠️ A SALESPERSON MAY READ IT. A list of what is missing that only an
  --     admin can see is a list nobody acts on.
  set local role cni_app;
  perform set_config('app.user_id', v_sales::text, true);
  perform 1 from app.crm_project_readiness(v_project);
  reset role;

  delete from public.crm_quotations where id = v_quote;
  delete from public.crm_leads where id = v_lead;
  delete from public.crm_properties where id = v_item;

  raise notice '171 · a service lives in the catalogue without plot fields, the ladder must descend, a quotation below the floor is refused and at the floor is allowed, and readiness names the missing letterhead (%)', v_codes;
end $chk$;
