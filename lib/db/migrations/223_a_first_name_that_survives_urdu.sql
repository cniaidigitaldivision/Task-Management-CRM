-- ============================================================================
-- 223 · A FIRST NAME THAT SURVIVES AN URDU NAME
-- ----------------------------------------------------------------------------
-- Proving 222 on the sandbox sent a real client a real message reading:
--
--     "Shukriya Umm! Your site visit is confirmed for Monday 21 September…"
--
-- Her name is **Umm e Habiba**. `split_part(full_name, ' ', 1)` took "Umm",
-- which is not a name — it is the first half of one. The owner has already
-- caught this shape of mistake once, on the greeting: *"Look at the name:
-- 'Assalamu alaikum Ali.' Who is Ali?"*
--
-- ── ⚠️ THE RULE, AND WHY IT IS NOT "TAKE ONE WORD" ─────────────────────────
-- Urdu and Arabic names are built with connectors that carry no meaning alone.
-- Cutting at the first space turns them into fragments:
--
--     Umm e Habiba   → "Umm"    ✗        Zia ul Haq    → "Zia"    ✗
--     Noor ul Ain    → "Noor"   ✗        Naveed Khan   → "Naveed" ✓
--
-- So: take the first word, and keep going while the NEXT word is a connector,
-- then take the word it connects to. Everything else still stops at one word.
--
-- ⚠️ `bin`, `bint` and `ibn` are deliberately NOT connectors. They are
-- patronymics — "Muhammad bin Qasim" is greeted as Muhammad, the same way an
-- English name is greeted without its surname.
--
-- ⚠️ AND IT CAPITALISES A NAME TYPED IN LOWER CASE, because "Shukriya habiba"
-- reads as carelessness from the business, and leads arrive from ad forms where
-- people type fast. Connectors stay lower case: "Zia ul Haq", never "Zia Ul Haq".
-- ============================================================================

create or replace function app.crm_first_name(p_full text)
returns text
language plpgsql
immutable
as $fn$
declare
  v_words text[];
  v_take  int := 1;
  v_out   text[] := '{}';
  v_w     text;
  v_i     int;
  /* Short joining words that cannot stand as a name on their own. */
  v_conn  constant text[] := array['e', 'ul', 'ur', 'un', 'us', 'ud', 'al', 'el', 'la', 'de', 'van', 'von'];
begin
  v_words := regexp_split_to_array(btrim(coalesce(p_full, '')), '\s+');
  if v_words is null or array_length(v_words, 1) is null or v_words[1] = '' then
    return null;
  end if;

  /* Walk forward while the next word is a connector; then take one more.
     ⚠️ CAPPED AT FOUR. "Umm e e Habiba" is a real row in this database — a
     doubled connector from a typed form — and an uncapped loop on strange data
     would swallow a whole sentence. */
  while v_take < least(4, array_length(v_words, 1))
    and lower(v_words[v_take + 1]) = any (v_conn)
  loop
    v_take := v_take + 1;
  end loop;
  if v_take > 1 and v_take < array_length(v_words, 1) then
    v_take := v_take + 1;   -- the word the connector was joining to
  end if;

  for v_i in 1 .. v_take loop
    v_w := v_words[v_i];
    if lower(v_w) = any (v_conn) and v_i > 1 then
      v_out := v_out || lower(v_w);
    elsif v_w = lower(v_w) then
      v_out := v_out || (upper(left(v_w, 1)) || substr(v_w, 2));
    else
      v_out := v_out || v_w;
    end if;
  end loop;

  return nullif(array_to_string(v_out, ' '), '');
end;
$fn$;

grant execute on function app.crm_first_name(text) to cni_app;


-- ── The three places that were cutting at the first space ───────────────────
-- (`app` has exactly three, found with pg_get_functiondef — there is no fourth.)

create or replace function app.crm_followup_tokens(p_follow_up uuid)
returns table(lead_first text, lead_name text, owner_first text, owner_name text,
              company text, project text, quotation text, visit_when text)
language sql
stable security definer
set search_path = public, app, pg_temp
as $function$
  select
    coalesce(app.crm_first_name(l.full_name), 'Sir/Madam'),
    coalesce(nullif(btrim(l.full_name), ''), 'Sir/Madam'),
    coalesce(app.crm_first_name(u.full_name), ''),
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
     and app.crm_followup_is_due(f.id)
$function$;

/* The two from 222. Only the one line changes in each, so they are replaced by
   editing that line rather than restating the bodies here: */
do $patch$
declare
  v_name text;
  v_def  text;
  v_new  text;
begin
  foreach v_name in array array['crm_appointment_booked', 'crm_appointment_answered'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = v_name;

    v_new := replace(
      v_def,
      'coalesce(nullif(split_part(btrim(v_lead.full_name), '' '', 1), ''''), ''Sir/Madam'')',
      'coalesce(app.crm_first_name(v_lead.full_name), ''Sir/Madam'')');

    if v_new = v_def then
      raise exception '223 · % did not contain the line this migration replaces', v_name;
    end if;
    execute v_new;
  end loop;
end $patch$;


-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $chk$
declare
  cases constant text[][] := array[
    -- [what was typed,        what a person should be called]
    ['Umm e Habiba',           'Umm e Habiba'],
    ['Umm e e Habiba',         'Umm e e Habiba'],   -- a real row, doubled connector
    ['Zia ul Haq',             'Zia ul Haq'],
    ['Noor ul Ain Fatima',     'Noor ul Ain'],
    ['Naveed Khan',            'Naveed'],
    ['habiba minhas',          'Habiba'],           -- typed lower case on an ad form
    ['zia ul haq',             'Zia ul Haq'],       -- connectors stay lower
    ['Muhammad bin Qasim',     'Muhammad'],         -- patronymic, not a connector
    ['ZanZabeel',              'ZanZabeel'],        -- existing capitals left alone
    ['  Ali   Raza  ',         'Ali'],
    ['Habiba',                 'Habiba'],
    ['e',                      'E']
  ];
  i int;
  got text;
begin
  for i in 1 .. array_length(cases, 1) loop
    got := app.crm_first_name(cases[i][1]);
    if got is distinct from cases[i][2] then
      raise exception '223 · "%" became "%" and should be "%"', cases[i][1], got, cases[i][2];
    end if;
  end loop;

  /* Nothing, and nothing but spaces, are not names. */
  if app.crm_first_name(null) is not null or app.crm_first_name('   ') is not null then
    raise exception '223 · a blank name should be null so the caller can say Sir/Madam';
  end if;

  /* ⚠️ AND THE CALLERS ACTUALLY CHANGED. Patching by text replacement is only
     honest if it is checked, not assumed. */
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.proname in ('crm_appointment_booked', 'crm_appointment_answered', 'crm_followup_tokens')
       and pg_get_functiondef(p.oid) like '%split_part(btrim(%full_name), '' '', 1)%'
  ) then
    raise exception '223 · a caller is still cutting a name at the first space';
  end if;

  raise notice '223 · Umm e Habiba is greeted as Umm e Habiba, and Naveed Khan as Naveed';
end $chk$;
