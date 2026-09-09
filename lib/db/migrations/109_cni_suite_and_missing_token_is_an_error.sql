-- ============================================================================
-- 109 · A THIRD META SUITE, AND A MISSING VAULT TOKEN STOPS BEING SILENT
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-09: *"now for the Trend and Engagement Studio page I get one
-- more business portfolio access of a CNI whose Meta system user token I have
-- placed in the environment variable."*
--
-- The portfolio, read from the owner's screenshots of Meta Business Suite:
--
--   Business portfolio  "Attari Group of companies all ad account bussiness
--                        portfolio", id 969592372834161
--   System user         Taskly-App (61594170634834), Employee access
--   Facebook Page       Crescent Nova International — 862439430295746
--   Instagram           @crescentnovainternational — 17841480380597902
--
-- ⚠️ THE NAME BELOW IS THE BUSINESS, NOT THE PORTFOLIO. Meta's own label for
-- this portfolio mentions Attari because that is where the ad accounts live,
-- and there is ALREADY a suite in this table reaching Attari's pages. Two rows
-- both reading "Attari…" in the Connect dialog would be a coin toss. The row is
-- named for the business whose pages it is here to reach, which is also the
-- name of the Taskly project they will be linked to.
--
-- ⚠️ AND THE PAGES OVERLAP BETWEEN SUITES, WHICH IS FINE AND WORTH KNOWING.
-- Chitral Royal Homes' page is visible from this portfolio too. It is already
-- linked through the 'Chitral Royal Homes' suite, and `meta_accounts` keys one
-- row per Meta object id — so it cannot be linked twice. Whichever suite a page
-- was connected through is the token that syncs it, permanently, which is the
-- behaviour we want: no account silently changes hands because somebody opened
-- a different picker.
-- ============================================================================

insert into public.meta_portfolios (name, business_id, token_secret_name)
values (
  'Crescent Nova International',
  '969592372834161',
  'META_SYSTEM_USER_TOKEN_CNI'
)
on conflict (name) do update
   set business_id       = excluded.business_id,
       token_secret_name = excluded.token_secret_name;


-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ A NAMED-BUT-MISSING SECRET MUST NOT FALL BACK TO THE DIVISION'S TOKEN
-- ----------------------------------------------------------------------------
-- `app.meta_accounts_to_sync` returns a NULL token for two completely different
-- situations, and the caller cannot currently tell them apart:
--
--   1. The suite has NO `token_secret_name` — it deliberately uses
--      `META_SYSTEM_USER_TOKEN` from the environment. This is the division's
--      own suite and the fallback in lib/meta/client.ts is correct for it.
--
--   2. The suite NAMES a vault entry that does not exist — a typo, or a
--      migration that ran before the secret was placed. Today this also
--      produces NULL, so the client falls back to the division's token and
--      asks Meta for another company's pages with it. Graph refuses, and the
--      account records "(#100) Object does not exist" — an error about the
--      PAGE, pointing anywhere except at the missing secret.
--
-- One boolean tells them apart, so the sync can say what is actually wrong.
-- Adding a column to the return type means dropping the function first — a
-- return type cannot be widened by `create or replace`, the same reason 100,
-- 101 and 103 each had to.
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
  -- Null when the suite uses the environment variable, AND null when the vault
  -- entry it names is missing. `expects_vault_token` separates the two.
  token          text,
  -- True when this suite names a vault entry. A true here with a null token is
  -- a configuration fault, not a fallback.
  expects_vault_token boolean
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
         /* ⚠️ RESOLVED HERE RATHER THAN EXPOSED AS A LOOKUP. A general
            `token_for(name)` would let anything holding `cni_app` read any
            secret in the vault by guessing its name. This reaches exactly the
            secret belonging to an account that already exists. */
         (select s.decrypted_secret
            from vault.decrypted_secrets s
           where s.name = f.token_secret_name
           limit 1),
         f.token_secret_name is not null
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
  'Accounts to pull, each with the system-user token of its Meta suite (103, '
  'widened by 109). A null token with expects_vault_token = false means use '
  'META_SYSTEM_USER_TOKEN; with true it means the named vault entry is missing.';

grant execute on function app.meta_accounts_to_sync(uuid) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ⚠️ Runs as `cni_app` with no session, the way the cron calls it. A migration
-- executes as the schema owner and bypasses RLS, which is how a check passes
-- while proving nothing (094 did exactly that).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  n        integer;
  v_token  text;
  v_expect boolean;
begin
  select count(*) into n from public.meta_portfolios
   where name = 'Crescent Nova International'
     and business_id = '969592372834161'
     and token_secret_name = 'META_SYSTEM_USER_TOKEN_CNI';
  if n <> 1 then
    raise exception '109 · the CNI suite is not registered as expected';
  end if;

  set local role cni_app;
  perform set_config('app.user_id', '', true);

  -- 1 · The reader still answers a session-less caller. Restated because
  --     dropping and recreating the function is exactly when that is lost.
  select count(*) into n from app.meta_accounts_to_sync(null);
  if n = 0 then
    raise exception '109 · the reader returned no accounts to a session-less caller';
  end if;

  -- 2 · ⚠️ THE DIVISION'S OWN SUITE STILL FALLS BACK TO THE ENVIRONMENT, and
  --     now says so rather than merely producing a null.
  select token, expects_vault_token into v_token, v_expect
    from app.meta_accounts_to_sync(null)
   where portfolio_name = 'CNI AI & Digital Division'
   limit 1;

  if v_expect is not false then
    raise exception '109 · the division''s suite claims to expect a vault token';
  end if;
  if v_token is not null then
    raise exception '109 · the division''s suite resolved a vault token; it must use the environment';
  end if;

  -- 3 · A suite that names a vault entry says so, whether or not the entry is
  --     there yet. The CNI suite has no accounts at this point, so this is
  --     asserted against Chitral's, whose secret does exist.
  select token, expects_vault_token into v_token, v_expect
    from app.meta_accounts_to_sync(null)
   where portfolio_name = 'Chitral Royal Homes'
   limit 1;

  if v_expect is distinct from true then
    raise exception '109 · a vault-backed suite does not report expecting a token';
  end if;
  if v_token is null then
    raise exception '109 · a vault-backed suite resolved no token';
  end if;

  reset role;

  select count(*) into n from public.meta_portfolios;
  raise notice '109 · % Meta suite(s) registered; a missing vault entry is now distinguishable', n;
end $$;
