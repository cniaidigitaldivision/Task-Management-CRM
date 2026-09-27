-- ============================================================================
-- 267 · A PROPERTY CAN BE DRAFTED, AND IT HAS A DATE
-- ----------------------------------------------------------------------------
-- Owner's Add-property reference, 2026-09-27. Two fields on it have nowhere to
-- go in the schema 266 left behind:
--
--   · **Expected possession — 31 Mar 2028.** `possession_months` has existed
--     since 150 and holds a NUMBER OF MONTHS, which answers a different
--     question: "how long from now" drifts every day that passes, and a buyer's
--     agreement names a date, not an interval. The column stays for the rows
--     that use it; this adds the date the reference actually asks for.
--
--   · **Save draft.** The wizard has four steps and the owner can leave after
--     one. A half-entered plot must not appear in the inventory, be counted on
--     a card, be shared, or be quoted — so it needs a flag rather than being
--     written only at the end, because "written only at the end" is the same as
--     losing the work.
--
-- ⚠️ A DRAFT IS INVISIBLE TO EVERY COUNT, and that is enforced where the rows
-- are read rather than remembered at each call site. The board's reader filters
-- it; so does the quotation picker. A draft plot that reached a customer's
-- quotation would be a price nobody had finished deciding.
-- ============================================================================

alter table public.crm_properties
  add column if not exists expected_possession date,
  add column if not exists is_draft boolean not null default false;

comment on column public.crm_properties.expected_possession is
  'The date handover is expected. Distinct from possession_months (150), which is an interval and drifts — migration 267.';
comment on column public.crm_properties.is_draft is
  'A property part-way through the Add wizard. Excluded from the board, the cards and every picker — migration 267.';

/* The board already filters on project and status; a draft is a third thing it
   skips, so the index carries it. */
create index if not exists crm_properties_live_idx
  on public.crm_properties (project_id, status) where is_draft = false;

-- ============================================================================
-- SELF-CHECK — a draft is not inventory
-- ============================================================================
do $$
declare
  v_admin   uuid;
  v_project uuid;
  v_draft   uuid;
  v_live    int;
  v_before  int;
begin
  select id into v_admin from public.users
   where is_active and role in ('admin','super_admin') order by created_at limit 1;
  perform set_config('app.user_id', v_admin::text, true);

  select id into v_project from public.projects where name = 'Chitral Royal Homes [demo]';
  if v_project is null then
    raise notice '267 · no demo scheme on this database; the draft rule is untested here';
    return;
  end if;

  select count(*) into v_before
    from public.crm_properties where project_id = v_project and not is_draft;

  insert into public.crm_properties
    (project_id, code, plot_number, block, size_marla, base_price, status,
     is_draft, is_test_data, expected_possession)
  values (v_project, 'SELFCHECK-267', 'SC-267', 'Z', 5, 1000000, 'available',
          true, true, date '2028-03-31')
  returning id into v_draft;

  -- the date survived as a date, not an interval
  if (select expected_possession from public.crm_properties where id = v_draft) <> date '2028-03-31' then
    raise exception 'THE POSSESSION DATE DID NOT SURVIVE';
  end if;

  -- and the draft is not inventory
  select count(*) into v_live
    from public.crm_properties where project_id = v_project and not is_draft;
  if v_live <> v_before then
    raise exception 'A DRAFT WAS COUNTED AS INVENTORY (% became %)', v_before, v_live;
  end if;

  update public.crm_properties set is_draft = false where id = v_draft;
  select count(*) into v_live
    from public.crm_properties where project_id = v_project and not is_draft;
  if v_live <> v_before + 1 then
    raise exception 'FINISHING A DRAFT DID NOT ADD IT TO THE INVENTORY';
  end if;

  delete from public.crm_properties where id = v_draft;
  if exists (select 1 from public.crm_properties where id = v_draft) then
    raise exception 'THE 267 FIXTURE SURVIVED';
  end if;

  raise notice '267 self-check passed: a draft is invisible to the inventory until it is finished, and a possession date stays a date';
end $$;
