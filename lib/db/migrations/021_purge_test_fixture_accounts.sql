-- =============================================================================
-- 021 · PURGE THE INTEGRATION-TEST FIXTURE ACCOUNTS
-- =============================================================================
-- ⚠️ THIS IS A DELIBERATE, ONE-OFF EXCEPTION TO BR-007. Owner approved
-- 2026-08-10 after being shown the counts and the three options.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
-- The Team screen showed **115 deactivated accounts against 8 active ones** —
-- a 13:1 ratio of litter to people.
--
-- They are all integration-test fixtures. `test/integration/provisioning.test.ts`
-- creates accounts to prove FR-141's provisioning chain, and it CANNOT clean up
-- after itself by deleting them: BR-007 forbids deleting a user and
-- `app.enforce_users_write_rules()` enforces that for every role including the
-- table owner. So the test does the only thing available to it — deactivates
-- them and renames them `retired-<uuid>@prov-test.invalid`. Correct behaviour;
-- it simply accumulates, one batch per run.
--
-- ── WHY DELETING THESE IS NOT A BREACH OF WHAT BR-007 PROTECTS ───────────────
-- BR-007 exists so that "removing someone preserves all their tasks, comments
-- and time logs" — a deleted row takes its history with it and leaves audit
-- entries pointing at nothing. That reasoning does not apply to a row that never
-- had any history. Verified before writing this, across all 115:
--
--     authored comments   0        created tasks       0
--     created projects    0        logged time         0
--     uploaded files      0        extensions          0
--
-- Every one of the eight RESTRICT foreign keys into `public.users` is therefore
-- unreferenced for these rows. If that were ever untrue the delete would be
-- refused by the constraint rather than silently orphaning anything — which is
-- the safety net, not the plan.
--
-- ── THE PREDICATE IS DELIBERATELY NARROW ─────────────────────────────────────
-- Five conditions, each doing real work:
--
--   email like 'retired-%'     the rename the test applies, and nothing else
--   email like '%.invalid'     `.invalid` is RFC 2606 reserved — it can never be
--                              a real address, so this cannot match a person
--   not is_active              a live account is out of scope whatever it is named
--   role <> 'super_admin'      belt and braces; FR-156 and the trigger refuse it
--   no RESTRICT references     re-checked here, not just before writing this
--
-- ── IT USES THE DOCUMENTED BREAK-GLASS PATH, NOT A DISABLED TRIGGER ──────────
-- `alter table ... disable trigger` would have worked and would have been the
-- wrong choice: it turns the guarantee off silently and leaves no trace. The
-- trigger already has a designed escape hatch for exactly this situation
-- (doc 16 §6) — set `app.break_glass`, and every deleted row writes its own
-- `break_glass_used` CRITICAL security event before it goes.
--
-- So this purge is self-documenting: after it runs, `/security` shows 115
-- critical events naming what was destroyed and why. The audit trail survives
-- the thing it describes, which is the whole point of BR-007's reasoning.
--
-- ── THIS DOES NOT STOP IT HAPPENING AGAIN ───────────────────────────────────
-- It is a cleanup, not a fix. The real fix is pointing the integration suite at
-- a separate Supabase project (owner option 3, not chosen yet). Until then this
-- migration is re-runnable and harmless: it matches nothing once the rows are
-- gone, and can be re-applied after a future test run.
-- =============================================================================

do $$
declare
  doomed   uuid[];
  removed  integer;
begin
  -- Set inside the DO block so it lives only for this transaction. No
  -- application code path can set this (doc 16 §6) — it requires direct
  -- database access, which is what running a migration is.
  perform set_config('app.break_glass', 'on', true);

  select coalesce(array_agg(u.id), '{}')
    into doomed
    from public.users u
   where u.email like 'retired-%'
     and u.email like '%.invalid'
     and not u.is_active
     and u.role <> 'super_admin'
     -- Re-checked here rather than trusted from the earlier survey: a row that
     -- authored anything must survive, and the constraint would refuse it
     -- anyway. Being explicit means the count reported below is honest.
     and not exists (select 1 from public.comments               c where c.author_id       = u.id)
     and not exists (select 1 from public.tasks                  t where t.created_by_id   = u.id)
     and not exists (select 1 from public.projects               p where p.created_by_id   = u.id or p.owner_id = u.id)
     and not exists (select 1 from public.time_entries          te where te.user_id        = u.id)
     and not exists (select 1 from public.attachments            a where a.uploaded_by_id  = u.id)
     and not exists (select 1 from public.time_extension_requests x
                       where x.requested_by_id = u.id or x.decided_by_id = u.id);

  raise notice 'Fixture accounts matched for purge: %', coalesce(array_length(doomed, 1), 0);

  if coalesce(array_length(doomed, 1), 0) = 0 then
    raise notice 'Nothing to do — already clean.';
    return;
  end if;

  delete from public.users where id = any(doomed);
  get diagnostics removed = row_count;

  -- One summarising row on top of the 115 the trigger writes, so the security
  -- feed carries the INTENT and not only the individual acts.
  insert into public.security_events (event_type, severity, details)
  values (
    'permanent_purge',
    'critical',
    jsonb_build_object(
      'migration', '021',
      'target', 'integration-test fixture accounts',
      'removed', removed,
      'reason', 'BR-007 exception approved by the owner 2026-08-10. Synthetic '
             || 'accounts on the RFC 2606 reserved .invalid domain, created by '
             || 'test/integration/provisioning.test.ts, with no comments, tasks, '
             || 'projects, time entries, attachments or extensions attached.'
    )
  );

  raise notice 'Purged % fixture account(s). Each wrote its own break_glass_used event.', removed;
end
$$;
