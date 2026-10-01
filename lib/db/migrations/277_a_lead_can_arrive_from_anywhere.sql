-- ============================================================================
-- 277 · A LEAD CAN ARRIVE FROM ANYWHERE
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-30, setting the order of work:
--
--   *"Webform and inbound API: do it right now."*
--
-- One endpoint serves both. A web form is an inbound API call that happens to
-- be form-encoded, and building two things that accept the same lead is how the
-- two come to disagree about what a lead is.
--
-- ── ⚠️ 277, NOT 276 ──────────────────────────────────────────────────────
-- `main` took 276 for the attendance schedule while this branch was paused. Two
-- files with one number is a history that cannot be merged, so this is 277 and
-- the branches stay compatible.
--
-- ── ⚠️ IT DOES NOT CALL `crm_create_lead`, AND THAT IS NOT LAZINESS ──────
-- That function is the right front door for a PERSON: it raises CRM00 when
-- there is no acting user, and an HTTP request from a website has none. The
-- alternatives were to invent a system account — which would put a fictional
-- name on every lead's "created by" — or to set `app.user_id` to whoever minted
-- the key, which would be a lie about who took the enquiry.
--
-- So this inserts directly, exactly as migrations 160 (the Meta importer) and
-- 270 (the WhatsApp stranger) already do, and lets the SAME triggers run:
-- `crm_leads_assign_on_arrival` gives it to the rota, `crm_leads_greet` greets
-- it if the project can and consent allows. A web form lead is an arrival like
-- any other and is treated as one.
--
-- ── ⚠️ THE KEY IS SEMI-PUBLIC AND THE DESIGN ASSUMES IT ──────────────────
-- A key embedded in a web page can be read by anybody who views the source.
-- That is unavoidable for a browser form and it is why the key buys exactly one
-- thing: the ability to file a lead on ONE project. It cannot read anything, it
-- cannot see a lead, and every use of it is counted on its own row. The
-- defences that matter are therefore rate limiting, the block list, and an
-- origin allow-list — not secrecy.
-- ============================================================================

-- ── 1 · the keys ────────────────────────────────────────────────────────────
create table if not exists public.crm_intake_keys (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,

  /* What it is for, in somebody's own words — "Chitral landing page". */
  label           text not null,

  /* ⚠️ THE FIRST EIGHT CHARACTERS, STORED IN CLEAR, so a list can name a key
     without holding one. The rest exists only as a hash: a key that can be read
     back out of this table is a key that leaks the day somebody exports it. */
  key_prefix      text not null,
  key_hash        text not null,

  is_enabled      boolean not null default true,
  revoked_at      timestamptz,

  /* What arrives under this key when the request does not say. */
  default_source  public.crm_lead_source not null default 'website',

  /* ⚠️ EMPTY MEANS ANY ORIGIN, and that is the honest default rather than a
     safe-looking one: a key on a page nobody has told us about still has to
     work, or the first install fails for a reason nobody can see. Naming the
     origins narrows it, and the endpoint answers CORS from this list. */
  allowed_origins text[] not null default '{}',

  /* ⚠️ A CEILING PER KEY, not per IP. An IP is shared by a whole office and
     spoofable by anything that is not a browser; the key is the thing we issued
     and the thing we can turn off. */
  hourly_limit    int not null default 60,

  accepted        int not null default 0,
  refused         int not null default 0,
  last_used_at    timestamptz,
  last_refusal    text,

  created_by_id   uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint crm_intake_keys_prefix_unique unique (key_prefix),
  constraint crm_intake_keys_hash_unique   unique (key_hash),
  constraint crm_intake_keys_limit_sane    check (hourly_limit between 1 and 10000)
);

comment on table public.crm_intake_keys is
  'Per-project keys that let a website form or another system file a lead. The key itself is never stored — only its hash. Migration 277.';

grant select, insert, update on public.crm_intake_keys to cni_app;
alter table public.crm_intake_keys enable row level security;

/* ⚠️ `(select app.fn())` so each helper is an InitPlan, computed once rather
   than once per row — CLAUDE.md law 5. */
drop policy if exists crm_intake_keys_select on public.crm_intake_keys;
create policy crm_intake_keys_select on public.crm_intake_keys
  for select using (
    (select app.acting_at_least('admin'::public.user_role))
    or app.crm_manages_project(project_id)
  );

/* Only a manager of that project, or an Admin, issues or withdraws a key. */
drop policy if exists crm_intake_keys_write on public.crm_intake_keys;
create policy crm_intake_keys_write on public.crm_intake_keys
  for all using (
    (select app.acting_at_least('admin'::public.user_role))
    or app.crm_manages_project(project_id)
  )
  with check (
    (select app.acting_at_least('admin'::public.user_role))
    or app.crm_manages_project(project_id)
  );

-- ── 2 · which key filed which lead ──────────────────────────────────────────
-- ⚠️ PROVENANCE, AND THE RATE LIMIT READS IT. "Where did this lead come from"
-- is answered exactly rather than inferred from `source_detail` text, and
-- counting an hour's arrivals becomes one indexed query instead of a counter
-- that drifts whenever a transaction rolls back.
alter table public.crm_leads
  add column if not exists intake_key_id uuid references public.crm_intake_keys (id) on delete set null;

create index if not exists crm_leads_intake_key_recent
  on public.crm_leads (intake_key_id, submitted_at desc)
  where intake_key_id is not null;

-- ── 3 · minting and withdrawing ─────────────────────────────────────────────
/**
 * Issue a key. Returns the plaintext ONCE; it is never recoverable afterwards.
 *
 * ⚠️ THE CALLER DOES NOT CHOOSE THE KEY. It is generated here from
 * `gen_random_bytes`, so a weak one cannot be supplied by a caller who means
 * well and picks something memorable.
 */
create or replace function app.crm_mint_intake_key(
  p_project uuid,
  p_label   text,
  p_source  public.crm_lead_source default 'website',
  p_origins text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $function$
declare
  v_key    text;
  v_id     uuid;
  v_label  text := nullif(btrim(coalesce(p_label, '')), '');
begin
  if not app.crm_manages_project(p_project)
     and not app.acting_at_least('admin'::public.user_role) then
    raise exception 'Only a manager of that project, or an Admin, can issue an intake key.'
      using errcode = 'check_violation';
  end if;
  if v_label is null then
    raise exception 'A key needs a label, so somebody can tell later what it was for.'
      using errcode = 'check_violation';
  end if;

  /* ⚠️ A PREFIX THAT SAYS WHAT IT IS. A key found in a page source or a log is
     recognisable as ours and as an intake key specifically, which is what makes
     it reportable instead of mysterious. */
  v_key := 'tkl_' || encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.crm_intake_keys
    (project_id, label, key_prefix, key_hash, default_source, allowed_origins, created_by_id)
  values (p_project, v_label, left(v_key, 12),
          encode(extensions.digest(v_key, 'sha256'), 'hex'),
          p_source, coalesce(p_origins, '{}'), app.current_user_id())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'key', v_key, 'prefix', left(v_key, 12));
end $function$;

create or replace function app.crm_revoke_intake_key(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_project uuid;
begin
  select project_id into v_project from public.crm_intake_keys where id = p_id;
  if v_project is null then
    return false;
  end if;
  if not app.crm_manages_project(v_project)
     and not app.acting_at_least('admin'::public.user_role) then
    raise exception 'Only a manager of that project, or an Admin, can withdraw an intake key.'
      using errcode = 'check_violation';
  end if;

  /* ⚠️ WITHDRAWN, NOT DELETED. The leads it filed point at it, and a key that
     vanishes takes the answer to "where did these come from" with it. */
  update public.crm_intake_keys
     set is_enabled = false, revoked_at = coalesce(revoked_at, now())
   where id = p_id;
  return true;
end $function$;

-- ── 4 · the intake itself ───────────────────────────────────────────────────
/**
 * File a lead from a website form or another system.
 *
 * Returns `{ok, status, id}`. `status` is one of:
 *   created    a new lead
 *   duplicate  we already have this person on this project, open — its id
 *   ignored    a honeypot was filled, or the number is blocked. Answered as a
 *              success on purpose; see below.
 *
 * It also returns a REFUSAL rather than raising:
 *   bad_key       the key is unknown or withdrawn    → the route answers 401
 *   rate_limited  the hourly ceiling is spent        → 429
 *   incomplete    no name, or no way to contact      → 400
 *
 * ⚠️⚠️ IT RETURNS THESE, IT DOES NOT RAISE THEM, AND THE COUNTERS ARE WHY.
 * The first version raised — which reads well and threw away the evidence: a
 * `raise` rolls the transaction back, taking the `refused` and `last_refusal`
 * updates with it. Driving the real endpoint showed `accepted 3, refused 0`
 * after three refusals, so the one place an owner could have seen a key being
 * abused or misconfigured would have said zero forever.
 *
 * ⚠️ A DISCARD IS STILL A SUCCESS. A honeypot hit and a blocked number return
 * `ignored` with ok:true, because telling a bot which of its tricks was spotted
 * is how it learns to stop using it.
 */
create or replace function app.crm_intake_lead(p_key text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $function$
declare
  v_key     record;
  v_hash    text;
  v_recent  int;
  v_name    text := nullif(btrim(coalesce(p_payload->>'fullName', '')), '');
  v_phone   text := nullif(btrim(coalesce(p_payload->>'phone', '')), '');
  v_e164    text := nullif(btrim(coalesce(p_payload->>'phoneE164', '')), '');
  v_email   text := lower(nullif(btrim(coalesce(p_payload->>'email', '')), ''));
  v_city    text := nullif(btrim(coalesce(p_payload->>'city', '')), '');
  v_enq     text := nullif(btrim(coalesce(p_payload->>'enquiry', '')), '');
  v_detail  text := nullif(btrim(coalesce(p_payload->>'sourceDetail', '')), '');
  v_budget  bigint;
  v_source  public.crm_lead_source;
  v_lead    uuid;
  v_open    uuid;
begin
  if coalesce(btrim(p_key), '') = '' then
    return jsonb_build_object('ok', false, 'status', 'bad_key', 'error', 'No intake key.');
  end if;
  v_hash := encode(extensions.digest(p_key, 'sha256'), 'hex');

  select * into v_key from public.crm_intake_keys where key_hash = v_hash;
  if v_key.id is null then
    /* ⚠️ NOTHING TO COUNT AGAINST. An unknown key has no row, which is also why
       a flood of them cannot be seen here — that is the web server's job. */
    return jsonb_build_object('ok', false, 'status', 'bad_key',
      'error', 'That intake key is not recognised.');
  end if;
  if not v_key.is_enabled or v_key.revoked_at is not null then
    update public.crm_intake_keys
       set refused = refused + 1, last_refusal = 'key withdrawn', last_used_at = now()
     where id = v_key.id;
    return jsonb_build_object('ok', false, 'status', 'bad_key',
      'error', 'That intake key has been withdrawn.');
  end if;

  /* ── ⚠️ THE HONEYPOT IS CHECKED BEFORE ANYTHING IS COUNTED ────────────
     A field no human can see, filled in. It is not an error and it does not
     count against the hourly limit — a bot hammering the trap must not be able
     to lock a real form out by exhausting its budget. */
  if coalesce(btrim(coalesce(p_payload->>'_trap', '')), '') <> '' then
    return jsonb_build_object('ok', true, 'status', 'ignored');
  end if;

  /* ── the hourly ceiling ──────────────────────────────────────────────── */
  select count(*) into v_recent from public.crm_leads
   where intake_key_id = v_key.id and submitted_at > now() - interval '1 hour';
  if v_recent >= v_key.hourly_limit then
    update public.crm_intake_keys
       set refused = refused + 1, last_refusal = 'hourly limit', last_used_at = now()
     where id = v_key.id;
    return jsonb_build_object('ok', false, 'status', 'rate_limited',
      'error', format('That intake key has filed %s leads in the last hour, which is its limit.', v_recent));
  end if;

  /* ── what a lead must have, the same two things as everywhere else ───── */
  if v_name is null then
    update public.crm_intake_keys
       set refused = refused + 1, last_refusal = 'no name', last_used_at = now()
     where id = v_key.id;
    return jsonb_build_object('ok', false, 'status', 'incomplete',
      'error', 'A lead needs a name.');
  end if;
  if v_phone is null and v_email is null then
    update public.crm_intake_keys
       set refused = refused + 1, last_refusal = 'no way to contact', last_used_at = now()
     where id = v_key.id;
    return jsonb_build_object('ok', false, 'status', 'incomplete',
      'error', 'A lead needs a phone number or an email address.');
  end if;

  /* ⚠️ NORMALISED HERE ONLY IF THE CALLER DID NOT. `lib/domain/phone.ts` is the
     product's one phone parser and it is TypeScript; the route runs it and
     sends `phoneE164`. A caller posting raw JSON may not, and a null is a
     better answer than a guess — the raw value is kept either way. */
  if v_e164 is null and v_phone is not null and v_phone ~ '^\+[0-9]{8,15}$' then
    v_e164 := v_phone;
  end if;

  /* ── a number we have already turned away (migration 270) ────────────── */
  if v_e164 is not null
     and exists (select 1 from public.crm_blocked_numbers where phone_e164 = v_e164) then
    update public.crm_intake_keys
       set refused = refused + 1, last_refusal = 'blocked number', last_used_at = now()
     where id = v_key.id;
    return jsonb_build_object('ok', true, 'status', 'ignored');
  end if;

  /* ── somebody we already have, still open ────────────────────────────── */
  /* ⚠️ RETURNED AS A SUCCESS, NOT AN ERROR. A form submitted twice — a double
     click, a slow connection, a browser retry — must not produce two leads, and
     must not show the visitor a failure for something they did right. */
  select l.id into v_open
    from public.crm_leads l
   where l.project_id = v_key.project_id
     and l.archived_at is null
     and l.stage not in ('won', 'lost')
     and ((v_e164 is not null and l.phone_e164 = v_e164)
       or (v_email is not null and lower(l.email) = v_email))
   order by l.submitted_at desc
   limit 1;

  if v_open is not null then
    update public.crm_intake_keys
       set accepted = accepted + 1, last_used_at = now() where id = v_key.id;
    return jsonb_build_object('ok', true, 'status', 'duplicate', 'id', v_open);
  end if;

  /* ── the channel ─────────────────────────────────────────────────────── */
  begin
    v_source := coalesce(nullif(p_payload->>'source', ''), v_key.default_source::text)
                  ::public.crm_lead_source;
  exception when others then
    /* ⚠️ AN UNKNOWN CHANNEL FALLS BACK AND KEEPS THE WORD, exactly as the
       importer does. Filing it as a channel we invented would put a figure in
       "Which app the leads came from" that no integration produced. */
    v_source := v_key.default_source;
    v_detail := nullif(concat_ws(' · ', p_payload->>'source', v_detail), '');
  end;

  begin
    v_budget := nullif(regexp_replace(coalesce(p_payload->>'budget', ''), '[^0-9]', '', 'g'), '')::bigint;
  exception when others then
    v_budget := null;
  end;

  insert into public.crm_leads
    (project_id, full_name, phone, phone_e164, email, city,
     source, source_detail, budget, stage, submitted_at,
     whatsapp_consent, intake_key_id)
  values (v_key.project_id, v_name, v_phone, v_e164, v_email, v_city,
          v_source, coalesce(v_detail, v_key.label), v_budget,
          'new'::public.crm_stage, now(),
          /* ⚠️ ONLY WHEN THE FORM SAYS SO. NULL is "nobody asked" and leaves the
             greeting trigger's own judgement intact; a hard true here would
             assert a consent nobody gave. */
          case when p_payload->>'whatsappConsent' in ('true', '1', 'yes', 'on') then true end,
          v_key.id)
  returning id into v_lead;

  if v_enq is not null then
    insert into public.crm_lead_notes (lead_id, body, author_id)
    values (v_lead, v_enq, null);
  end if;

  update public.crm_intake_keys
     set accepted = accepted + 1, last_used_at = now(), last_refusal = null
   where id = v_key.id;

  return jsonb_build_object('ok', true, 'status', 'created', 'id', v_lead);
end $function$;

comment on function app.crm_intake_lead(text, jsonb) is
  'Files a lead from a website form or another system, given an intake key. Migration 277.';

revoke all on function app.crm_mint_intake_key(uuid, text, public.crm_lead_source, text[]) from public;
revoke all on function app.crm_revoke_intake_key(uuid) from public;
revoke all on function app.crm_intake_lead(text, jsonb) from public;
grant execute on function app.crm_mint_intake_key(uuid, text, public.crm_lead_source, text[]) to cni_app;
grant execute on function app.crm_revoke_intake_key(uuid) to cni_app;
grant execute on function app.crm_intake_lead(text, jsonb) to cni_app;

-- ============================================================================
-- SELF-CHECK — AS cni_app, BECAUSE 271 HAPPENED
-- ----------------------------------------------------------------------------
-- A definer's EXECUTE grant is invisible to any check that runs as the
-- migration owner, which is how a button shipped that could never be pressed.
-- ============================================================================
do $$
declare
  v_manager uuid;
  v_project uuid;
  v_minted  jsonb;
  v_key     text;
  v_key_id  uuid;
  v_out     jsonb;
  v_lead    uuid;
  v_owner   uuid;
  v_notes     int;
  v_refused_n int;
  v_last      text;
  NUMBER    constant text := '+923000002771';
begin
  select u.id into v_manager
    from public.crm_preview_members m
    join public.users u on u.id = m.user_id
   where u.is_active and u.department_role = 'manager'
     and exists (select 1 from public.projects p where p.lead_department_id = u.department_id)
   limit 1;
  if v_manager is null then
    raise exception 'NO CRM-PREVIEW MANAGER ON A PROJECT — this check cannot run, and a pass would mean nothing';
  end if;

  select p.id into v_project from public.projects p
    join public.users u on u.id = v_manager
   where p.lead_department_id = u.department_id limit 1;

  if exists (select 1 from public.crm_leads where phone_e164 = NUMBER) then
    raise exception 'THE 277 FIXTURE NUMBER IS ALREADY IN USE';
  end if;

  set local role cni_app;
  perform set_config('app.user_id', v_manager::text, true);

  -- ── 1 · mint ─────────────────────────────────────────────────────────────
  v_minted := app.crm_mint_intake_key(v_project, '277 self-check', 'website'::public.crm_lead_source);
  v_key := v_minted->>'key';
  v_key_id := (v_minted->>'id')::uuid;
  if v_key is null or v_key !~ '^tkl_[0-9a-f]{48}$' then
    raise exception '277 · the minted key is not the shape it should be: %', v_key;
  end if;

  -- ⚠️ AND THE PLAINTEXT IS NOT IN THE TABLE.
  if exists (select 1 from public.crm_intake_keys where id = v_key_id and key_hash = v_key) then
    raise exception '277 · the key was stored in clear';
  end if;

  -- ── 2 · a lead arrives ───────────────────────────────────────────────────
  v_out := app.crm_intake_lead(v_key, jsonb_build_object(
    'fullName', '277 Website Visitor', 'phone', NUMBER, 'phoneE164', NUMBER,
    'email', '277@example.invalid', 'city', 'Islamabad',
    'enquiry', 'Asking about 5 marla plots'));
  if v_out->>'status' <> 'created' then
    raise exception '277 · a good payload did not create a lead: %', v_out;
  end if;
  v_lead := (v_out->>'id')::uuid;
  reset role;

  -- ⚠️ THE ROTA STILL RAN. A web form lead is an arrival like any other, and if
  -- this is null the trigger did not fire and every such lead would sit unowned.
  select owner_id into v_owner from public.crm_leads where id = v_lead;
  if v_owner is null then
    raise exception '277 · the lead was created unowned — crm_leads_assign_on_arrival did not run';
  end if;
  if (select intake_key_id from public.crm_leads where id = v_lead) is distinct from v_key_id then
    raise exception '277 · the lead does not record which key filed it';
  end if;
  select count(*) into v_notes from public.crm_lead_notes where lead_id = v_lead;
  if v_notes <> 1 then
    raise exception '277 · the enquiry was not kept as a note (% notes)', v_notes;
  end if;

  -- ── 3 · the same form submitted twice is one lead ────────────────────────
  set local role cni_app;
  v_out := app.crm_intake_lead(v_key, jsonb_build_object(
    'fullName', '277 Website Visitor', 'phone', NUMBER, 'phoneE164', NUMBER));
  if v_out->>'status' <> 'duplicate' or (v_out->>'id')::uuid <> v_lead then
    raise exception '277 · a repeat submission did not return the first lead: %', v_out;
  end if;

  -- ── 4 · the honeypot is silent ───────────────────────────────────────────
  v_out := app.crm_intake_lead(v_key, jsonb_build_object(
    'fullName', '277 Bot', 'phone', '+923000002779', '_trap', 'http://spam'));
  reset role;
  if v_out->>'status' <> 'ignored' then
    raise exception '277 · a honeypot hit was not ignored: %', v_out;
  end if;
  if exists (select 1 from public.crm_leads where phone_e164 = '+923000002779') then
    raise exception '277 · a honeypot hit created a lead';
  end if;

  -- ── 5 · an incomplete payload is refused AND COUNTED ─────────────────────
  -- ⚠️⚠️ THE COUNT IS THE POINT OF THIS CASE. The first version of this
  -- function RAISED on a refusal, which rolls the transaction back and takes
  -- the counter with it: driving the real endpoint gave "accepted 3, refused 0"
  -- after three refusals, so the one place an owner could see a key being
  -- abused would have read zero forever. Asserting the refusal alone would
  -- still pass against that bug.
  set local role cni_app;
  v_out := app.crm_intake_lead(v_key, jsonb_build_object('phone', '+923000002776'));
  reset role;
  if v_out->>'status' <> 'incomplete' then
    raise exception '277 · a payload with no name was accepted: %', v_out;
  end if;
  select refused, last_refusal into v_refused_n, v_last from public.crm_intake_keys where id = v_key_id;
  if v_refused_n <> 1 or v_last <> 'no name' then
    raise exception '277 · the refusal was not recorded on the key (refused=%, last=%) — a raise would have rolled it back',
      v_refused_n, v_last;
  end if;

  -- ── 6 · an unknown key is refused ────────────────────────────────────────
  set local role cni_app;
  v_out := app.crm_intake_lead('tkl_not_a_real_key',
    jsonb_build_object('fullName', 'X', 'phone', '+923000002778'));
  reset role;
  if v_out->>'status' <> 'bad_key' then
    raise exception '277 · an unknown key was accepted: %', v_out;
  end if;

  -- ── 7 · a withdrawn key stops working ────────────────────────────────────
  set local role cni_app;
  perform set_config('app.user_id', v_manager::text, true);
  if not app.crm_revoke_intake_key(v_key_id) then
    raise exception '277 · the key could not be withdrawn';
  end if;
  v_out := app.crm_intake_lead(v_key, jsonb_build_object('fullName', 'Y', 'phone', '+923000002777'));
  reset role;
  if v_out->>'status' <> 'bad_key' then
    raise exception '277 · a withdrawn key still files leads: %', v_out;
  end if;
  if exists (select 1 from public.crm_leads where phone_e164 = '+923000002777') then
    raise exception '277 · a withdrawn key created a lead';
  end if;

  -- ── clean up ─────────────────────────────────────────────────────────────
  delete from public.crm_lead_notes where lead_id = v_lead;
  delete from public.crm_lead_activity where lead_id = v_lead;
  delete from public.crm_lead_assignments where lead_id = v_lead;
  delete from public.crm_leads where id = v_lead;
  delete from public.crm_intake_keys where id = v_key_id;
  if exists (select 1 from public.crm_leads where phone_e164 = NUMBER) then
    raise exception 'THE 277 FIXTURE SURVIVED';
  end if;

  raise notice '277 self-check passed: a key mints and is never stored in clear, a form files a lead the rota picks up, a repeat returns the first lead, a honeypot is silent, a refusal is COUNTED rather than rolled back, and an unknown or withdrawn key files nothing';
exception
  when others then
    reset role;
    raise;
end $$;
