-- ============================================================================
-- 139 · WHICH NUMBER A PROJECT SENDS FROM
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-10: *"This WhatsApp business number will just work for the one
-- app… Chitral Royal Homes will have a different WhatsApp business number. In
-- the same way every business has a different business number, right? The lead
-- belongs to the number that belongs to the project."*
--
-- ── ⚠️ SO IT IS A COLUMN, NOT AN ENVIRONMENT VARIABLE ──────────────────────
-- A `WHATSAPP_PHONE_NUMBER_ID` in the environment would be ONE number for the
-- whole system — every business sending from the same handle. A property buyer
-- hearing back from a software brand is a reply that damages both, and the
-- mistake would be invisible until a client noticed.
--
-- Same shape as `meta_accounts`, which already maps a Facebook page to a
-- project, for the same reason and by the same logic.
--
-- ── ⚠️ THE WEBHOOK STAYS SHARED, AND THAT IS NOT AN INCONSISTENCY ──────────
-- One callback URL serves every number: each event names the number it arrived
-- on, so the route works out which business, project and team from the payload.
-- Sending is per business; receiving is one door. Meta stores them that way too.
-- ============================================================================

alter table public.projects
  /* Meta's id for the number, from the WhatsApp API setup panel. NOT the phone
     number itself — the number is for humans, this is what the API addresses. */
  add column if not exists whatsapp_phone_number_id text,
  /* The WhatsApp Business Account that holds it. Kept because templates are
     listed and submitted against the WABA rather than the number, and step 9
     will need it. */
  add column if not exists whatsapp_waba_id text;

comment on column public.projects.whatsapp_phone_number_id is
  'Meta Phone Number ID this project sends WhatsApp from. NULL means not set up, '
  'which is the ordinary state for most projects. Migration 139.';

-- ============================================================================
-- SELF-CHECK — additive only, so the point is that nothing else moved.
-- ============================================================================
do $$
declare
  n_before int;
  bad      int;
  v_demo   uuid;
begin
  select count(*) into n_before from public.projects;

  select count(*) into bad
    from information_schema.columns
   where table_schema='public' and table_name='projects'
     and column_name in ('whatsapp_phone_number_id','whatsapp_waba_id')
     and is_nullable = 'NO';
  if bad > 0 then
    raise exception '139 · a new column is NOT NULL — every existing project would be invalid';
  end if;

  select count(*) into bad from public.projects
   where whatsapp_phone_number_id is not null or whatsapp_waba_id is not null;
  if bad > 0 then
    raise exception '139 · % projects were given a number they did not have', bad;
  end if;

  /* ── Point the demo project at Meta's TEST number ────────────────────────
     ⚠️ THE TEST NUMBER, AND ONLY ON THE DEMO PROJECT. Chitral is a client's
     pipeline; wiring a live sending number to it before anybody has decided to
     message 627 people would make one mis-click very expensive. The demo
     project exists precisely so this can be proven on leads nobody can be
     harmed by. */
  select id into v_demo from public.projects where name like 'Demo%' limit 1;
  if v_demo is not null then
    update public.projects
       set whatsapp_phone_number_id = '1270997902767734',
           whatsapp_waba_id = '1747354729809810'
     where id = v_demo;
    raise notice '139 · the demo project sends from Meta''s test number';
  end if;

  if (select count(*) from public.projects) <> n_before then
    raise exception '139 · the project count moved';
  end if;

  raise notice '139 · a project can name its own WhatsApp number; % projects untouched', n_before;
end $$;
