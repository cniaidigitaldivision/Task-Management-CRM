-- ============================================================================
-- 238 · AN APPOINTMENT HAS A NUMBER — APPT-101, APPT-102 …
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-21, sharing the Appointments design: every row and the details
-- panel lead with "APPT-201". A quotation has had QT-1042 since Phase D; an
-- appointment had nothing a person could say on the phone ("the visit on the
-- 19th for Faisal" is two facts, not a reference).
--
-- One sequence for the whole business, numbered in the order they were booked,
-- starting at 101 so the first reads as a reference and not a count.
-- ============================================================================

create sequence if not exists public.crm_appointment_ref_seq start with 101;

alter table public.crm_appointments
  add column if not exists ref_no bigint;

/* Existing rows, in the order they were booked. */
with ordered as (
  select id, row_number() over (order by created_at, id) as n
    from public.crm_appointments
   where ref_no is null
)
update public.crm_appointments a
   set ref_no = 100 + o.n
  from ordered o
 where o.id = a.id;

select setval('public.crm_appointment_ref_seq',
              greatest(100, coalesce((select max(ref_no) from public.crm_appointments), 100)));

alter table public.crm_appointments
  alter column ref_no set default nextval('public.crm_appointment_ref_seq');
alter table public.crm_appointments
  alter column ref_no set not null;

create unique index if not exists crm_appointments_ref_no_key on public.crm_appointments (ref_no);

grant usage on sequence public.crm_appointment_ref_seq to cni_app;

comment on column public.crm_appointments.ref_no is
  'Shown as APPT-<ref_no>. One sequence for the business, in booking order (238).';

-- ============================================================================
-- SELF-CHECK — every row numbered, no two alike, and a new one takes the next.
-- ============================================================================
do $chk$
declare
  n_missing int; n_dupes int; v_max bigint; v_next bigint; v_lead record;
begin
  select count(*) into n_missing from public.crm_appointments where ref_no is null;
  select count(*) - count(distinct ref_no) into n_dupes from public.crm_appointments;
  if n_missing > 0 or n_dupes > 0 then
    raise exception '238 · % unnumbered, % duplicated', n_missing, n_dupes using errcode = 'CR238';
  end if;

  select max(ref_no) into v_max from public.crm_appointments;
  select l.id, l.project_id, l.owner_id into v_lead
    from public.crm_leads l join public.projects p on p.id = l.project_id
   where p.name like '%[demo]' limit 1;

  begin
    insert into public.crm_appointments (lead_id, project_id, kind, scheduled_at, duration_minutes, owner_id, created_by_id, status)
    values (v_lead.id, v_lead.project_id, 'meeting', now() - interval '30 days', 45, v_lead.owner_id, v_lead.owner_id, 'cancelled')
    returning ref_no into v_next;
    raise exception 'roll back the check' using errcode = 'CRROL';
  exception when sqlstate 'CRROL' then
    null;
  end;

  if v_next is null or v_next <= coalesce(v_max, 100) then
    raise exception '238 · a new appointment got % after %', v_next, v_max using errcode = 'CR238';
  end if;
  raise notice '238 · ✓ % appointments numbered up to APPT-%; the next one is APPT-%', (select count(*) from public.crm_appointments), coalesce(v_max, 100), v_next;
end
$chk$;
