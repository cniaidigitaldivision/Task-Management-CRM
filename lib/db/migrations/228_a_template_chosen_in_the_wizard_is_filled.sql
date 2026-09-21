-- ============================================================================
-- 228 · A TEMPLATE CHOSEN IN THE WIZARD GETS ITS BLANKS FILLED
-- ----------------------------------------------------------------------------
-- 2026-09-21, 09:30: Umm e e Habiba's visit reminder was refused by Meta with
--
--     number of localizable_params (0) does not match the expected number (5)
--
-- That one was old deployed code. But checking the wizard afterwards found the
-- same fault waiting in the new code: a template's blanks are filled in exactly
-- two cases —
--
--   · the booking trigger (220), which freezes the words into
--     `crm_follow_ups.wa_template_values`, and
--   · a sequence step seeded with `crm_sequence_steps.wa_template_vars` (210) —
--     which only the greeting ever had.
--
-- A follow-up made from the wizard had neither. So a template with a name in it
-- — the kind the owner asked for (*"The first variable should be the real
-- name"*) — would be sent with no values and refused, every time.
--
-- ── ⚠️ TOKEN NAMES, NOT WORDS ──────────────────────────────────────────────
-- The follow-up stores WHICH values a template needs — `lead_first_name`,
-- `company` — and the sender resolves them when it sends, through
-- `crm_followup_tokens` (which uses 223's first-name rule). The same shape as
-- the greeting step, so there is one way this works, not two. Words frozen at
-- creation would carry 19 September's "Umm" into a message sent on the 25th.
-- ============================================================================

alter table public.crm_follow_ups
  add column if not exists wa_template_vars text[];

comment on column public.crm_follow_ups.wa_template_vars is
  'Token names filling the template''s {{1}}, {{2}}… in order (e.g. lead_first_name, company), resolved at send time. Null = none. wa_template_values, when set, wins — those are words frozen by the booking flow.';


/* The queue reads the follow-up's own list first, then its step's. Otherwise
   identical to 220's — the return shape is unchanged, so this replaces it. */
create or replace function app.crm_followups_to_send(p_limit integer default 25)
returns table(follow_up_id uuid, lead_id uuid, project_id uuid, lead_sequence_id uuid, owner_id uuid,
              channel text, title text, body text, subject text, lead_name text, to_phone text,
              to_email text, template_name text, template_language text, template_vars text[],
              template_values text[], document_ids uuid[], window_open boolean,
              wa_phone_number_id text, sender_name text, project_name text)
language sql
security definer
set search_path = public, app, pg_temp
as $fn$
  with claimed as (
    update public.crm_follow_ups f
       set claimed_at = now()
     where f.id in (
       select c.id
         from public.crm_follow_ups c
         join public.crm_leads l on l.id = c.lead_id
         join public.projects p on p.id = l.project_id
         left join public.crm_lead_sequences ls on ls.id = c.lead_sequence_id
         left join public.crm_sequence_steps st
                on st.sequence_id = ls.sequence_id and st.step_no = c.sequence_step_no
        where c.status in ('planned', 'due')
          and c.mode = 'auto_send'
          and c.due_at <= now()
          and (c.claimed_at is null or c.claimed_at < now() - interval '5 minutes')
          and l.stage not in ('won', 'lost')
          and (c.lead_sequence_id is null or app.crm_sequence_stop_reason(c.lead_sequence_id) is null)
          and (
            (c.channel = 'whatsapp'
             and l.phone_e164 is not null
             and p.whatsapp_phone_number_id is not null
             and l.whatsapp_consent is distinct from false
             /* 220 · the row's own template counts, not only a step's. */
             and (app.crm_window_is_open(c.lead_id)
                  or nullif(c.wa_template_name, '') is not null
                  or nullif(st.wa_template_name, '') is not null))
            or (c.channel = 'email' and l.email is not null)
          )
        order by c.due_at
        limit greatest(1, least(p_limit, 100))
        for update of c skip locked
     )
    returning f.id
  )
  select f.id, f.lead_id, l.project_id, f.lead_sequence_id, f.assigned_to_id,
         f.channel::text, f.title, f.body, st.subject,
         l.full_name, l.phone_e164, l.email,
         coalesce(nullif(f.wa_template_name, ''), nullif(st.wa_template_name, '')),
         coalesce(nullif(f.wa_template_language, ''), nullif(st.wa_template_language, ''), 'en'),
         /* 228 · the follow-up's own list, then the step's. */
         coalesce(f.wa_template_vars, st.wa_template_vars),
         f.wa_template_values,
         st.document_ids,
         app.crm_window_is_open(f.lead_id),
         p.whatsapp_phone_number_id,
         coalesce(nullif(trim(s.whatsapp_display_name), ''), p.name),
         p.name
    from claimed
    join public.crm_follow_ups f on f.id = claimed.id
    join public.crm_leads l on l.id = f.lead_id
    join public.projects p on p.id = l.project_id
    left join public.crm_project_settings s on s.project_id = p.id
    left join public.crm_lead_sequences ls on ls.id = f.lead_sequence_id
    left join public.crm_sequence_steps st
           on st.sequence_id = ls.sequence_id and st.step_no = f.sequence_step_no
   order by f.due_at
$fn$;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  v_project uuid; v_owner uuid; v_lead uuid; v_f uuid;
  v_vars text[]; v_values text[];
begin
  select p.id into v_project
    from public.projects p join public.departments d on d.id = p.lead_department_id
   where d.key = 'sales' and p.name like '%[demo]' and p.whatsapp_phone_number_id is not null limit 1;
  select u.id into v_owner
    from public.users u join public.departments d on d.id = u.department_id
   where d.key = 'sales' and u.is_active and u.role = 'member' limit 1;
  if v_project is null or v_owner is null then
    raise exception '228 · fixtures missing';
  end if;

  begin
    perform set_config('app.user_id', v_owner::text, true);

    insert into public.crm_leads (project_id, source, full_name, phone, phone_e164, stage, submitted_at, owner_id, is_test_data)
    values (v_project, 'manual', 'SELFCHECK-228', '+923000000228', '+923000000228', 'contacted', now(), v_owner, true)
    returning id into v_lead;

    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at, assigned_to_id, created_by_id,
       wa_template_name, wa_template_language, wa_template_vars)
    values (v_lead, 'missing_information', 'whatsapp', 'auto_send', 'due', 'Ask for details', 'x',
            now() - interval '1 minute', v_owner, v_owner,
            'lead_details_request', 'en_GB', array['lead_first_name', 'company'])
    returning id into v_f;

    select q.template_vars, q.template_values into v_vars, v_values
      from app.crm_followups_to_send(100) q where q.follow_up_id = v_f;

    raise exception using errcode = 'P0228', message = '228 rollback';
  exception when sqlstate 'P0228' then
    null;
  end;

  if v_vars is distinct from array['lead_first_name', 'company'] then
    raise exception '228 · the queue did not hand over the follow-up''s own token names (got %)', v_vars;
  end if;
  if v_values is not null then
    raise exception '228 · a follow-up with token names came back with frozen words';
  end if;

  raise notice '228 · a template chosen in the wizard carries the names of the values it needs';
end $chk$;
