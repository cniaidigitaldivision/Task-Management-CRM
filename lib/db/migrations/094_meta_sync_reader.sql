-- ============================================================================
-- 094 · WHAT THE SYNC IS ALLOWED TO READ — owner, 2026-09-04
-- ----------------------------------------------------------------------------
-- 093 gave the sync a way to WRITE. This gives it a way to READ, and the reason
-- it needs one is worth recording rather than patching around.
--
-- ── ⚠️ THE SYNC HAS NO USER, SO ROW-LEVEL SECURITY CORRECTLY HID EVERYTHING ─
-- The first run of the sync reported success and touched nothing: it found zero
-- accounts. Not a bug in the sync — RLS working exactly as designed. The job
-- runs from a cron with no signed-in person, `app.current_user_id()` is null,
-- and `meta_accounts_select` requires `app.project_is_visible(project_id)`,
-- which fails closed for an anonymous session. As it should.
--
-- ⚠️ THE TEMPTING FIX IS THE WRONG ONE. `lib/db/client.ts` says it outright in
-- the note on `withAppRole`: *"Do not reach for this to get around a policy. If
-- a query needs data the acting user cannot see, that is a permission
-- question."* Loosening `meta_accounts_select` to admit anonymous sessions would
-- expose every client's follower numbers to any unauthenticated path that
-- reached the table.
--
-- So the answer is the one this codebase already uses for the same shape — the
-- pre-authentication surface (C-15) and `app.record_device_scan` both do it: a
-- small, named, SECURITY DEFINER function that returns EXACTLY what the caller
-- needs and nothing more. It is greppable, reviewable, and cannot be widened by
-- accident the way a relaxed policy can.
--
-- ⚠️ NOTE WHAT IT DELIBERATELY DOES NOT RETURN: no `last_error`, no
-- `permalink`, no `display_name`, no `followers`. The sync needs an id, an
-- object id, and which platform to talk to. Everything else it would only be
-- carrying around, and a function that returns the whole row is one somebody
-- later reuses for a screen — at which point it is a hole rather than a reader.
-- ============================================================================

create or replace function app.meta_accounts_to_sync(p_account_id uuid default null)
returns table (
  id             uuid,
  meta_object_id text,
  platform_slug  text,
  project_name   text,
  never_synced   boolean
)
language sql
security definer
set search_path = public, app, pg_temp
stable
as $$
  select a.id,
         a.meta_object_id,
         pl.slug,
         p.name,
         a.last_synced_at is null
    from public.meta_accounts a
    join public.projects  p  on p.id  = a.project_id
    join public.platforms pl on pl.id = a.platform_id
   where a.is_active
     and (p_account_id is null or a.id = p_account_id)
   order by p.name, pl.sort_order;
$$;

comment on function app.meta_accounts_to_sync(uuid) is
  'The accounts the Meta sync should pull, for a cron with no signed-in user '
  '(094). SECURITY DEFINER because RLS correctly hides everything from an '
  'anonymous session; returns only what the sync needs, never the whole row.';

-- ⚠️ REVOKED FROM public FIRST. A SECURITY DEFINER function is executable by
-- everybody unless said otherwise, which would make this exactly the hole the
-- header argues against.
revoke execute on function app.meta_accounts_to_sync(uuid) from public;
grant  execute on function app.meta_accounts_to_sync(uuid) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin uuid; v_ig uuid; v_project uuid; v_account uuid;
  v_before bigint; v_after bigint; n integer;
begin
  select count(*) into v_before from public.projects;

  select id into v_admin from public.users where role in ('super_admin','admin') and is_active limit 1;
  select id into v_ig    from public.platforms where slug = 'instagram' limit 1;
  if v_admin is null or v_ig is null then
    raise notice '094 · no admin or platform row; function is in place, self-check skipped';
    return;
  end if;

  perform set_config('app.user_id', v_admin::text, true);

  insert into public.projects (name, type, code, created_by_id, owner_id)
  values ('094 self-check — delete me', 'other', 'OTH', v_admin, v_admin)
  returning id into v_project;

  insert into public.meta_accounts (project_id, platform_id, meta_object_id, linked_by_id)
  values (v_project, v_ig, '094-SELFCHECK-OBJECT', v_admin)
  returning id into v_account;

  -- ── 1 · ⚠️ THE ASSERTION THIS FILE EXISTS FOR. With NO user id set — exactly
  --        the cron's situation — the reader must still find the account.
  perform set_config('app.user_id', '', true);

  select count(*) into n from app.meta_accounts_to_sync() where id = v_account;
  if n <> 1 then
    raise exception '094 · the sync reader found % rows with no user set; the cron would sync nothing', n;
  end if;

  -- ── 2 · And a DIRECT read must still be refused.
  --
  -- ⚠️ THIS HAS TO CHANGE ROLE TO MEAN ANYTHING, and a first draft did not — it
  -- asserted the direct select returned nothing and the migration failed with
  -- "RLS is not failing closed". The migration runs as the schema owner, and an
  -- owner BYPASSES row-level security entirely, so the test was measuring the
  -- migration's own privilege rather than the policy. Under `cni_app` — the role
  -- the application actually connects as — the policy applies.
  set local role cni_app;
  select count(*) into n from public.meta_accounts where id = v_account;
  reset role;

  if n <> 0 then
    raise exception '094 · cni_app read meta_accounts directly with no user — RLS is not failing closed';
  end if;

  -- ── 3 · A brand-new account is flagged for the full backfill.
  if not exists (select 1 from app.meta_accounts_to_sync() where id = v_account and never_synced) then
    raise exception '094 · a never-synced account is not flagged, so it would get a 7-day window not 30';
  end if;

  -- ── 4 · The single-account filter works, for a manual re-pull.
  select count(*) into n from app.meta_accounts_to_sync(v_account);
  if n <> 1 then
    raise exception '094 · filtering to one account returned % rows', n;
  end if;

  perform set_config('app.user_id', v_admin::text, true);
  delete from public.projects where id = v_project;

  select count(*) into v_after from public.projects;
  if v_after <> v_before then
    raise exception '094 · project count went from % to %', v_before, v_after;
  end if;

  raise notice '094 · the sync can read its accounts; an anonymous session still cannot';
end $$;
