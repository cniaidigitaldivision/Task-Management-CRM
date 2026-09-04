-- ============================================================================
-- 095 · THE SYNC ALSO HAS TO READ THE CATALOGUE — owner, 2026-09-04
-- ----------------------------------------------------------------------------
-- ⚠️ THE SAME FAULT AS 094, IN A SECOND PLACE, AND IT FAILED SILENTLY AGAIN.
--
-- After 094 the sync found its accounts and reported success:
--
--     OK  facebook    0 days   25 posts
--     OK  instagram   1 days   25 posts
--
-- Posts landed. Days did not. Nothing errored, and the run was marked `ok` —
-- which is the worst shape a bug can take, because the Studio would have drawn
-- empty graphs beside a full post list and nothing would have said why.
--
-- The cause: `meta_metric_catalogue` carries its own policy from 091,
-- `app.current_user_id() is not null`. The cron has no user, so the catalogue
-- returned ZERO rows, so the sync iterated an empty metric list and fetched no
-- series at all. Posts are unaffected because they do not consult the
-- catalogue — which is exactly why the failure was partial and quiet.
--
-- ── WHY NOT JUST OPEN THE POLICY ────────────────────────────────────────────
-- Genuinely tempting here, and defensible: the catalogue is a vocabulary — the
-- strings 'reach', 'views', 'page_follows' — with no client data in it at all.
-- Making it world-readable would leak nothing.
--
-- It is still the wrong instinct to act on. The rule this codebase follows is
-- that a job needing data an anonymous session cannot see asks through a named
-- function, not by widening a policy until the job works. Widening is how a
-- table that "has nothing sensitive in it today" becomes the one that does. The
-- function costs three lines and cannot drift.
--
-- ── ⚠️ THE LESSON, FOR THE NEXT PIECE OF THIS INTEGRATION ───────────────────
-- Every table the sync touches needs this considered ONCE, deliberately, rather
-- than discovered one silent failure at a time. The full list is now:
--   meta_accounts           → app.meta_accounts_to_sync    (094)
--   meta_metric_catalogue   → app.meta_catalogue_for       (095, this file)
--   meta_metric_days        → written via app.record_meta_sync (093)
--   meta_posts              → written via app.record_meta_sync (093)
--   meta_post_metrics       → written via app.record_meta_sync (093)
--   meta_sync_runs          → written via app.record_meta_sync* (093)
-- That is all of them. There is no third instance of this waiting.
-- ============================================================================

create or replace function app.meta_catalogue_for(p_platform text)
returns table (metric_key text, fetch_mode text)
language sql
security definer
set search_path = public, app, pg_temp
stable
as $$
  select c.metric_key, c.fetch_mode
    from public.meta_metric_catalogue c
   where c.platform = p_platform
     and c.is_active
   order by c.sort_order;
$$;

comment on function app.meta_catalogue_for(text) is
  'The active metrics for one platform, for a cron with no signed-in user (095). '
  'SECURITY DEFINER for the same reason as app.meta_accounts_to_sync: RLS '
  'correctly hides the catalogue from an anonymous session.';

revoke execute on function app.meta_catalogue_for(text) from public;
grant  execute on function app.meta_catalogue_for(text) to cni_app;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare n integer; m integer;
begin
  -- ⚠️ WITH NO USER SET — the cron's exact situation, and the one that returned
  -- an empty list and a falsely successful run.
  perform set_config('app.user_id', '', true);

  select count(*) into n from app.meta_catalogue_for('facebook');
  if n < 5 then
    raise exception '095 · the reader found % facebook metrics with no user; the sync would fetch nothing', n;
  end if;

  select count(*) into m from app.meta_catalogue_for('instagram');
  if m < 10 then
    raise exception '095 · the reader found % instagram metrics with no user', m;
  end if;

  -- And a direct read is still refused for the role the application uses.
  set local role cni_app;
  select count(*) into n from public.meta_metric_catalogue;
  reset role;

  if n <> 0 then
    raise exception '095 · cni_app read the catalogue directly with no user — the policy is not applying';
  end if;

  -- ⚠️ The fetch_mode must survive the trip. Marking an Instagram metric as
  -- 'series' when it needs 'total_value' is the (#100) error that reads like a
  -- typo, and it would come back through this function.
  if not exists (
    select 1 from app.meta_catalogue_for('instagram')
     where metric_key = 'views' and fetch_mode = 'total_value'
  ) then
    raise exception '095 · views came back without fetch_mode=total_value and would be fetched wrongly';
  end if;

  raise notice '095 · the sync can read the catalogue; an anonymous session still cannot';
end $$;
