-- ============================================================================
-- 189 · WHAT THE SENDER FILLS IN, AND WHAT IT ATTACHES
-- ----------------------------------------------------------------------------
-- A plan's message is stored in placeholders — "AoA {{lead_first_name}}, this is
-- {{my_first_name}} from {{company}}" — so it stays right when a lead changes
-- hands. Something has to fill them at the moment of sending, and the scheduled
-- sender has no session: every helper that answers these questions today
-- (`app.crm_lead_owners`, `app.crm_project_wa_number`) is scoped to the CALLER
-- and returns nothing for a machine.
--
-- ⚠️ BOTH FUNCTIONS ARE KEYED ON A FOLLOW-UP, not on a lead or a user. They
-- answer only for a row that is `due` and `auto_send` — the narrowest thing that
-- can be asked, so the grant to `cni_app` cannot become a way to read a name or
-- a document by guessing an id.
-- ============================================================================

create or replace function app.crm_followup_tokens(p_follow_up uuid)
returns table (
  lead_first text,
  lead_name text,
  owner_first text,
  owner_name text,
  company text,
  project text,
  quotation text,
  visit_when text
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select
    coalesce(nullif(split_part(btrim(l.full_name), ' ', 1), ''), 'Sir/Madam'),
    coalesce(nullif(btrim(l.full_name), ''), 'Sir/Madam'),
    coalesce(nullif(split_part(btrim(u.full_name), ' ', 1), ''), ''),
    coalesce(u.full_name, ''),
    coalesce(nullif(btrim(s.whatsapp_display_name), ''), p.name),
    p.name,
    coalesce((
      select q.number from public.crm_quotations q
       where q.lead_id = l.id
         and q.status not in ('superseded', 'rejected', 'expired')
       order by q.version desc, q.created_at desc
       limit 1), 'the quotation'),
    coalesce((
      select to_char(a.scheduled_at at time zone 'Asia/Karachi', 'FMDay FMDD FMMon, FMHH12:MI AM')
        from public.crm_appointments a
       where a.lead_id = l.id
         and a.status in ('scheduled', 'confirmed')
         and a.scheduled_at >= now()
       order by a.scheduled_at
       limit 1), 'the agreed time')
    from public.crm_follow_ups f
    join public.crm_leads l on l.id = f.lead_id
    join public.projects p on p.id = l.project_id
    left join public.crm_project_settings s on s.project_id = p.id
    left join public.users u on u.id = f.assigned_to_id
   where f.id = p_follow_up
     and f.status = 'due'
     and f.mode = 'auto_send'
$fn$;

comment on function app.crm_followup_tokens(uuid) is
  'The words a queued auto-send message is filled with. Keyed on the follow-up and only while it is due, so it cannot be used to read a name or a quotation by guessing an id. 189.';

/* What an email step carries. Rows of `crm_documents`, and only ones that
   belong to this lead or its project. */
create or replace function app.crm_followup_attachments(p_follow_up uuid)
returns table (storage_path text, mime text, title text, size_bytes bigint)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
  select d.storage_path, d.mime, d.title, d.size_bytes
    from public.crm_follow_ups f
    join public.crm_leads l on l.id = f.lead_id
    join public.crm_lead_sequences ls on ls.id = f.lead_sequence_id
    join public.crm_sequence_steps st
      on st.sequence_id = ls.sequence_id and st.step_no = f.sequence_step_no
    join public.crm_documents d
      on d.id = any (st.document_ids)
     /* ⚠️ THE DOCUMENT MUST BELONG TO THIS LEAD OR ITS PROJECT. A step could
        otherwise name any document id and the machine would post it to a
        client. */
     and d.project_id = l.project_id
     and (d.lead_id is null or d.lead_id = l.id)
   where f.id = p_follow_up
     and f.status = 'due'
     and f.mode = 'auto_send'
     /* 20 MB is Resend's ceiling for the whole message; this keeps one file
        well under it and the sender counts the total. */
     and d.size_bytes <= 15 * 1024 * 1024
   order by d.created_at
   limit 5
$fn$;

revoke all on function app.crm_followup_tokens(uuid) from public;
revoke all on function app.crm_followup_attachments(uuid) from public;
grant execute on function app.crm_followup_tokens(uuid) to cni_app;
grant execute on function app.crm_followup_attachments(uuid) to cni_app;

/* ⚠️ AND THE ROUTE MAY ADVANCE THE SEQUENCES ITSELF. `pg_cron` runs the engine
   every 15 minutes and the sender runs on its own timetable; with both, a step
   could wait half an hour for two clocks to line up. Letting the sender ask the
   engine first makes one call do both, and the engine is the same function with
   the same stop-conditions either way. */
grant execute on function app.crm_advance_sequences() to cni_app;

-- ============================================================================
-- SELF-CHECK — as cni_app, on a fixture that is rolled back
-- ============================================================================
do $chk$
declare
  v_project uuid; v_sales uuid; v_lead uuid; v_seq uuid; v_ls uuid; v_fu uuid;
  t record; v_can boolean := false;
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' limit 1;
  select l.id, l.owner_id into v_lead, v_sales
    from public.crm_leads l
    join public.users u on u.id = l.owner_id and u.is_active
   where l.project_id = v_project and l.is_test_data and l.stage not in ('won', 'lost')
     and not exists (select 1 from public.crm_lead_sequences ls
                      where ls.lead_id = l.id and ls.state in ('scheduled', 'active', 'paused'))
   limit 1;
  if v_lead is null then
    raise exception '189 · no demo lead free of a live sequence — refusing to skip the check';
  end if;

  begin
    insert into public.crm_sequences (project_id, lead_id, name, purpose, is_test_data, created_by_id)
    values (v_project, v_lead, 'SELFCHECK-189', 'no_response', true, v_sales) returning id into v_seq;
    insert into public.crm_sequence_steps (sequence_id, step_no, channel, delay_days, purpose, title, body, mode)
    values (v_seq, 1, 'whatsapp', 0, 'no_response', 'One', 'Hello.', 'auto_send');
    insert into public.crm_lead_sequences
      (lead_id, sequence_id, state, current_step, total_steps, started_at, next_step_at, created_by_id)
    values (v_lead, v_seq, 'active', 1, 1, now(), null, v_sales) returning id into v_ls;
    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at, lead_sequence_id,
       sequence_step_no, assigned_to_id, created_by_id)
    values (v_lead, 'no_response', 'whatsapp', 'auto_send', 'due', 'One', 'Hello.', now(),
            v_ls, 1, v_sales, v_sales)
    returning id into v_fu;

    set local role cni_app;
    perform set_config('app.user_id', '', true);
    select * into t from app.crm_followup_tokens(v_fu);
    v_can := true;
    reset role;

    if t.lead_first is null or t.lead_first = '' then
      raise exception '189 · the client''s name came back empty';
    end if;
    if t.owner_first is null or t.owner_first = '' then
      raise exception '189 · the salesperson''s name came back empty';
    end if;
    if t.company is null or t.company = '' then
      raise exception '189 · the business name came back empty';
    end if;

    -- ⚠️ AND IT ANSWERS NOTHING ONCE THE ROW IS NO LONGER DUE.
    update public.crm_follow_ups set status = 'done', done_at = now() where id = v_fu;
    set local role cni_app;
    perform set_config('app.user_id', '', true);
    if exists (select 1 from app.crm_followup_tokens(v_fu)) then
      reset role;
      raise exception '189 · a settled follow-up still answers with the client''s details';
    end if;
    reset role;

    raise exception using errcode = 'P0189', message = '189 rollback';
  exception when sqlstate 'P0189' then
    null;
  end;

  if not v_can then
    raise exception '189 · cni_app could not read the tokens';
  end if;
  if exists (select 1 from public.crm_sequences where name = 'SELFCHECK-189') then
    raise exception '189 · the self-check left rows behind';
  end if;

  raise notice '189 · the sender can fill a message with the client, the salesperson and the business, and only while the step is still due';
end $chk$;
