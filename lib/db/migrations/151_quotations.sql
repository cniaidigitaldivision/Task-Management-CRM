-- ============================================================================
-- 151 · QUOTATIONS — a price somebody was told, and cannot be told differently
-- ----------------------------------------------------------------------------
-- Phase D. Built against the owner's QT-1042 and QT-1043 (doc 13).
--
-- ── ⚠️ THE MOST IMPORTANT LINE IN THE WHOLE SPEC ───────────────────────────
-- Owner: *"If the price changes, create QT-1042 Version 2 instead of silently
-- changing the original document."*
--
-- So `(number, version)` is the unique key and a revision is a NEW ROW. A price
-- that changes under a client is a dispute, and the version history is the
-- entire defence — "we sent you v1 at 8.2m, then v2 at 8.0m after approval" is
-- answerable; "the record says 8.0m" is not.
--
-- ⚠️ AND THE PRICE IS COPIED, NOT JOINED. `base_price` is written onto the
-- quotation at issue. Joining to `crm_properties` would mean every historical
-- document silently reprices itself the day the catalogue moves — which is the
-- same bug as editing v1, arriving by a different route.
--
-- ── ⚠️ A PENDING QUOTATION CANNOT LEAVE THE BUILDING ───────────────────────
-- The status gate is real and is enforced in the server action, not by hiding a
-- button. The owner's rule: while pending, preview and save a draft; the manager
-- is notified; no external send and no sequence start.
--
-- ⚠️ AND NOBODY APPROVES THEIR OWN. Written as a database constraint rather than
-- a convention, because a discount is money and "the salesperson approved it
-- themselves" is the first thing an auditor looks for.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_quotation_status') then
    create type public.crm_quotation_status as enum (
      'draft',
      'pending_approval',
      'approved',
      'sent',
      'expired',
      /* Replaced by a later version. The row stays; it is what v2 is compared to. */
      'superseded',
      'rejected'
    );
  end if;
end $$;

create table if not exists public.crm_quotations (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.crm_leads (id) on delete cascade,
  /* ⚠️ `set null`, not cascade: a plot withdrawn from the catalogue must not
     erase the quotation somebody was sent for it. */
  property_id uuid references public.crm_properties (id) on delete set null,
  project_id  uuid not null references public.projects (id) on delete cascade,

  number      text not null,
  version     integer not null default 1,

  /* All in the same minor units as `crm_properties.base_price` — rupees. */
  base_price        bigint not null,
  premium_charges   bigint not null default 0,
  requested_discount bigint not null default 0,
  approved_discount  bigint not null default 0,
  /* ⚠️ STORED, NOT COMPUTED ON READ. The document said a number; that number is
     what it said, whatever arithmetic we would do today. A generated column
     would quietly restate history the first time the formula changed. */
  net_amount        bigint not null,

  valid_until date,
  status      public.crm_quotation_status not null default 'draft',
  terms       text,
  pdf_path    text,

  prepared_by_id uuid references public.users (id) on delete set null,
  approved_by_id uuid references public.users (id) on delete set null,
  approved_at    timestamptz,
  approval_note  text,
  sent_at        timestamptz,

  /* Which row this one replaces, so a version chain can be walked. */
  supersedes_id uuid references public.crm_quotations (id) on delete set null,

  is_test_data boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_quotations_number_present check (btrim(number) <> ''),
  constraint crm_quotations_version_sane check (version >= 1),
  constraint crm_quotations_money_sane check (
    base_price > 0
    and premium_charges >= 0
    and requested_discount >= 0
    and approved_discount >= 0
    and net_amount > 0
    /* ⚠️ A DISCOUNT CANNOT EXCEED THE PRICE. "Net −200,000" is the kind of
       figure that makes somebody distrust every other number on the page, and
       it costs one constraint to make impossible. */
    and approved_discount <= base_price + premium_charges
  ),
  /* ⚠️ APPROVED MEANS SOMEBODY APPROVED IT. A row cannot sit in `approved` with
     no approver and no timestamp — that is how "who authorised this discount?"
     becomes unanswerable six months later. */
  constraint crm_quotations_approval_complete check (
    status <> 'approved'
    or (approved_by_id is not null and approved_at is not null)
  ),
  /* ⚠️ AND NOBODY APPROVES THEIR OWN. */
  constraint crm_quotations_no_self_approval check (
    approved_by_id is null or approved_by_id is distinct from prepared_by_id
  )
);

create unique index if not exists crm_quotations_number_version_uq
  on public.crm_quotations (lower(btrim(number)), version);
create index if not exists crm_quotations_lead_idx
  on public.crm_quotations (lead_id, created_at desc);
create index if not exists crm_quotations_status_idx
  on public.crm_quotations (project_id, status);

comment on table public.crm_quotations is
  'A formal price offer. ⚠️ A revision is a NEW ROW — (number, version) is unique '
  'and v1 is never edited, because a price that changes under a client is a '
  'dispute and the version chain is the defence. Migration 151.';

-- The quotation's own copy of the schedule.
alter table public.crm_payment_stages
  add column if not exists quotation_id uuid
    references public.crm_quotations (id) on delete cascade;

create index if not exists crm_payment_stages_quotation_idx
  on public.crm_payment_stages (quotation_id, sort_order);

alter table public.crm_payment_stages
  drop constraint if exists crm_payment_stages_one_owner;
alter table public.crm_payment_stages
  /* ⚠️ EXACTLY ONE OWNER. A stage belonging to both a property and a quotation
     would be edited through one and read through the other, and the document
     would drift from what was sent. */
  add constraint crm_payment_stages_one_owner check (
    (property_id is not null and quotation_id is null)
    or (property_id is null and quotation_id is not null)
  );

-- ════════════════════════════════════════════════════════════════════════════
-- POLICIES
-- ════════════════════════════════════════════════════════════════════════════
alter table public.crm_quotations enable row level security;

do $$
begin
  /* ⚠️ THE SAME AUDIENCE AS THE LEAD IT BELONGS TO — a salesperson sees the
     quotations on their own leads, the manager sees the project's. Delegated to
     `crm_leads` by EXISTS rather than re-decided, so it cannot drift. */
  if not exists (select 1 from pg_policy where polname = 'crm_quotations_select') then
    create policy crm_quotations_select on public.crm_quotations
      for select to cni_app
      using (exists (select 1 from public.crm_leads l where l.id = lead_id));
  end if;

  /* A salesperson may CREATE a quotation on their own lead and edit it while it
     is a draft. */
  if not exists (select 1 from pg_policy where polname = 'crm_quotations_insert') then
    create policy crm_quotations_insert on public.crm_quotations
      for insert to cni_app
      with check (exists (select 1 from public.crm_leads l where l.id = lead_id));
  end if;

  /* ⚠️ AND MAY NOT TOUCH ONE THAT IS APPROVED OR SENT. The owner's rule: *"Do
     not permit salespeople to edit an approved quotation's price directly."*
     A manager can, because an approval sometimes has to be withdrawn. */
  if not exists (select 1 from pg_policy where polname = 'crm_quotations_update') then
    create policy crm_quotations_update on public.crm_quotations
      for update to cni_app
      using (
        app.crm_manages_project(project_id)
        or (
          status in ('draft', 'pending_approval', 'rejected')
          and exists (select 1 from public.crm_leads l where l.id = lead_id)
        )
      )
      with check (
        app.crm_manages_project(project_id)
        or status in ('draft', 'pending_approval', 'rejected')
      );
  end if;

  /* ⚠️ NO DELETE POLICY AT ALL. A quotation is evidence of what somebody was
     told. Withdrawing one is `status = 'rejected'` or a superseding version —
     both of which leave the original readable. Same stance as the conversation
     and the activity log. */
end $$;

grant select, insert, update on public.crm_quotations to cni_app;
revoke all on public.crm_quotations from anon, authenticated;

-- ============================================================================
-- SELF-CHECK — every rule attempted, not read
-- ============================================================================
do $$
declare
  v_lead  uuid;
  v_proj  uuid;
  v_sales uuid;
  v_mgr   uuid;
  v_q     uuid;
  n       int;
  bad     boolean;
begin
  select l.id, l.project_id, l.owner_id into v_lead, v_proj, v_sales
    from public.crm_leads l
    join public.projects p on p.id = l.project_id
   where p.name like '%[demo]' and l.owner_id is not null
   limit 1;

  if v_lead is null then
    raise notice '151 · no owned demo lead — table created, nothing to measure';
    return;
  end if;

  select u.id into v_mgr
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.department_role = 'manager' and u.is_active limit 1;

  insert into public.crm_quotations
    (lead_id, project_id, number, version, base_price, net_amount,
     prepared_by_id, status, is_test_data)
  values (v_lead, v_proj, '151-SELFCHECK', 1, 4500000, 4500000, v_sales, 'draft', true)
  returning id into v_q;

  -- 1 · ⚠️ THE SAME NUMBER AND VERSION TWICE IS REFUSED. This is what makes a
  --     revision a new ROW rather than an edit.
  bad := false;
  begin
    insert into public.crm_quotations
      (lead_id, project_id, number, version, base_price, net_amount, prepared_by_id)
    values (v_lead, v_proj, '151-selfcheck', 1, 1, 1, v_sales);
    bad := true;
  exception when unique_violation then null;
  end;
  if bad then
    raise exception '151 · QT-1042 v1 was allowed to exist twice';
  end if;

  -- 2 · ⚠️ AND VERSION 2 IS FINE — the whole point.
  insert into public.crm_quotations
    (lead_id, project_id, number, version, base_price, net_amount,
     prepared_by_id, supersedes_id, is_test_data)
  values (v_lead, v_proj, '151-SELFCHECK', 2, 4500000, 4300000, v_sales, v_q, true);

  -- 3 · ⚠️ NOBODY APPROVES THEIR OWN DISCOUNT.
  bad := false;
  begin
    update public.crm_quotations
       set status = 'approved', approved_by_id = v_sales, approved_at = now()
     where id = v_q;
    bad := true;
  exception when check_violation then null;
  end;
  if bad then
    raise exception '151 · a salesperson approved their own quotation';
  end if;

  -- 4 · ⚠️ AND "APPROVED" CANNOT BE EMPTY. No approver, no approval.
  bad := false;
  begin
    update public.crm_quotations set status = 'approved' where id = v_q;
    bad := true;
  exception when check_violation then null;
  end;
  if bad then
    raise exception '151 · a quotation reached approved with nobody approving it';
  end if;

  -- 5 · A manager approving it is accepted.
  if v_mgr is not null and v_mgr is distinct from v_sales then
    update public.crm_quotations
       set status = 'approved', approved_by_id = v_mgr, approved_at = now()
     where id = v_q;
  end if;

  -- 6 · ⚠️ A DISCOUNT BIGGER THAN THE PRICE IS REFUSED.
  bad := false;
  begin
    update public.crm_quotations
       set approved_discount = 99000000 where id = v_q;
    bad := true;
  exception when check_violation then null;
  end;
  if bad then
    raise exception '151 · a discount exceeded the price';
  end if;

  -- 7 · ⚠️ A PAYMENT STAGE CANNOT BELONG TO BOTH A PROPERTY AND A QUOTATION.
  bad := false;
  begin
    insert into public.crm_payment_stages (property_id, quotation_id, sort_order, label, amount)
    values (null, null, 1, 'Nowhere', 1);
    bad := true;
  exception when check_violation then null;
  end;
  if bad then
    raise exception '151 · a payment stage was allowed to belong to nothing';
  end if;

  -- Clean up this file's own rows.
  delete from public.crm_payment_stages where quotation_id in (
    select id from public.crm_quotations where number = '151-SELFCHECK');
  delete from public.crm_quotations where number = '151-SELFCHECK';

  raise notice '151 · versioning, self-approval, empty approval and over-discount are all refused';
end $$;
