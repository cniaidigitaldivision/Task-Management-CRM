-- ============================================================================
-- 103 · ONE META SUITE PER TOKEN — owner, 2026-09-07
-- ----------------------------------------------------------------------------
-- *"CNI AI & Digital Division have a separate Meta suite… keep it separate.
-- Now I am giving access to the Chitral Royal Homes Meta suite. When I open it
-- there are two businesses and both are our internal businesses — Chitral Royal
-- Homes plus Attari Group of Companies… go and check whether it's working."*
--
-- It could not have worked. `lib/meta/client.ts` reads ONE
-- `META_SYSTEM_USER_TOKEN` from the environment, and migration 091 deliberately
-- stored no token per account — there was one business portfolio when it was
-- written and a stored page token would have been an encrypted secret needing to
-- be kept fresh. That reasoning still holds for PAGE tokens, which are derived
-- per request. It does not hold for the SYSTEM USER token, of which there is now
-- one per suite.
--
-- ── ⚠️ THE TOKEN IS NOT IN THIS TABLE, ONLY ITS NAME ───────────────────────
-- `token_secret_name` points at a Supabase Vault entry. A token in an ordinary
-- column is readable by anything that can read the row, appears in every
-- `select *`, and lands in any database dump somebody emails around. The vault
-- keeps it encrypted at rest and out of all of those.
--
-- ── ⚠️ AND THERE IS NO GENERAL-PURPOSE SECRET READER ───────────────────────
-- The obvious shape — `app.token_for(name text)` — would let anything holding
-- the `cni_app` role read ANY vault secret by guessing its name, including the
-- session secret and the storage key. Instead `app.meta_accounts_to_sync`
-- resolves the token itself, so the only secret reachable is the one belonging
-- to an account that already exists, and only through the function the sync
-- already calls.
-- ============================================================================

create table if not exists public.meta_portfolios (
  id                 uuid primary key default gen_random_uuid(),

  -- The name as it appears in Meta Business Suite, so the two can be compared
  -- by eye when somebody is working out why a page is missing.
  name               text not null unique check (length(trim(name)) between 2 and 80),

  -- Meta's own business portfolio id. Not used for calls — the token already
  -- scopes those — but it is what somebody pastes into a Meta URL to find the
  -- suite this row describes.
  business_id        text,

  /* ⚠️ THE NAME OF A VAULT ENTRY, NEVER THE TOKEN.
     Null means "use META_SYSTEM_USER_TOKEN from the environment", which is what
     every existing account does — see the note in the reader below on why that
     fallback is load-bearing rather than tidy. */
  token_secret_name  text,

  is_active          boolean     not null default true,
  created_at         timestamptz not null default now(),
  created_by_id      uuid references public.users(id) on delete set null,

  -- A vault name must look like an environment key. Enforced because a typo
  -- here fails at sync time with "no token", far from its cause.
  constraint meta_portfolios_secret_name_shape check (
    token_secret_name is null or token_secret_name ~ '^[A-Za-z0-9_]{3,64}$'
  )
);

comment on table public.meta_portfolios is
  'One Meta Business Suite per row (103). Holds the NAME of a Supabase Vault '
  'entry, never a token. Null name means the environment variable.';


-- ── Every account belongs to a suite ───────────────────────────────────────
alter table public.meta_accounts
  add column if not exists portfolio_id uuid references public.meta_portfolios(id) on delete restrict;

create index if not exists meta_accounts_portfolio_idx on public.meta_accounts (portfolio_id);

comment on column public.meta_accounts.portfolio_id is
  'Which Meta suite this account is reached through (103). Null uses the '
  'environment token, which is the pre-103 behaviour.';


-- ── The suite that already works, and the one being added ──────────────────
-- ⚠️ THE EXISTING ROW GETS A NULL SECRET NAME ON PURPOSE. Its token is already
-- in the environment and in Vercel, the sync has been running on it for days,
-- and moving it into the vault in the same migration that introduces the vault
-- path would mean two things changing at once with no way to tell which broke.
insert into public.meta_portfolios (name, business_id, token_secret_name)
values
  ('CNI AI & Digital Division', null, null),
  ('Chitral Royal Homes', '594786136783646', 'META_SYSTEM_USER_TOKEN_ChitralRoyalHomes')
on conflict (name) do nothing;

-- Everything linked so far belongs to the division's own suite.
update public.meta_accounts
   set portfolio_id = (select id from public.meta_portfolios where name = 'CNI AI & Digital Division')
 where portfolio_id is null;


-- ════════════════════════════════════════════════════════════════════════════
-- THE READER, NOW CARRYING A TOKEN
-- ----------------------------------------------------------------------------
-- ⚠️ `drop` FIRST — a function's return type cannot be widened by `create or
-- replace`. Same reason 100 and 101 had to.
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists app.meta_accounts_to_sync(uuid);

create function app.meta_accounts_to_sync(p_account_id uuid default null)
returns table (
  id             uuid,
  meta_object_id text,
  platform_slug  text,
  project_name   text,
  never_synced   boolean,
  portfolio_name text,
  -- Null when the suite uses the environment variable. The caller falls back.
  token          text
)
language sql
security definer
set search_path = public, app, vault, pg_temp
stable
as $$
  select a.id,
         a.meta_object_id,
         pl.slug,
         p.name,
         a.last_synced_at is null,
         coalesce(f.name, 'CNI AI & Digital Division'),
         /* ⚠️ RESOLVED HERE RATHER THAN EXPOSED AS A LOOKUP. See the header:
            a general `token_for(name)` would let the app role read any secret
            in the vault by guessing its name. This reaches exactly the secret
            belonging to an account that already exists. */
         (select s.decrypted_secret
            from vault.decrypted_secrets s
           where s.name = f.token_secret_name
           limit 1)
    from public.meta_accounts a
    join public.projects  p  on p.id  = a.project_id
    join public.platforms pl on pl.id = a.platform_id
    left join public.meta_portfolios f on f.id = a.portfolio_id
   where a.is_active
     and coalesce(f.is_active, true)
     and (p_account_id is null or a.id = p_account_id)
   order by p.name, pl.sort_order;
$$;

comment on function app.meta_accounts_to_sync(uuid) is
  'Accounts to pull, each with the system-user token of its Meta suite (103). '
  'A null token means the caller should use META_SYSTEM_USER_TOKEN.';

grant execute on function app.meta_accounts_to_sync(uuid) to cni_app;


-- ── Suites are readable by the app, writable by an Admin ───────────────────
alter table public.meta_portfolios enable row level security;

drop policy if exists meta_portfolios_select on public.meta_portfolios;
create policy meta_portfolios_select on public.meta_portfolios
  for select using (app.current_user_id() is not null);

-- ⚠️ ADMIN ONLY, and note what it does NOT grant: naming a vault entry is not
-- reading one. Nothing in the application can retrieve a token through this
-- table; only the SECURITY DEFINER reader above resolves one, and only for a
-- real account.
drop policy if exists meta_portfolios_write on public.meta_portfolios;
create policy meta_portfolios_write on public.meta_portfolios
  for all
  using      (app.acting_at_least('admin'::public.user_role))
  with check (app.acting_at_least('admin'::public.user_role));

grant select on public.meta_portfolios to cni_app;
grant insert, update, delete on public.meta_portfolios to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ RUNS AS `cni_app` WITH NO SESSION, as the cron does. A migration executes
-- as the schema owner and bypasses RLS, which is how 094's self-check passed
-- while proving nothing. Touches no live row.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  n        integer;
  v_token  text;
  v_suite  text;
begin
  -- 1 · Every existing account was adopted by a suite. An orphan would silently
  --     fall back to the environment token and look fine until the day that
  --     token is rotated for one client and not another.
  select count(*) into n from public.meta_accounts where portfolio_id is null;
  if n > 0 then
    raise exception '103 · % account(s) belong to no Meta suite', n;
  end if;

  -- 2 · A malformed vault name is refused, because it fails far from its cause.
  begin
    insert into public.meta_portfolios (name, token_secret_name)
    values ('103 bad name', 'not a valid key!');
    raise exception '103 · a malformed vault entry name was accepted';
  exception when check_violation then
    null;
  end;

  set local role cni_app;
  perform set_config('app.user_id', '', true);

  -- 3 · The reader still works without a session — restated because dropping and
  --     recreating the function is exactly when that property is lost unnoticed.
  select count(*) into n from app.meta_accounts_to_sync(null);
  if n = 0 then
    raise exception '103 · the reader returned no accounts to a session-less caller';
  end if;

  -- 4 · ⚠️ THE POINT OF THE MIGRATION. Existing accounts must come back with a
  --     NULL token so the caller falls back to the environment, exactly as
  --     before. A non-null token here would mean the division's own sync had
  --     quietly switched to a vault entry that may not exist.
  select token, portfolio_name into v_token, v_suite
    from app.meta_accounts_to_sync(null) limit 1;

  if v_suite <> 'CNI AI & Digital Division' then
    raise exception '103 · the first account reports suite %, expected the division', v_suite;
  end if;
  if v_token is not null then
    raise exception '103 · an existing account resolved a vault token; it should fall back to the environment';
  end if;

  reset role;

  select count(*) into n from public.meta_portfolios;
  raise notice '103 · % Meta suite(s) registered; existing accounts still on the environment token', n;
end $$;
