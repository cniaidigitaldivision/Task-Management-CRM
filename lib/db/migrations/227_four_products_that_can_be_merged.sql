-- ============================================================================
-- 227 · FOUR PRODUCTS THAT CAN BE MERGED, NOT ONE PRODUCT WITH FOUR NAMES
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-20, correcting the first extraction:
--
--   *"That's not the Taskly CRM… We have three separate software programs:
--   Taskly, CRM, ERP… Taskly is a task management system… CRM is a lead
--   management system. It is a separate system and a separate software program
--   but I am merging this CRM into this Taskly also… ERP is like a proper
--   inventory management system… In the same way, WhatsApp Automation is
--   separate software but if someone says 'I need a CRM in which WhatsApp
--   Business Automation is also there', then we can merge these two."*
--
-- 226 stored knowledge per PROJECT, which is a campaign, and the extractor then
-- invented the compound name **"Taskly CRM"** for every answer — a product that
-- does not exist. An agent opening with that is wrong in its first sentence, and
-- wrong in a way a client will repeat back.
--
-- ── ⚠️ WHY THIS IS A COLUMN AND NOT A PROMPT FIX ───────────────────────────
-- Telling the model the right name would fix these eleven answers and nothing
-- else. The real shape of the business is that **an answer belongs to a
-- product**: "what does it manage" has four different true answers, and the one
-- that is correct depends on which product the client enquired about. Without
-- this column, the ERP's inventory answer and the CRM's pipeline answer sit in
-- one bag and the agent picks whichever reads best.
--
-- ── ⚠️ AND `any` IS NOT A DUMPING GROUND ───────────────────────────────────
-- It is for facts true of the business rather than of a product — who we are,
-- and the merging rule itself, which is the owner's whole commercial model:
-- **any combination can be delivered as one system.** That fact has to be
-- reachable from every product's conversation, because it is the answer to
-- "can it also do inventory?" whichever product they started from.
-- ============================================================================

create type public.crm_product as enum (
  'taskly',    -- tasks, projects, team, customers, finance, expenses, attendance, performance
  'crm',       -- lead management
  'erp',       -- inventory management
  'whatsapp',  -- WhatsApp Business API automation
  'any'        -- true of the business, or of every product — including "they can be merged"
);

comment on type public.crm_product is
  'The four things this business sells, sold separately or merged into one system. ⚠️ There is no product called "Taskly CRM" — that name was invented by an extraction and corrected by the owner on 2026-09-20.';

alter table public.crm_knowledge
  add column product public.crm_product not null default 'any';

comment on column public.crm_knowledge.product is
  'Which product this answer is about. ⚠️ "What does it manage" has four different true answers; the agent must be given the one for the product the client enquired about, plus the "any" entries.';

/* ⚠️ THE UNIQUENESS RULE MOVES WITH IT. "What is included?" is a DIFFERENT
   question for the CRM and for the ERP, and 226's index would have refused the
   second one as a duplicate — silently teaching the agent one product's answer
   for all four. */
drop index if exists public.crm_knowledge_one_question_idx;

/* ⚠️ TRIMMED AFTER NORMALISING, NOT BEFORE — 226 had this the wrong way round
   and this migration's own self-check caught it. Trailing punctuation becomes a
   trailing SPACE, so "What is included?" and "What is included" normalised to
   two different strings and both would have been stored. Two rows, one
   question, and eventually two answers that disagree. */
create unique index crm_knowledge_one_question_idx
  on public.crm_knowledge (
    project_id,
    product,
    btrim(lower(regexp_replace(question, '[^a-zA-Z0-9]+', ' ', 'g')))
  );

create index crm_knowledge_product_idx on public.crm_knowledge (product, status);


-- ── Which product a campaign is selling ─────────────────────────────────────
/*
 * ⚠️ A LEAD ARRIVES ASKING ABOUT ONE THING. A lead from the CRM campaign wants
 * lead management; answering it with the ERP's inventory features is the same
 * mistake as the compound name, one layer down. The campaign knows which
 * product it advertises, so the campaign is where this is recorded.
 *
 * Null means the campaign sells the whole range — then the agent has to ask
 * before it can answer anything product-specific.
 */
alter table public.crm_project_settings
  add column product public.crm_product;

comment on column public.crm_project_settings.product is
  'The product this campaign advertises. Null = the whole range, and the agent must ask which one before answering product questions.';


-- ── What the agent may read, now per product ────────────────────────────────
/*
 * ⚠️ REPLACED, NOT WIDENED. `crm_knowledge_for(uuid)` would still compile and
 * would now return every product's answers in one list — the exact failure this
 * migration exists to prevent. It is dropped so that any caller not updated
 * fails loudly instead of quietly teaching the agent four products at once.
 */
drop function if exists app.crm_knowledge_for(uuid);

create or replace function app.crm_knowledge_for(p_project uuid, p_product public.crm_product)
returns table(question text, answer text, source_quote text, product text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select k.question, k.answer, k.source_quote, k.product::text
    from public.crm_knowledge k
   where k.project_id = p_project
     and k.status = 'approved'
     and (k.expires_at is null or k.expires_at >= (now() at time zone 'Asia/Karachi')::date)
     /* The product asked about, plus what is true whatever they asked about.
        ⚠️ A null product means "we do not know yet", and then only the `any`
        entries are safe — the agent asks which product before it answers. */
     and (k.product = 'any' or (p_product is not null and k.product = p_product))
   order by (k.product = 'any'), k.question
$fn$;

grant execute on function app.crm_knowledge_for(uuid, public.crm_product) to cni_app;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid;
  n_crm int; n_erp int; n_unknown int; v_dupe boolean := false;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '227 · fixtures missing';
  end if;

  begin
    perform set_config('app.user_id', v_owner::text, true);

    insert into public.crm_knowledge (project_id, product, question, answer, status, is_test_data)
    values
      (v_project, 'crm',  'SELFCHECK what does it manage', 'Leads.',     'approved', true),
      (v_project, 'erp',  'SELFCHECK what does it manage', 'Inventory.', 'approved', true),
      (v_project, 'any',  'SELFCHECK can they be merged',  'Yes.',       'approved', true),
      (v_project, 'taskly', 'SELFCHECK what does it manage', 'Tasks.',   'draft',    true);

    /* 1 · A CRM conversation hears the CRM answer and the business-wide one. */
    select count(*)::int into n_crm from app.crm_knowledge_for(v_project, 'crm')
     where question like 'SELFCHECK%';

    /* 2 · An ERP conversation hears the ERP answer, never the CRM's. */
    select count(*)::int into n_erp from app.crm_knowledge_for(v_project, 'erp')
     where question like 'SELFCHECK%' and answer = 'Leads.';

    /* 3 · ⚠️ AND A CAMPAIGN SELLING THE WHOLE RANGE HEARS ONLY WHAT IS ALWAYS
         TRUE, so the agent has to ask which product rather than guess. */
    select count(*)::int into n_unknown from app.crm_knowledge_for(v_project, null)
     where question like 'SELFCHECK%';

    /* 4 · The same question for the same product twice is still refused. */
    begin
      insert into public.crm_knowledge (project_id, product, question, answer, status, is_test_data)
      values (v_project, 'crm', 'SELFCHECK  what   does it MANAGE!', 'Leads again.', 'draft', true);
    exception when unique_violation then
      v_dupe := true;
    end;

    raise exception using errcode = 'P0228', message = '227 rollback';
  exception when sqlstate 'P0228' then
    null;
  end;

  if n_crm <> 2 then
    raise exception '227 · a CRM conversation saw % entries, expected the CRM one and the business-wide one', n_crm;
  end if;
  if n_erp <> 0 then
    raise exception '227 · an ERP conversation was handed the CRM answer';
  end if;
  if n_unknown <> 1 then
    raise exception '227 · a campaign with no product saw % entries, expected only the always-true one', n_unknown;
  end if;
  if not v_dupe then
    raise exception '227 · the same question was stored twice for one product';
  end if;

  raise notice '227 · four products, each answering for itself, and what is true of all of them';
end $chk$;
