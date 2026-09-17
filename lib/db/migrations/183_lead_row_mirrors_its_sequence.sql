-- ============================================================================
-- 183 · THE LEAD ROW SAYS WHAT ITS SEQUENCE IS ACTUALLY DOING
-- ----------------------------------------------------------------------------
-- `crm_leads` carries a copy of the sequence's state — `sequence_state`,
-- `sequence_step`, `sequence_total`, `sequence_note` — so the desk can print
-- "Sequence paused" on a row without joining a second table for every lead.
--
-- ⚠️⚠️ NOTHING KEPT THE COPY TRUE. No trigger wrote it; the engine (170) updates
-- `crm_lead_sequences` and never touches `crm_leads`. Measured 2026-09-17 on the
-- demo lead: the row said `scheduled`, the sequence was `paused` because the
-- client replied. And the drawer's new Pause / Reschedule / Stop could not have
-- fixed it from the app: `cni_app` may update only `next_action`,
-- `next_action_at` and `next_action_type` on `crm_leads` — correctly, since a
-- salesperson editing the mirror by hand is how the two drift apart for good.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
-- One trigger on `crm_lead_sequences`, after any insert, update or delete, sets
-- the lead's copy from its live run — or its most recent one when none is live.
-- The engine, the drawer and anything written later all go through it, so there
-- is exactly one place the copy is written. Then every existing lead is
-- backfilled, and the migration refuses to commit if a single row still
-- disagrees with its sequence.
-- ============================================================================

create or replace function app.crm_mirror_lead_sequence(p_lead uuid)
returns void
language sql
security definer
set search_path = public, app, pg_temp
as $$
  update public.crm_leads l
     set sequence_state = coalesce(cur.state, 'not_started'::public.crm_sequence_state),
         sequence_step  = cur.current_step,
         sequence_total = cur.total_steps,
         sequence_note  = cur.pause_reason
    from (select 1) one
    left join lateral (
      select ls.state, ls.current_step::smallint as current_step,
             ls.total_steps::smallint as total_steps, ls.pause_reason
        from public.crm_lead_sequences ls
       where ls.lead_id = p_lead
       order by (ls.state in ('scheduled', 'active', 'paused')) desc, ls.started_at desc
       limit 1
    ) cur on true
   where l.id = p_lead
     /* ⚠️ ONLY WHEN SOMETHING CHANGED, so the engine's every-15-minutes pass does
        not rewrite leads whose sequence it merely looked at. */
     and (l.sequence_state is distinct from coalesce(cur.state, 'not_started'::public.crm_sequence_state)
          or l.sequence_step  is distinct from cur.current_step
          or l.sequence_total is distinct from cur.total_steps
          or l.sequence_note  is distinct from cur.pause_reason)
$$;

create or replace function app.crm_lead_sequences_mirror()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $fn$
begin
  if tg_op = 'DELETE' then
    perform app.crm_mirror_lead_sequence(old.lead_id);
    return old;
  end if;
  perform app.crm_mirror_lead_sequence(new.lead_id);
  if tg_op = 'UPDATE' and old.lead_id is distinct from new.lead_id then
    perform app.crm_mirror_lead_sequence(old.lead_id);
  end if;
  return new;
end;
$fn$;

drop trigger if exists crm_lead_sequences_mirror on public.crm_lead_sequences;
create trigger crm_lead_sequences_mirror
  after insert or update or delete on public.crm_lead_sequences
  for each row execute function app.crm_lead_sequences_mirror();

revoke all on function app.crm_mirror_lead_sequence(uuid) from public;

-- ── Backfill ────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select distinct lead_id from public.crm_lead_sequences loop
    perform app.crm_mirror_lead_sequence(r.lead_id);
  end loop;
end $$;

-- ============================================================================
-- SELF-CHECK — fixtures rolled back; the verdict survives
-- ============================================================================
do $$
declare
  v_lead uuid;
  v_seq  uuid;
  v_ls   uuid;
  s1 text; s2 text; n2 text; s3 text;
  v_bad  int;
begin
  -- 1 · Nothing disagrees after the backfill.
  select count(*) into v_bad
    from public.crm_leads l
    join lateral (
      select ls.state, ls.current_step, ls.total_steps, ls.pause_reason
        from public.crm_lead_sequences ls
       where ls.lead_id = l.id
       order by (ls.state in ('scheduled', 'active', 'paused')) desc, ls.started_at desc
       limit 1
    ) cur on true
   where l.sequence_state is distinct from cur.state
      or l.sequence_step is distinct from cur.current_step
      or l.sequence_note is distinct from cur.pause_reason;
  if v_bad <> 0 then
    raise exception '183 · % lead row(s) still disagree with their sequence', v_bad;
  end if;

  -- 2 · The trigger follows every change, on a lead with no sequence of its own.
  select l.id into v_lead
    from public.crm_leads l
   where l.is_test_data
     and not exists (select 1 from public.crm_lead_sequences ls where ls.lead_id = l.id)
   limit 1;
  if v_lead is null then
    raise exception '183 · no test lead without a sequence to check against — refusing to skip';
  end if;

  begin
    insert into public.crm_sequences (name, purpose, is_test_data)
    values ('183 self-check', 'no_response', true) returning id into v_seq;
    insert into public.crm_lead_sequences (lead_id, sequence_id, state, total_steps)
    values (v_lead, v_seq, 'scheduled', 3) returning id into v_ls;
    select sequence_state::text into s1 from public.crm_leads where id = v_lead;

    update public.crm_lead_sequences
       set state = 'paused', paused_at = now(), pause_reason = '183 paused', current_step = 1
     where id = v_ls;
    select sequence_state::text, sequence_note into s2, n2 from public.crm_leads where id = v_lead;

    delete from public.crm_lead_sequences where id = v_ls;
    select sequence_state::text into s3 from public.crm_leads where id = v_lead;

    raise exception using errcode = 'P0183', message = '183 rollback';
  exception when sqlstate 'P0183' then
    null;
  end;

  if s1 is distinct from 'scheduled' then raise exception '183 · insert not mirrored (got %)', s1; end if;
  if s2 is distinct from 'paused' or n2 is distinct from '183 paused' then
    raise exception '183 · pause not mirrored (got % / %)', s2, n2;
  end if;
  if s3 is distinct from 'not_started' then raise exception '183 · delete not mirrored (got %)', s3; end if;
  if exists (select 1 from public.crm_sequences where name = '183 self-check') then
    raise exception '183 · the self-check left its fixtures behind';
  end if;

  raise notice '183 · every lead row matches its sequence; insert, pause and delete are mirrored';
end $$;
