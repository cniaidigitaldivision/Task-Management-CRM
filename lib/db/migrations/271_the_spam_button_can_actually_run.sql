-- ============================================================================
-- 271 · THE SPAM BUTTON CAN ACTUALLY RUN
-- ----------------------------------------------------------------------------
-- Found by pressing it. Migration 270 shipped `app.crm_mark_spam` with a
-- self-check that passed, a button on the lead record, and a server action —
-- and the button could never have worked, because 270 ends with:
--
--     revoke all on function app.crm_mark_spam(uuid, text) from public;
--     revoke all on function app.crm_unmark_spam(text) from public;
--
-- and no matching GRANT. The app connects as `cni_app`. `cni_app` had no
-- EXECUTE, so Postgres refused at the door with `42501 permission denied for
-- function crm_mark_spam` — before a single line of the function ran.
--
-- ── ⚠️ AND THE SCREEN BLAMED THE WRONG THING ─────────────────────────────
-- The action's catch block guesses:
--
--     } catch { return { ok: false, error: 'Only a manager can mark a number
--                                           as spam.' }; }
--
-- So a manager pressing it was told, in plain words, that they were not a
-- manager. Measured in the browser as `sale manager tester`, whose own session
-- answers `app.crm_manages_own_department() = true`. The grant is the fix; the
-- action is being taught to report the real error in the same change.
--
-- ⚠️ 270'S SELF-CHECK COULD NOT HAVE CAUGHT THIS. It runs inside the migration,
-- as the migration owner, who has EXECUTE on everything. A definer's grants are
-- invisible to every test that does not run as the role that will call it — the
-- same trap as `definers-hide-missing-grants`. So the check below SETS ROLE
-- cni_app and calls the functions the way the application does.
--
-- ── ⚠️ AND WHILE LOOKING: A DEFINER LEFT OPEN TO PUBLIC ──────────────────
-- 270 rewrote `app.crm_record_inbound_message` with two new parameters. A
-- `create or replace` with a NEW SIGNATURE does not replace anything — it
-- creates a second function, with DEFAULT privileges, which in Postgres means
-- EXECUTE TO PUBLIC. Read off pg_proc just now:
--
--     10 args → {postgres=X/postgres,cni_app=X/postgres}
--     12 args → NULL                                      ← public may execute
--
-- This cluster has `anon` and `authenticated`. A SECURITY DEFINER that creates
-- leads and writes messages must not be reachable by either, and every other
-- definer in this schema is explicitly revoked. Closed here.
--
-- ── ⚠️ AND THE OLD OVERLOAD IS NOW A TRAP ────────────────────────────────
-- Both overloads still exist and the 12-arg one has four defaults, so a
-- ten-argument call now matches BOTH and raises `function ... is not unique`.
-- Nothing calls it — the webhook passes twelve, and `prosrc` across the whole
-- database mentions it nowhere — so it is dropped rather than left to be found
-- by whoever next writes the obvious call.
-- ============================================================================

-- ── 1 · the grants 270 forgot ───────────────────────────────────────────────
grant execute on function app.crm_mark_spam(uuid, text) to cni_app;
grant execute on function app.crm_unmark_spam(text) to cni_app;

-- ── 2 · the inbound recorder is not public ──────────────────────────────────
revoke all on function app.crm_record_inbound_message(
  text, text, text, text, text, text, text, timestamptz, text, boolean,
  text, text) from public;
grant execute on function app.crm_record_inbound_message(
  text, text, text, text, text, text, text, timestamptz, text, boolean,
  text, text) to cni_app;

-- ── 3 · the dead overload ───────────────────────────────────────────────────
-- ⚠️ SIGNATURE SPELLED IN FULL. `drop function app.crm_record_inbound_message`
-- without one would be ambiguous and would fail; with the wrong one it would
-- drop the live function and take every inbound WhatsApp message with it.
drop function if exists app.crm_record_inbound_message(
  text, text, text, text, text, text, text, timestamptz, text, boolean);

-- ============================================================================
-- SELF-CHECK — AS cni_app, WHICH IS THE WHOLE POINT
-- ----------------------------------------------------------------------------
-- ⚠️ EVERY CALL BELOW RUNS UNDER `set local role cni_app`. Run as the migration
-- owner they would all pass, which is exactly how 270 shipped a button that
-- could not be pressed.
--
-- ⚠️ AND IT REFUSES TO PASS QUIETLY. Each step raises if the fixture it needs is
-- absent, rather than skipping and printing a tick for a rule it never ran.
-- ============================================================================
do $$
declare
  v_manager uuid;
  v_project uuid;
  v_pid     text;
  v_lead    uuid;
  v_msg     uuid;
  v_before  int;
  NUMBER    constant text := '+923000000271';
begin
  -- ── the fixture: a real manager, and a project with a real number ────────
  select u.id into v_manager
    from public.users u
   where u.is_active and u.department_role = 'manager'
     and exists (select 1 from public.projects p
                  where p.lead_department_id = u.department_id
                    and p.whatsapp_phone_number_id is not null)
   limit 1;
  if v_manager is null then
    raise exception 'NO DEPARTMENT MANAGER ON A PROJECT WITH A WHATSAPP NUMBER — this check cannot run, and a pass here would mean nothing';
  end if;

  select p.id, p.whatsapp_phone_number_id into v_project, v_pid
    from public.projects p
    join public.users u on u.id = v_manager
   where p.lead_department_id = u.department_id
     and p.whatsapp_phone_number_id is not null
   limit 1;

  delete from public.crm_blocked_numbers where phone_e164 = NUMBER;
  select count(*) into v_before from public.crm_leads where phone_e164 = NUMBER;
  if v_before <> 0 then
    raise exception 'THE 271 FIXTURE NUMBER IS ALREADY IN USE — refusing to touch a live row';
  end if;

  -- ── 1 · the webhook's own call, as the webhook's own role ────────────────
  set local role cni_app;
  perform set_config('app.user_id', v_manager::text, true);

  v_msg := app.crm_record_inbound_message(
    NUMBER, 'wamid.selfcheck271.a', 'text', 'Do you sell plots?',
    null, null, null, now(), null, false, v_pid, 'Fixture 271');
  if v_msg is null then
    raise exception 'cni_app COULD NOT RECORD AN INBOUND MESSAGE';
  end if;

  select l.id into v_lead from public.crm_leads l where l.phone_e164 = NUMBER;
  if v_lead is null then
    raise exception 'THE STRANGER DID NOT BECOME A LEAD';
  end if;
  if (select owner_id from public.crm_leads where id = v_lead) is not null then
    raise exception 'THE HOLD FROM 270 IS GONE — a stranger was handed to a salesperson';
  end if;
  if (select inbound_at from public.crm_leads where id = v_lead) is null then
    raise exception 'THE LEAD WAS NOT MARKED AS A WALK-UP, so no screen can tell it apart';
  end if;

  -- ── 2 · the button ───────────────────────────────────────────────────────
  -- ⚠️ THIS IS THE LINE THAT WAS FAILING IN PRODUCTION. Not a permission check
  -- inside the function — the EXECUTE grant in front of it.
  if not app.crm_mark_spam(v_lead, '271 self-check.') then
    raise exception 'crm_mark_spam RETURNED FALSE FOR A LEAD THAT EXISTS';
  end if;
  if not app.crm_unmark_spam(NUMBER) then
    raise exception 'crm_unmark_spam FOUND NOTHING TO UNBLOCK';
  end if;

  reset role;

  -- ── 3 · what it actually did, read WITHOUT the policy in the way ─────────
  -- ⚠️ READ AS THE OWNER, AND THE FIRST DRAFT OF THIS CHECK GOT IT WRONG. Under
  -- `role cni_app` the row had genuinely been archived and the assertion still
  -- failed: `crm_leads`' policy hides archived leads, the scalar subquery
  -- returned no row, and `archived_at` came back NULL — a real fix reported as
  -- a bug. The CALLS must run as cni_app; the EVIDENCE must not.
  if (select archived_at from public.crm_leads where id = v_lead) is null then
    raise exception 'THE LEAD WAS NOT ARCHIVED';
  end if;
  if (select archived_reason from public.crm_leads where id = v_lead)
       is distinct from '271 self-check.' then
    raise exception 'THE REASON WAS NOT RECORDED';
  end if;
  if exists (select 1 from public.crm_blocked_numbers where phone_e164 = NUMBER) then
    raise exception 'UNBLOCKING LEFT THE NUMBER BLOCKED';
  end if;

  -- ── 4 · and public still has nothing ─────────────────────────────────────
  if has_function_privilege('public', 'app.crm_mark_spam(uuid, text)', 'execute') then
    raise exception 'PUBLIC CAN MARK A NUMBER AS SPAM';
  end if;
  if has_function_privilege('public', 'app.crm_record_inbound_message(text, text, text, text, text, text, text, timestamptz, text, boolean, text, text)', 'execute') then
    raise exception 'PUBLIC CAN STILL WRITE INBOUND MESSAGES';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'crm_record_inbound_message'
       and p.pronargs = 10
  ) then
    raise exception 'THE DEAD TEN-ARGUMENT OVERLOAD IS STILL THERE';
  end if;

  -- ── clean up: only the fixture, addressed by its own id ──────────────────
  delete from public.crm_lead_messages where lead_id = v_lead;
  delete from public.crm_lead_assignments where lead_id = v_lead;
  delete from public.crm_lead_activity where lead_id = v_lead;
  delete from public.crm_leads where id = v_lead;
  delete from public.crm_blocked_numbers where phone_e164 = NUMBER;
  if exists (select 1 from public.crm_leads where phone_e164 = NUMBER) then
    raise exception 'THE 271 FIXTURE SURVIVED';
  end if;

  raise notice '271 self-check passed: as cni_app — an inbound message records, the lead is held and marked, spam blocks and unblocks; public can do none of it and the dead overload is gone';
exception
  when others then
    reset role;
    raise;
end $$;
