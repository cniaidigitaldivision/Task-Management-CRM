-- ============================================================================
-- 149 · `follow_up` LEAVES THE FUNNEL, AND THE ROTA RE-WEIGHTS
-- ----------------------------------------------------------------------------
-- The second half of 148 — separate because `ALTER TYPE … ADD VALUE` needs its
-- transaction to commit before the new labels can be used. Same split as
-- 110/111, 119/120 and 144/145.
--
-- ⚠️ THE ROWS MOVE TO `contacted`, AND THE ACTIVITY LOG IS TOLD.
-- Changing three leads silently would leave three timelines that jump from
-- "stage changed to Follow up" to a lead sitting in Contacted, with nothing in
-- between. The log is what "how did he deal with this client" is answered from;
-- a gap in it is worse than a gap in the stage.
-- ============================================================================

do $$
declare
  v_lead   record;
  n_moved  int := 0;
  v_actor  uuid;
begin
  /* An Admin to own the entries — a null actor already means "the importer did
     it" (112), and this was not the importer. */
  select id into v_actor from public.users
   where role in ('admin','super_admin') and is_active
   order by case role when 'super_admin' then 0 else 1 end
   limit 1;

  for v_lead in
    select id, stage from public.crm_leads where stage = 'follow_up'
  loop
    update public.crm_leads
       set stage = 'contacted'
     where id = v_lead.id;

    /* ⚠️ `detail` is jsonb, and the shape matters: the timeline renderer reads
       `from`/`to` off a stage change, so a bare string would log the event and
       show nothing useful under it. */
    insert into public.crm_lead_activity (lead_id, kind, actor_id, occurred_at, detail)
    values (
      v_lead.id, 'stage_changed', v_actor, now(),
      jsonb_build_object(
        'from', 'follow_up',
        'to',   'contacted',
        'note', 'Follow up retired as a stage — a follow-up is an activity, not a '
                || 'position in the funnel. The next action is unchanged.',
        'migration', 149
      )
    );

    n_moved := n_moved + 1;
  end loop;

  raise notice '149 · % lead(s) moved off follow_up, each with a line in its timeline', n_moved;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- THE ROTA'S STAGE WEIGHTS
-- ----------------------------------------------------------------------------
-- ⚠️ `follow_up` WOULD HAVE FALLEN THROUGH TO 0.0, and that is the bug this
-- half exists to prevent: the `else` arm treats anything unlisted as closed
-- work. Three new stages arrived in 148, so without this a lead awaiting a
-- proposal, holding a live quotation or booked in for a site visit would have
-- counted as NO workload at all — and the rota would have handed its owner more
-- leads precisely because they were busy with the valuable ones.
--
-- The numbers remain a judgement rather than a measurement — there is still not
-- one closed lead to derive them from — and they stay in this one function so
-- they can be corrected in one place when there is.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function app.crm_stage_weight(p_stage public.crm_stage)
returns numeric
language sql
immutable
as $$
  select case p_stage
    when 'new'              then 1.0
    when 'contacted'        then 1.5
    when 'qualified'        then 3.0
    /* Waiting on us to produce something — the most attention-hungry state
       there is, because the client has asked and the clock is running. */
    when 'proposal_pending' then 3.5
    /* Sent, and now owed a chase. */
    when 'quotation_sent'   then 3.0
    /* A booked visit is a commitment in the diary. */
    when 'visit_scheduled'  then 3.0
    when 'visited'          then 2.5
    when 'negotiation'      then 3.0
    /* Retired in 149 and no longer reachable from the application; weighted
       anyway so a hand-written row cannot silently count as nothing. */
    when 'follow_up'        then 2.0
    when 'scheduled'        then 3.0
    else 0.0                      -- won and lost are not open work
  end
$$;

comment on function app.crm_stage_weight(public.crm_stage) is
  'How much attention a lead at this stage costs. A judgement, not a measurement '
  '— correct it here when there are closed leads to learn from. 133, re-weighted '
  'for the new stages in 149.';

-- ============================================================================
-- SELF-CHECK
-- ============================================================================
do $$
declare
  n_left    int;
  n_logged  int;
  w         numeric;
  s         text;
begin
  -- 1 · ⚠️ NOTHING IS LEFT ON THE RETIRED STAGE. The label survives in the type;
  --     what must not survive is a row wearing it, or the desk renders a stage
  --     that `STAGE_ORDER` no longer knows how to label.
  select count(*) into n_left from public.crm_leads where stage = 'follow_up';
  if n_left <> 0 then
    raise exception '149 · % leads are still on follow_up', n_left;
  end if;

  -- 2 · And each move left a trace.
  select count(*) into n_logged from public.crm_lead_activity
   where kind = 'stage_changed' and detail->>'migration' = '149';
  raise notice '149 · % timeline entries written for the move', n_logged;

  -- 3 · ⚠️ EVERY OPEN STAGE CARRIES WEIGHT. This is the check that would have
  --     caught the new stages falling through to 0.0 — the failure that makes
  --     the rota reward being busy.
  foreach s in array array['new','contacted','qualified','proposal_pending',
                           'quotation_sent','visit_scheduled','visited','negotiation']
  loop
    select app.crm_stage_weight(s::public.crm_stage) into w;
    if w is null or w <= 0 then
      raise exception '149 · stage % weighs %, so its leads count as no work', s, w;
    end if;
  end loop;

  -- 4 · ⚠️ AND THE LABELS 148 ADDED ARE ALL HERE. 148 could not check its own
  --     work — reading `enum_range` in the transaction that adds a label is the
  --     same "unsafe use" as writing one. This is the first transaction that can
  --     see them, so it is where the proof belongs.
  if (select count(*) from unnest(enum_range(null::public.crm_stage)) v
       where v::text in ('proposal_pending','quotation_sent','visit_scheduled')) <> 3 then
    raise exception '149 · 148 did not add all three stages';
  end if;
  if (select count(*) from unnest(enum_range(null::public.crm_lead_source)) v
       where v::text in ('facebook','instagram','google','linkedin','referral','walk_in','import')) <> 7 then
    raise exception '149 · 148 did not add all seven sources';
  end if;

  -- 5 · And the two exits still weigh nothing.
  if app.crm_stage_weight('won') <> 0 or app.crm_stage_weight('lost') <> 0 then
    raise exception '149 · a closed lead is being counted as open work';
  end if;

  raise notice '149 · follow_up retired, 8 open stages all weighted, won/lost still zero';
end $$;
