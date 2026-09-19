-- ============================================================================
-- 214 · AN ARCHIVED LEAD LEAVES THE DESK, THE COUNTS AND THE REPORTS
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-19: *"The 665 leads you are talking about, please archive them.
-- I just manage from the desk. Don't count them and don't add any report on the
-- basis of it… when all things are wired up, we will start… each report and
-- everything on the basis of that data, not the previous leads."*
--
-- ── ⚠️ ARCHIVED, NOT DELETED, AND THE DIFFERENCE IS THE POINT ──────────────
-- Some of these 665 were contacted by hand outside the system. Deleting them
-- would destroy the only record that a person ever spoke to them — and if one
-- of them calls back next month, the salesperson who answers has nothing. The
-- rows stay, whole; they simply stop being counted as work in hand.
--
-- ── ⚠️ ONE COLUMN, READ IN ONE PLACE ───────────────────────────────────────
-- `archived_at`. Everything the desk and the reports read goes through the RLS
-- predicate on `crm_leads`, so hiding them there would hide them from the
-- archive screen too. Instead the READERS exclude them and the flag is the
-- single fact — a lead is archived or it is not, and the reports are the ones
-- that have to ask.
--
-- ⚠️ AND IT IS NOT A STAGE. `lost` is a decision with a reason and feeds the
-- campaign-vs-salesperson report; `nurture` is a lead being parked on purpose.
-- Archived means "this predates the system and is not our workload" — a
-- different sentence entirely, and folding it into a stage would poison the very
-- report the owner is protecting.
-- ============================================================================

alter table public.crm_leads
  add column if not exists archived_at timestamptz,
  add column if not exists archived_reason text;

comment on column public.crm_leads.archived_at is
  '⚠️ OUT OF THE WORKLOAD, STILL ON THE RECORD. Excluded from the desk, the counts and every report; never deleted, because some of these were worked by hand and that is the only trace. Not a stage — see 214. ';

create index if not exists crm_leads_live_idx
  on public.crm_leads (project_id, stage)
  where archived_at is null;

-- ⚠️ A REASON, ALWAYS. An archived lead with no explanation is one somebody
-- un-archives in six months because nobody can say why it went.
alter table public.crm_leads
  drop constraint if exists crm_leads_archived_has_a_reason;
alter table public.crm_leads
  add constraint crm_leads_archived_has_a_reason
  check (archived_at is null or nullif(btrim(coalesce(archived_reason, '')), '') is not null);


-- ── Archiving, and putting one back ─────────────────────────────────────────
create or replace function app.crm_archive_leads(p_leads uuid[], p_reason text)
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_why text := nullif(btrim(coalesce(p_reason, '')), '');
  v_n   integer := 0;
  v_id  uuid;
begin
  if v_why is null then
    raise exception 'archiving needs a reason';
  end if;

  foreach v_id in array coalesce(p_leads, '{}'::uuid[])
  loop
    /* ⚠️ VISIBILITY IS CHECKED PER LEAD, not assumed from the caller's rank. A
       definer that skipped this would let anybody holding cni_app archive
       another salesperson's leads — the membership bug this codebase has
       shipped eight times. */
    if app.crm_lead_is_visible(v_id) then
      update public.crm_leads
         set archived_at = now(), archived_reason = v_why
       where id = v_id and archived_at is null;
      if found then
        v_n := v_n + 1;
      end if;
    end if;
  end loop;

  return v_n;
end;
$fn$;

grant execute on function app.crm_archive_leads(uuid[], text) to cni_app;

create or replace function app.crm_unarchive_lead(p_lead uuid)
returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_n integer;
begin
  if not app.crm_lead_is_visible(p_lead) then
    return false;
  end if;
  update public.crm_leads
     set archived_at = null, archived_reason = null
   where id = p_lead and archived_at is not null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$fn$;

grant execute on function app.crm_unarchive_lead(uuid) to cni_app;


-- ============================================================================
-- SELF-CHECK — it archives, it refuses a silent one, and it comes back
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid; v_lead uuid;
  n_done int; n_again int; refused boolean := false;
  v_reason text; back boolean; still_there boolean;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '214 · fixtures missing';
  end if;

  begin
    insert into public.crm_leads (project_id, source, full_name, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-214', 'new', now() - interval '90 days', v_owner, true)
    returning id into v_lead;

    /* ⚠️ AS THE SALESPERSON, NOT AS THE MIGRATION. `crm_archive_leads` asks
       `crm_lead_is_visible`, which reads `app.user_id` from the SESSION — and a
       migration has none, so every call returned 0 and the first run of this
       check failed on its own fixture. The same trap a definer with an audience
       check always sets: it answers "no" rather than erroring. */
    perform set_config('app.user_id', v_owner::text, true);

    /* 1 · No reason, no archive. */
    begin
      perform app.crm_archive_leads(array[v_lead], '  ');
    exception when others then refused := true;
    end;

    /* 2 · It archives once. */
    select app.crm_archive_leads(array[v_lead], 'Predates the CRM') into n_done;
    select archived_reason into v_reason from public.crm_leads where id = v_lead;

    /* 3 · Archiving it again changes nothing. */
    select app.crm_archive_leads(array[v_lead], 'Predates the CRM') into n_again;

    /* 4 · The row is still there, whole. */
    select exists (select 1 from public.crm_leads where id = v_lead) into still_there;

    /* 5 · And it comes back. */
    select app.crm_unarchive_lead(v_lead) into back;

    raise exception using errcode = 'P0214', message = '214 rollback';
  exception when sqlstate 'P0214' then
    null;
  end;

  if not refused then
    raise exception '214 · a lead was archived with no reason';
  end if;
  if n_done <> 1 then
    raise exception '214 · archiving did not take (% rows)', n_done;
  end if;
  if v_reason is distinct from 'Predates the CRM' then
    raise exception '214 · the reason was not recorded (got %)', v_reason;
  end if;
  if n_again <> 0 then
    raise exception '214 · archiving an archived lead counted again';
  end if;
  if not still_there then
    raise exception '214 · the lead was DELETED, not archived — that is the whole distinction';
  end if;
  if not back then
    raise exception '214 · an archived lead could not be brought back';
  end if;

  raise notice '214 · archived leaves the desk, keeps the record, and comes back';
end $chk$;
