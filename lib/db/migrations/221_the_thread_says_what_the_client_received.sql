-- ============================================================================
-- 221 · THE THREAD SAYS WHAT THE CLIENT ACTUALLY RECEIVED
-- ----------------------------------------------------------------------------
-- Found while proving 220's booking confirmation end to end. The greeting had
-- moved to the approved `lead_greeting_v2`, and the client received its words —
-- but the CRM's own thread showed the step's free-text body instead:
--
--   thread showed : "…thank you for your enquiry with X. How can I help?"
--   client got    : "…thank you for contacting X. We have received your enquiry
--                    and one of our team will contact you shortly. To save time
--                    while we do, could you please tell us what you are looking
--                    for?"
--
-- ⚠️ TWO DIFFERENT QUESTIONS. A salesperson reading that thread would open the
-- next reply believing they had asked "how can I help?", and answer the client's
-- message against a question nobody asked. "What did we actually send this
-- person" is the one thing a conversation record exists to answer.
--
-- The cause is ordinary: a step carries BOTH a free-text body (used inside the
-- 24-hour window) and a template name (used outside it), and the greeting's body
-- was written before v2 was approved. Nothing updated it, because nothing knew
-- the two had to agree.
--
-- ⚠️ SO THE BODY IS WRITTEN TO MATCH THE TEMPLATE, and the rule is stated where
-- the next person will need it: when a step has a template, its body must say
-- the same thing, because which of the two goes out depends only on whether the
-- client happened to write in the last 24 hours.
-- ============================================================================

create or replace function app.crm_project_greeting_sequence(p_project uuid)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_seq uuid;
  v_set record;
begin
  select * into v_set from public.crm_project_settings where project_id = p_project;
  if not found or not v_set.greeting_on then
    return null;
  end if;

  select s.id into v_seq
    from public.crm_sequences s
   where s.project_id = p_project and s.lead_id is null and s.name = 'Greeting'
   limit 1;

  if v_seq is null then
    insert into public.crm_sequences
      (project_id, lead_id, name, purpose, stop_on_reply, stop_on_visit, stop_on_quotation_dead,
       send_from_hour, send_to_hour, send_days, is_active, is_test_data)
    values (p_project, null, 'Greeting', 'custom', true, false, false,
            0, 24, array[0,1,2,3,4,5,6]::smallint[], true, false)
    returning id into v_seq;
  end if;

  insert into public.crm_sequence_steps
    (sequence_id, step_no, channel, delay_days, purpose, title, body, mode,
     only_if_no_reply, wa_template_name, wa_template_language, wa_template_vars)
  values (v_seq, 1, 'whatsapp', 0, 'custom', 'Greeting',
          /* 221 · the same words as `lead_greeting_v2`, because either may go. */
          'Assalam-o-Alaikum {{lead_first_name}}, thank you for contacting {{company}}.'
            || E'\n\n'
            || 'We have received your enquiry and one of our team will contact you shortly. '
            || 'To save time while we do, could you please tell us what you are looking for?',
          'auto_send', false,
          nullif(btrim(coalesce(v_set.greeting_template_name, '')), ''),
          coalesce(nullif(btrim(coalesce(v_set.greeting_template_language, '')), ''), 'en'),
          v_set.greeting_vars)
  on conflict (sequence_id, step_no) do update
     set wa_template_name = excluded.wa_template_name,
         wa_template_language = excluded.wa_template_language,
         wa_template_vars = excluded.wa_template_vars,
         body = excluded.body,
         mode = excluded.mode;

  return v_seq;
end;
$fn$;

-- The step that already exists is rewritten from the settings on the next lead,
-- but a project that greets nobody today would keep the old wording until then.
update public.crm_sequence_steps st
   set body = 'Assalam-o-Alaikum {{lead_first_name}}, thank you for contacting {{company}}.'
              || E'\n\n'
              || 'We have received your enquiry and one of our team will contact you shortly. '
              || 'To save time while we do, could you please tell us what you are looking for?'
  from public.crm_sequences q
 where q.id = st.sequence_id
   and q.name = 'Greeting'
   and st.wa_template_name = 'lead_greeting_v2';

do $chk$
declare v_body text; v_tpl text;
begin
  select st.body, st.wa_template_name into v_body, v_tpl
    from public.crm_sequence_steps st
    join public.crm_sequences q on q.id = st.sequence_id
   where q.name = 'Greeting' limit 1;

  if v_tpl is null then
    raise notice '221 · no greeting is configured yet; nothing to check';
    return;
  end if;
  if v_body like '%How can I help%' then
    raise exception '221 · the greeting body still asks a question the template does not';
  end if;
  if v_body not like '%thank you for contacting%' then
    raise exception '221 · the greeting body does not match lead_greeting_v2: %', v_body;
  end if;
  raise notice '221 · the greeting thread now says what the client receives';
end $chk$;
