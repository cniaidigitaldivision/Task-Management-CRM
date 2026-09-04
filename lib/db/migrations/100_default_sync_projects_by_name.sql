-- ============================================================================
-- 100 · THE DEFAULT-SYNC READER RETURNS A NAME — owner, 2026-09-04
-- ----------------------------------------------------------------------------
-- ⚠️ THE BUG THIS FIXES WOULD HAVE PULLED EVERY RULED PROJECT TWICE PER CYCLE.
-- 099 made the runner rule-driven, and `app/api/meta-sync` now runs the due
-- rules and then the default pull. But the default pull had no way to SKIP a
-- project that has rules — `runMetaSync` filters by project NAME (the account
-- reader returns no id, and changing its shape means dropping a function the
-- live cron depends on), while 099's reader returned only ids.
--
-- So a project with a rule would have been collected by its rule and then again
-- by the default pull: double the Graph API budget, and a rule scoped to
-- "posts only" silently widened back to everything by the pull that followed it.
-- Every upsert is idempotent so no data would have been wrong — which is
-- precisely why this would not have been noticed.
--
-- The fix is one column. `drop` first because a function's return type cannot be
-- changed by `create or replace`.
-- ============================================================================

drop function if exists app.meta_projects_on_default_sync();

create function app.meta_projects_on_default_sync()
returns table (project_id uuid, project_name text)
language sql
security definer
set search_path = public, app, pg_temp
as $$
  select distinct a.project_id, p.name
    from public.meta_accounts a
    join public.projects p on p.id = a.project_id
    left join public.meta_sync_settings s on s.project_id = a.project_id
   where a.is_active
     -- ⚠️ THE OFF SWITCH STOPS THE DEFAULT PULL TOO, not only the rules. 099's
     -- rule reader already honours it; a project switched off must not keep
     -- collecting through the very path that runs when it has no rules.
     and coalesce(s.auto_sync_enabled, true)
     and not exists (
       select 1 from public.meta_sync_rules r
        where r.project_id = a.project_id and r.is_active
     )
$$;

comment on function app.meta_projects_on_default_sync() is
  'Projects still on the default two-hourly pull — those with no active sync '
  'rule and auto-sync on (100). Returns the NAME because runMetaSync filters '
  'by name; see its option comment.';

grant execute on function app.meta_projects_on_default_sync() to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ RUNS AS `cni_app` WITH NO SESSION, exactly as the cron does — a migration
-- executes as the schema owner and bypasses RLS, which is how 094's self-check
-- passed while proving nothing. Touches no live row.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin    uuid;
  v_project  uuid;
  v_platform uuid;
  v_account  uuid;
  v_before   bigint;
  v_after    bigint;
  n          integer;
  nm         text;
begin
  select count(*) into v_before from public.projects;

  select id into v_admin from public.users
   where role in ('super_admin','admin') and is_active limit 1;
  select id into v_platform from public.platforms where slug = 'facebook' limit 1;

  if v_admin is null or v_platform is null then
    raise notice '100 · no admin or facebook platform; the function is in place, self-check skipped';
    return;
  end if;

  insert into public.projects (name, type, code, created_by_id, owner_id)
  values ('100 self-check — delete me', 'other', 'OTH', v_admin, v_admin)
  returning id into v_project;

  insert into public.meta_accounts (project_id, platform_id, meta_object_id, linked_by_id)
  values (v_project, v_platform, '100-SELFCHECK-OBJECT', v_admin)
  returning id into v_account;

  set local role cni_app;
  perform set_config('app.user_id', '', true);

  -- 1 · With no rules it is on the default pull, and the NAME comes back — the
  --     whole point of this migration.
  select project_name into nm from app.meta_projects_on_default_sync()
   where project_id = v_project;
  if nm is null then
    raise exception '100 · the reader returned no name for a project on the default pull';
  end if;
  if nm <> '100 self-check — delete me' then
    raise exception '100 · the reader returned the wrong name: %', nm;
  end if;

  reset role;

  -- 2 · ⚠️ ONE ACTIVE RULE TAKES IT OFF THE DEFAULT PULL. Without this the
  --     project is collected twice a cycle.
  insert into public.meta_sync_rules (project_id, name, frequency, created_by_id)
  values (v_project, '100 rule', 'daily', v_admin);

  set local role cni_app;
  select count(*) into n from app.meta_projects_on_default_sync() where project_id = v_project;
  if n <> 0 then
    raise exception '100 · a project with an active rule is still on the default pull — it would sync twice';
  end if;
  reset role;

  -- 3 · A PAUSED rule puts it back: a project with only paused rules is
  --     collecting nothing otherwise.
  update public.meta_sync_rules set is_active = false where project_id = v_project;

  set local role cni_app;
  select count(*) into n from app.meta_projects_on_default_sync() where project_id = v_project;
  if n <> 1 then
    raise exception '100 · a project whose only rule is paused fell off the default pull entirely';
  end if;
  reset role;

  -- 4 · Auto-sync off removes it from the default pull as well.
  insert into public.meta_sync_settings (project_id, auto_sync_enabled, paused_at, paused_by_id)
  values (v_project, false, now(), v_admin);

  set local role cni_app;
  select count(*) into n from app.meta_projects_on_default_sync() where project_id = v_project;
  if n <> 0 then
    raise exception '100 · a project with auto-sync off is still being pulled';
  end if;
  reset role;

  delete from public.projects where id = v_project;
  if exists (select 1 from public.meta_accounts where id = v_account) then
    raise exception '100 · the self-check account outlived its project';
  end if;

  select count(*) into v_after from public.projects;
  if v_after <> v_before then
    raise exception '100 · project count changed from % to % — the self-check leaked a row', v_before, v_after;
  end if;

  raise notice '100 · the default-sync reader names its projects';
end $$;
