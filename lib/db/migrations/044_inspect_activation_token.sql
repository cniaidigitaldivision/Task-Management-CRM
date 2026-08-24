-- ============================================================================
-- 044 · THE ACTIVATION PAGE CAN SEE THE INVITATION IT WAS OPENED WITH
-- ----------------------------------------------------------------------------
-- Owner, 2026-08-23, after three invitations in a row: *"why invitation link is
-- not working"* — on the Vercel URL, on the subdomain, and finally on
-- localhost, all showing "This link is not usable".
--
-- ⚠️ AND IT WAS NEVER THE LINK. Each token was hashed and found in the
-- database: present, correct purpose, unconsumed, uninvalidated, unexpired,
-- attempt_count 0. Three different tokens, all live, all rejected.
--
-- ── THE CAUSE ────────────────────────────────────────────────────────────────
-- `inspectToken` reads `invitations` joined to `users` through `withAppRole`,
-- which sets `role = cni_app` but deliberately sets NO `app.user_id` — the
-- reader is an anonymous stranger holding a link, which is the whole point.
--
-- Both tables have RLS, and both policies are written in terms of the current
-- user. With no identity, `invitations` returns nothing and `users` returns
-- nothing. Measured, not assumed: the page's exact query returns 0 rows
-- anonymously and 1 row when identified.
--
-- So the query was correct, the token was correct, and the row was invisible.
-- There is no error in that path — an empty result IS the "not usable" branch —
-- which is why it looked like an expiry problem and survived three rounds of
-- looking at the wrong thing (a stale deployment, then a database mismatch;
-- both were real observations and neither was this).
--
-- ⚠️ THIS AFFECTED EVERY ENVIRONMENT EQUALLY. Nobody has ever been able to
-- activate an account through the page, anywhere, since it was written.
--
-- ── WHY A SECURITY DEFINER FUNCTION IS THE RIGHT ANSWER ──────────────────────
-- The alternative is an RLS policy letting an anonymous session select from
-- `invitations`, which would open the whole table to reach one row.
--
-- This is the pattern the rest of the authentication path already uses
-- (`app.auth_consume_token`, `app.session_resolve`): a narrow definer function
-- that answers exactly one question. The argument is the token HASH, so calling
-- it requires already holding a 256-bit token — the same thing that authorises
-- consuming it. It returns the three fields the page needs to greet somebody
-- and apply the right password floor for their role, and nothing else. No id,
-- no other invitation, no way to enumerate.
--
-- STABLE, not VOLATILE: looking is not using. The page must be re-renderable —
-- people refresh, browsers restore tabs, and several mail clients prefetch
-- links to scan them. The token is spent in the action, once, when a password
-- is actually set.
-- ============================================================================

create or replace function app.auth_inspect_activation(p_token_hash text)
returns table (full_name text, email text, role public.user_role)
language sql
security definer
stable
set search_path to ''
as $function$
  select u.full_name, u.email, u.role
    from public.invitations i
    join public.users u on u.id = i.user_id
   where i.token_hash = p_token_hash
     and i.purpose = 'activation'::public.invitation_purpose
     and i.consumed_at is null
     and i.invalidated_at is null
     and i.expires_at > now()
   limit 1
$function$;

comment on function app.auth_inspect_activation(text) is
  'Reads the person behind a live activation token, for the page they land on. '
  'SECURITY DEFINER because the reader is an anonymous stranger holding a link '
  'and both underlying tables are identity-scoped by RLS. Does not consume the '
  'token — rendering must be repeatable. Migration 044.';

revoke all on function app.auth_inspect_activation(text) from public;
grant execute on function app.auth_inspect_activation(text) to cni_app;
