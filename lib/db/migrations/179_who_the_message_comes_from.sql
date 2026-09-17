-- ============================================================================
-- 179 · WHICH NUMBER IS THIS GOING FROM?
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-17, on the conversation composer: *"Definitely it's an AI
-- digital project. Its WhatsApp business number will be auto-selected, and if it
-- is anything other than that, then its WhatsApp automation number will be
-- selected."*
--
-- ⚠️ THE NUMBER IS ALREADY PER PROJECT AND THE COMPOSER COULD NOT NAME IT.
-- `projects.whatsapp_phone_number_id` is META'S INTERNAL ID — a 15-digit opaque
-- string, not a phone number. There is nothing in this database that can print
-- "CNI AI & Digital · +92 300 123 8726" above a reply box, which is exactly what
-- the reference does and exactly what stops somebody sending a client's message
-- from the wrong business.
--
-- ── ⚠️ ON `crm_project_settings`, NOT ON `projects` ────────────────────────
-- The two Meta id columns predate 171 and stay where they are. New CRM-owned
-- data goes in the CRM's own table — `16-EXTRACTING-THE-CRM.md` rule 1, and the
-- same call 177 made for the price ladders. A display name and number are what
-- the CRM prints, not what Taskly needs to function.
-- ============================================================================

alter table public.crm_project_settings
  /* What the client sees it as. ⚠️ NOT the project name: the project is
     "Chitral Royal Homes" and the number may be registered to the agency, and a
     client reading a name that does not match the number gets suspicious. */
  add column whatsapp_display_name text,
  /* E.164, for the composer and the footer. */
  add column whatsapp_display_number text
    check (whatsapp_display_number is null or whatsapp_display_number ~ '^\+[1-9][0-9]{7,14}$');

comment on column public.crm_project_settings.whatsapp_display_number is
  'The number a client sees replies from, E.164. ⚠️ Display only — Meta routes on projects.whatsapp_phone_number_id, which is an opaque id and cannot be shown to anybody.';

-- ════════════════════════════════════════════════════════════════════════════
-- WHO A REPLY WOULD COME FROM
-- ----------------------------------------------------------------------------
-- ⚠️ ONE READER, because the composer, the footer strip and eventually the
-- sender all need the same answer — and a composer that named one number while
-- the send used another is the worst possible version of this bug.
--
-- ⚠️ AND IT ANSWERS "CAN I SEND" SEPARATELY FROM "WHO FROM". 172 exists because
-- those two were bundled: `crm_project_can_whatsapp` also checks the caller's
-- access, so asking it from a definer answered false for everybody. `configured`
-- here is a fact about the PROJECT.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.crm_project_sender(p_project uuid)
returns table (configured boolean, display_name text, display_number text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select
    p.whatsapp_phone_number_id is not null,
    coalesce(nullif(trim(s.whatsapp_display_name), ''), p.name),
    nullif(trim(s.whatsapp_display_number), '')
    from public.projects p
    left join public.crm_project_settings s on s.project_id = p.id
   where p.id = p_project
$$;

comment on function app.crm_project_sender(uuid) is
  'Whether this project can send on WhatsApp, and what a client sees it as. Configuration only — never the caller''s access, which is what 172 had to untangle.';

grant execute on function app.crm_project_sender(uuid) to cni_app;
grant update (whatsapp_display_name, whatsapp_display_number)
  on public.crm_project_settings to cni_app;


-- ⚠️ AND READINESS LEARNS ABOUT IT. A project that can route a message but
-- cannot say who it is from will print an empty sender above the reply box — so
-- it is a gap the owner should be told about, like the letterhead.
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
  select 'no_whatsapp', 'warning',
         'No WhatsApp number is configured for this project.',
         'WhatsApp conversations and sequences'
   where not exists (
     select 1 from public.projects p
      where p.id = p_project and p.whatsapp_phone_number_id is not null
   )

  union all
  /* ⚠️ ONLY WHERE SENDING ACTUALLY WORKS. Telling somebody to add a display
     number for a project that cannot send is noise on top of the real problem. */
  select 'no_sender_number', 'warning',
         'Messages can be sent, but there is no number to show the client they came from.',
         'what the reply box says above it'
   where exists (
     select 1 from public.projects p
      where p.id = p_project and p.whatsapp_phone_number_id is not null
   )
     and not exists (
       select 1 from s where coalesce(trim(whatsapp_display_number), '') <> ''
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
-- ============================================================================
do $chk$
declare
  v_sendable uuid; v_silent uuid; v_sales uuid;
  v_cfg boolean; v_name text; v_num text; refused boolean;
begin
  select id into v_sendable from public.projects
   where whatsapp_phone_number_id is not null and lead_department_id is not null limit 1;
  if v_sendable is null then
    raise exception '179 · no project can send on WhatsApp — the sender cannot be proved';
  end if;

  select id into v_silent from public.projects
   where whatsapp_phone_number_id is null and lead_department_id is not null limit 1;

  -- 1 · ⚠️ THE NAME FALLS BACK TO THE PROJECT so the composer is never blank,
  --     and `configured` is true even before a display number exists — they are
  --     two different facts and the reference shows both.
  select configured, display_name, display_number
    into v_cfg, v_name, v_num from app.crm_project_sender(v_sendable);
  if not v_cfg then
    raise exception '179 · a project with a phone number id reported as not configured';
  end if;
  if coalesce(v_name, '') = '' then
    raise exception '179 · the sender had no name to show a client';
  end if;

  -- 2 · ⚠️ AND READINESS ASKS FOR THE MISSING NUMBER, but only here — a project
  --     that cannot send at all has a bigger problem and is told about that one.
  if v_num is null then
    if not exists (
      select 1 from app.crm_project_readiness(v_sendable) where code = 'no_sender_number'
    ) then
      raise exception '179 · a sendable project with no display number was not flagged';
    end if;
  end if;

  if v_silent is not null and exists (
    select 1 from app.crm_project_readiness(v_silent) where code = 'no_sender_number'
  ) then
    raise exception '179 · a project that cannot send was nagged about a display number';
  end if;

  -- 3 · ⚠️ A DISPLAY NUMBER MUST BE A NUMBER. "ask Sarah" printed above a reply
  --     box is worse than nothing.
  refused := false;
  begin
    update public.crm_project_settings
       set whatsapp_display_number = '0300 123 8726' where project_id = v_sendable;
  exception when check_violation then refused := true;
  end;
  if not refused then
    update public.crm_project_settings set whatsapp_display_number = null where project_id = v_sendable;
    raise exception '179 · a non-E.164 display number was accepted';
  end if;

  -- 4 · The real thing works, and readiness stops asking.
  update public.crm_project_settings
     set whatsapp_display_number = '+923001238726',
         whatsapp_display_name = 'CNI AI & Digital'
   where project_id = v_sendable;

  select display_name, display_number into v_name, v_num
    from app.crm_project_sender(v_sendable);
  if v_num <> '+923001238726' or v_name <> 'CNI AI & Digital' then
    raise exception '179 · the sender came back as % / %', v_name, v_num;
  end if;
  if exists (select 1 from app.crm_project_readiness(v_sendable) where code = 'no_sender_number') then
    raise exception '179 · readiness still asks for a number that has been set';
  end if;

  -- 5 · ⚠️ A SALESPERSON MAY READ IT. They are the one sending; a sender they
  --     cannot see is a message they cannot vouch for.
  select e.user_id into v_sales
    from app.crm_eligible_owners(v_sendable) e where e.eligible limit 1;
  if v_sales is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_sales::text, true);
    perform 1 from app.crm_project_sender(v_sendable);
    reset role;
  end if;

  /* ⚠️ Put it back. This is a REAL project's row, not a fixture — 082 ate a live
     record with exactly this kind of tidy-up. */
  update public.crm_project_settings
     set whatsapp_display_number = null, whatsapp_display_name = null
   where project_id = v_sendable;

  raise notice '179 · the composer can name who a reply comes from, the name falls back to the project, a non-E.164 number is refused, and readiness asks only where sending actually works';
end $chk$;
