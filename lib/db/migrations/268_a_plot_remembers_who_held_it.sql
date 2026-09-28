-- ============================================================================
-- 268 · A PLOT REMEMBERS WHO HELD IT, AND FOR HOW LONG
-- ----------------------------------------------------------------------------
-- The Properties record page has an **Availability history** tab, and until now
-- it said so honestly: the history needs a table with a start, an end and a
-- person, and there was not one. This is that table.
--
-- ── ⚠️ WHY THE AUDIT LOG WAS NOT ENOUGH ──────────────────────────────────
-- `audit_log` already records every status change with the actor and the reason,
-- and the Activity tab reads it. But an audit row is an EVENT — "on the 14th,
-- Sarah set this to reserved" — and the question a salesperson actually asks is
-- a SPAN: *"how long was A-114 held, and who by, before it came back?"*
--
-- Deriving spans from events means pairing each change with the next one at read
-- time, which is a window function over a table that also holds every task,
-- user and invoice edit in the company. It is the wrong shape and it gets slower
-- forever. A span per row is the right shape, and it makes "held twice for three
-- weeks each" a fact you can sort by.
--
-- ── ⚠️ A TRIGGER, NOT A CALL IN THE ACTION ───────────────────────────────
-- Every write path must produce history: the Edit dialog, the bulk Update
-- status control, the importer, `crm_booking_holds_property` (150's trigger,
-- which reserves a plot when a booking is verified) and any SQL somebody runs by
-- hand during a migration. Four of those five do not go through
-- `app/actions/crm-properties.ts` at all.
--
-- A history that depends on remembering to append is a history with holes in
-- exactly the places somebody will later care about. So the table is written by
-- a trigger on `crm_properties`, and nothing can change a status without it.
--
-- ── ⚠️ AND IT IS APPEND-ONLY ─────────────────────────────────────────────
-- No UPDATE or DELETE policy exists for anybody, including an Admin. The owner's
-- own Edit reference says it: *"Status history is never overwritten."* A record
-- somebody can tidy is not a record. Correcting a mistake means a new span, not
-- an edited one.
-- ============================================================================

create table if not exists public.crm_property_status_spans (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.crm_properties (id) on delete cascade,

  status        public.crm_property_status not null,
  /* Null for the first span a plot ever has. */
  previous      public.crm_property_status,

  started_at    timestamptz not null default now(),
  /* Null while this is the plot's current state. Exactly one open span per plot. */
  ended_at      timestamptz,

  /* Who caused it. Null when a trigger did — a booking verifying itself, say. */
  changed_by_id uuid references public.users (id) on delete set null,
  /* The reason typed in the Edit dialog, carried through by the action. */
  reason        text,

  created_at    timestamptz not null default now(),

  constraint crm_status_span_ends_after_it_starts
    check (ended_at is null or ended_at >= started_at)
);

comment on table public.crm_property_status_spans is
  'How long a plot spent in each availability state, and who put it there. Append-only, written by a trigger — migration 268.';

create index if not exists crm_status_spans_property_idx
  on public.crm_property_status_spans (property_id, started_at desc);

/* ⚠️ ONE OPEN SPAN PER PLOT, enforced by the database rather than by the
   trigger being careful. A second open span would make "how long has this been
   reserved" ambiguous, and nothing would notice. */
create unique index if not exists crm_status_spans_one_open
  on public.crm_property_status_spans (property_id) where ended_at is null;

grant select on public.crm_property_status_spans to cni_app;

alter table public.crm_property_status_spans enable row level security;

/* Whoever may see the plot may see its history. Written argument-free so the
   helper is an InitPlan rather than a call per row (law 5). */
drop policy if exists crm_status_spans_select on public.crm_property_status_spans;
create policy crm_status_spans_select on public.crm_property_status_spans
  for select using (
    exists (
      select 1 from public.crm_properties p
       where p.id = crm_property_status_spans.property_id
    )
  );

/* ⚠️ NO WRITE POLICY, DELIBERATELY. `cni_app` is granted SELECT only, so the
   application cannot insert, amend or remove a span whatever it asks. The rows
   arrive through the SECURITY DEFINER trigger below and by no other route. */

-- ── the trigger that cannot be forgotten ───────────────────────────────────
create or replace function app.crm_property_status_changed()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := app.current_user_id();
  v_reason text := nullif(current_setting('app.crm_status_reason', true), '');
begin
  if tg_op = 'INSERT' then
    insert into public.crm_property_status_spans
      (property_id, status, previous, changed_by_id, reason)
    values (new.id, new.status, null, v_actor, v_reason);
    return new;
  end if;

  if new.status is distinct from old.status then
    /* Close the span that was open, then open the new one. */
    update public.crm_property_status_spans
       set ended_at = now()
     where property_id = new.id and ended_at is null;

    insert into public.crm_property_status_spans
      (property_id, status, previous, changed_by_id, reason)
    values (new.id, new.status, old.status, v_actor, v_reason);
  end if;

  return new;
end
$function$;

drop trigger if exists crm_properties_status_history on public.crm_properties;
create trigger crm_properties_status_history
  after insert or update of status on public.crm_properties
  for each row execute function app.crm_property_status_changed();

-- ── the plots that already exist get their first span ──────────────────────
/* ⚠️ `started_at` is the row's own creation time, not now(). Backfilling with
   the clock would tell every reader that the whole scheme changed hands the
   moment this migration ran. */
insert into public.crm_property_status_spans (property_id, status, previous, started_at, reason)
select p.id, p.status, null, coalesce(p.created_at, now()),
       'Recorded when availability history began.'
  from public.crm_properties p
 where not exists (
   select 1 from public.crm_property_status_spans s where s.property_id = p.id
 );

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  v_admin   uuid;
  v_project uuid;
  v_plot    uuid;
  v_open    int;
  v_spans   int;
  v_first   text;
  v_prev    text;
begin
  select id into v_admin from public.users
   where is_active and role in ('admin','super_admin') order by created_at limit 1;
  perform set_config('app.user_id', v_admin::text, true);

  -- ── every existing plot has exactly one open span ────────────────────────
  select count(*) into v_open
    from public.crm_properties p
   where (select count(*) from public.crm_property_status_spans s
           where s.property_id = p.id and s.ended_at is null) <> 1;
  if v_open <> 0 then
    raise exception '% PLOTS DO NOT HAVE EXACTLY ONE OPEN SPAN', v_open;
  end if;

  select id into v_project from public.projects where name = 'Chitral Royal Homes [demo]';
  if v_project is null then
    raise notice '268 · no demo scheme here; the trigger is untested on this database';
    return;
  end if;

  -- ── a new plot opens its first span ──────────────────────────────────────
  insert into public.crm_properties
    (project_id, code, plot_number, block, size_marla, base_price, status, is_test_data)
  values (v_project, 'SELFCHECK-268', 'SC-268', 'Z', 5, 1000000, 'available', true)
  returning id into v_plot;

  select count(*), min(status::text) into v_spans, v_first
    from public.crm_property_status_spans where property_id = v_plot;
  if v_spans <> 1 or v_first <> 'available' then
    raise exception 'A NEW PLOT DID NOT OPEN ONE available SPAN (% spans, first %)', v_spans, v_first;
  end if;

  -- ── a change closes one and opens the next, with the reason ──────────────
  perform set_config('app.crm_status_reason', 'Held for a walk-in.', true);
  update public.crm_properties set status = 'on_hold' where id = v_plot;

  select count(*) into v_spans from public.crm_property_status_spans where property_id = v_plot;
  if v_spans <> 2 then
    raise exception 'A STATUS CHANGE DID NOT WRITE A SECOND SPAN (% spans)', v_spans;
  end if;
  if (select count(*) from public.crm_property_status_spans
       where property_id = v_plot and ended_at is null) <> 1 then
    raise exception 'A PLOT ENDED UP WITH TWO OPEN SPANS';
  end if;
  select previous::text into v_prev from public.crm_property_status_spans
   where property_id = v_plot and ended_at is null;
  if v_prev <> 'available' then
    raise exception 'THE NEW SPAN DID NOT REMEMBER WHAT CAME BEFORE IT (got %)', v_prev;
  end if;
  if (select reason from public.crm_property_status_spans
       where property_id = v_plot and ended_at is null) <> 'Held for a walk-in.' then
    raise exception 'THE REASON DID NOT REACH THE SPAN';
  end if;

  -- ── a write that is NOT a status change writes nothing ───────────────────
  update public.crm_properties set base_price = 1100000 where id = v_plot;
  select count(*) into v_spans from public.crm_property_status_spans where property_id = v_plot;
  if v_spans <> 2 then
    raise exception 'A PRICE EDIT INVENTED A STATUS SPAN (% spans)', v_spans;
  end if;

  -- ⚠️ and the application cannot rewrite history
  begin
    perform set_config('role', 'cni_app', true);
    update public.crm_property_status_spans set reason = 'tidied' where property_id = v_plot;
    perform set_config('role', 'postgres', true);
    raise exception 'THE APPLICATION REWROTE STATUS HISTORY';
  exception
    when insufficient_privilege then
      perform set_config('role', 'postgres', true);
  end;

  perform set_config('app.crm_status_reason', '', true);
  delete from public.crm_properties where id = v_plot;
  if exists (select 1 from public.crm_property_status_spans where property_id = v_plot) then
    raise exception 'SPANS OUTLIVED THE PLOT THEY BELONG TO';
  end if;

  raise notice '268 self-check passed: one open span per plot, a change closes and opens with its reason, a price edit writes nothing, and the application cannot rewrite it';
end $$;
