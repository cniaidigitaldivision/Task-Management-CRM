-- ============================================================================
-- 233 · THE AGENT FOLLOWS THE CLIENT TO ANOTHER PRODUCT
-- ----------------------------------------------------------------------------
-- Dry run, 2026-09-21, on the owner's own demo lead: the lead was filed as
-- Taskly (from its first message), the client then asked *"Can you give me more
-- detail about the CRM?"* — and the agent handed over, because it had only been
-- shown the Taskly answers and the Taskly documents. The CRM proposal was on the
-- shelf the whole time.
--
-- The business sells four separate products and a client may ask about any of
-- them, or two. So the agent is now shown EVERY approved answer, each tagged
-- with its product, and the code (agent-brain.ts) only lets it send a document
-- for the product the client is asking about now.
--
-- ⚠️ 227's crm_knowledge_for is unchanged — the knowledge page and anything else
-- reading one product's answers keeps doing exactly that.
-- ============================================================================

create or replace function app.crm_agent_knowledge(p_project uuid)
returns table(question text, answer text, product text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select k.question, k.answer, k.product::text
    from public.crm_knowledge k
   where k.project_id = p_project
     and k.status = 'approved'
     and (k.expires_at is null or k.expires_at >= (now() at time zone 'Asia/Karachi')::date)
   order by (k.product = 'any') desc, k.product, k.question
$fn$;

grant execute on function app.crm_agent_knowledge(uuid) to cni_app;

/* ⚠️ THE LATEST INTEREST WINS. 231 only recorded a product on a lead that had
   none, so the Taskly lead who moved to the CRM stayed "Taskly": the next turn
   drifted back to Taskly, and the drawer kept showing Taskly files. The agent
   names a product only when the client says it (agent-brain.ts), so what the
   client said last is the better answer. */
create or replace function app.crm_agent_note_product(p_lead uuid, p_product text)
returns void
language sql
security definer
set search_path = public, app, pg_temp
as $fn$
  /* ⚠️ The cast sits behind the CASE: Postgres does not promise to test the
     whitelist before it evaluates a cast elsewhere in the WHERE. */
  with named as (
    select case when p_product in ('taskly', 'crm', 'erp', 'whatsapp')
                then p_product::public.crm_product end as product
  )
  update public.crm_leads l
     set product = n.product
    from named n
   where l.id = p_lead
     and n.product is not null
     and l.product is distinct from n.product
$fn$;

grant execute on function app.crm_agent_note_product(uuid, text) to cni_app;

-- ============================================================================
-- SELF-CHECK — every approved answer of a project, no draft, no rejected
-- ============================================================================
do $chk$
declare
  v_project uuid;
  v_all int; v_agent int; v_leak int;
begin
  select k.project_id into v_project
    from public.crm_knowledge k
   group by k.project_id
   order by count(*) desc
   limit 1;
  if v_project is null then
    raise exception '233 · no project has any knowledge to check against' using errcode = 'CR233';
  end if;

  select count(*) into v_all
    from public.crm_knowledge k
   where k.project_id = v_project and k.status = 'approved'
     and (k.expires_at is null or k.expires_at >= (now() at time zone 'Asia/Karachi')::date);
  select count(*) into v_agent from app.crm_agent_knowledge(v_project);
  select count(*) into v_leak
    from app.crm_agent_knowledge(v_project) a
    join public.crm_knowledge k on k.project_id = v_project and k.question = a.question and k.answer = a.answer
   where k.status <> 'approved';

  if v_agent <> v_all then
    raise exception '233 · the agent sees % answers, % are approved', v_agent, v_all using errcode = 'CR233';
  end if;
  if v_leak > 0 then
    raise exception '233 · % unapproved answers reached the agent', v_leak using errcode = 'CR233';
  end if;
  raise notice '233 · ✓ the agent sees all % approved answers of the busiest project, every product, nothing unapproved', v_agent;

  /* The latest interest wins — on a real lead, put back before the check ends. */
  declare
    v_lead uuid; v_before public.crm_product; v_after public.crm_product;
  begin
    select l.id, l.product into v_lead, v_before from public.crm_leads l where l.project_id = v_project limit 1;
    if v_lead is null then
      raise exception '233 · no lead to check the product rule on' using errcode = 'CR233';
    end if;
    perform app.crm_agent_note_product(v_lead, 'erp');
    perform app.crm_agent_note_product(v_lead, 'crm');
    perform app.crm_agent_note_product(v_lead, 'taskly-crm');
    select product into v_after from public.crm_leads where id = v_lead;
    update public.crm_leads set product = v_before where id = v_lead;
    if v_after is distinct from 'crm'::public.crm_product then
      raise exception '233 · the latest product did not win (got %)', v_after using errcode = 'CR233';
    end if;
    raise notice '233 · ✓ the product the client named last is the one kept, and one we do not sell is ignored';
  end;
end
$chk$;
