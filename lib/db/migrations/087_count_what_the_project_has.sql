-- ============================================================================
-- 087 · COUNT WHAT THE PROJECT HAS, NOT WHAT YOU CAN SEE
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-03, describing the tracker's core rule:
--
--   *"you will put a tracker that will just check whether a one static post task
--   today is created or not related to this project… If someone of the project
--   of the team members who is working in that project is created a static post
--   at that day… then that will be log. No other static post task will be
--   created for that project on a same day by any other member of that
--   project."*
--
-- And for reels: *"if someone… is trying to create a third reel task. It would
-- not let them create and give them a message or a error that the target of a
-- week is achieved."*
--
-- ── ⚠️ WHY THIS CANNOT BE AN ORDINARY QUERY ─────────────────────────────────
-- The rule is that ONE person's static post settles the day for the WHOLE
-- project. Migration 084 (hours old) narrowed sight so a Member no longer sees a
-- colleague's task at all. So a count run through the caller's own eyes would
-- return ZERO for a day somebody else had already covered — the cap would never
-- fire, two people would raise the same post, and the tracker would report a
-- project as owing work it already had.
--
-- That is the exact failure 083's first draft had: RLS answering a question
-- honestly and the answer being useless because the question was scoped to the
-- wrong person.
--
-- ── ⚠️ WHAT IT DELIBERATELY CANNOT RETURN ───────────────────────────────────
-- Counts and NAMES. No task id, no title, no reference, no status, no dates.
-- So it cannot become a way to read a colleague's work — the most it discloses
-- is "Abdul Moiz raised today's static post for this project", which is exactly
-- what the refusal message has to say to be useful, and which the person is
-- about to be told anyway.
--
-- Gated on `app.project_is_visible`, so it discloses nothing about a project the
-- caller has no business seeing. That check is CONSULTED, not bypassed: this is
-- SECURITY DEFINER only to widen which TASK ROWS are counted, never to widen
-- which projects can be asked about.
--
-- ── ⚠️ CANCELLED WORK DOES NOT COVER A DAY ──────────────────────────────────
-- A static post raised and then cancelled did not happen, so the day is still
-- owed and somebody must be able to raise another. `done` DOES count — the work
-- was delivered, which is the whole point of the target.
-- ============================================================================

create or replace function app.count_project_content(
  p_project   uuid,
  p_day       date,
  p_week_from date,
  p_week_to   date
)
returns table (
  static_on_day    integer,
  reels_in_week    integer,
  static_raised_by text[],
  reels_raised_by  text[]
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    coalesce(count(*) filter (
      where t.content_kind = 'static' and t.due_date = p_day
    ), 0)::integer,

    coalesce(count(*) filter (
      where t.content_kind = 'reel' and t.due_date between p_week_from and p_week_to
    ), 0)::integer,

    -- ⚠️ `array_remove(..., null)` because a task may have no assignee and no
    -- readable creator name; a null inside the array would print as an empty
    -- gap in the refusal sentence.
    coalesce(array_remove(array_agg(distinct u.full_name) filter (
      where t.content_kind = 'static' and t.due_date = p_day
    ), null), '{}')::text[],

    coalesce(array_remove(array_agg(distinct u.full_name) filter (
      where t.content_kind = 'reel' and t.due_date between p_week_from and p_week_to
    ), null), '{}')::text[]

  from public.tasks t
  left join public.users u on u.id = coalesce(t.assignee_id, t.created_by_id)
  where t.project_id = p_project
    and not t.is_deleted
    -- See the header: cancelled work leaves the day still owed.
    and t.status <> 'cancelled'
    and t.content_kind in ('static', 'reel')
    -- ⚠️ Consulted, not circumvented. Widening which task rows are counted must
    -- not widen which projects may be asked about.
    and app.project_is_visible(p_project)
$$;

comment on function app.count_project_content(uuid, date, date, date) is
  'Static posts on a day and reels in a week for one project, counted across EVERY member''s work rather than the caller''s own. SECURITY DEFINER because migration 084 stops a Member seeing a colleague''s task, which would make the per-project cap never fire. Returns counts and names only — no ids, titles or dates — and is gated on app.project_is_visible.';

revoke all on function app.count_project_content(uuid, date, date, date) from public;
grant execute on function app.count_project_content(uuid, date, date, date) to cni_app;

-- ── SELF-CHECK ──────────────────────────────────────────────────────────────
do $$
declare
  v_member  uuid;
  v_project uuid;
  v_day     date;
  v_seen    integer;
  v_direct  integer;
  v_outside uuid;
begin
  -- A project with a content task on some day, and a member of that project who
  -- did NOT raise it. That is the shape the cap depends on.
  select t.project_id, t.due_date into v_project, v_day
    from public.tasks t
   where t.content_kind in ('static', 'reel')
     and t.due_date is not null
     and not t.is_deleted
     and t.status <> 'cancelled'
   limit 1;

  if v_project is null then
    raise notice '087: no content task to count; assertions skipped';
    return;
  end if;

  select m.user_id into v_member
    from public.project_members m
    join public.users u on u.id = m.user_id and u.role = 'member'
   where m.project_id = v_project
     and not exists (
       select 1 from public.tasks t
        where t.project_id = v_project and t.due_date = v_day
          and t.content_kind in ('static', 'reel')
          and (t.created_by_id = m.user_id or t.assignee_id = m.user_id)
     )
   limit 1;

  if v_member is null then
    raise notice '087: no uninvolved member on that project; the key assertion is skipped';
  else
    perform set_config('app.user_id', v_member::text, true);

    -- ⚠️ THE ASSERTION THIS FUNCTION EXISTS FOR. Counted through the member's own
    -- eyes this is 0, because 084 hides a colleague's task. Through the function
    -- it must be the project's real figure.
    select (static_on_day + reels_in_week) into v_seen
      from app.count_project_content(v_project, v_day, v_day, v_day);

    select count(*) into v_direct from public.tasks t
     where t.project_id = v_project and t.due_date = v_day
       and t.content_kind in ('static', 'reel')
       and not t.is_deleted and t.status <> 'cancelled';

    if v_seen <> v_direct then
      raise exception '087: a member counts % of the project''s % content tasks — the cap would not fire',
        v_seen, v_direct;
    end if;
  end if;

  -- Somebody on no project at all must learn nothing about it.
  select u.id into v_outside from public.users u
   where u.role = 'member' and u.is_active
     and not exists (select 1 from public.project_members m
                      where m.user_id = u.id and m.project_id = v_project)
   limit 1;

  if v_outside is not null then
    perform set_config('app.user_id', v_outside::text, true);
    select (static_on_day + reels_in_week) into v_seen
      from app.count_project_content(v_project, v_day, v_day, v_day);
    if v_seen <> 0 then
      raise exception '087: somebody not on the project counted % of its tasks', v_seen;
    end if;
  end if;

  -- And an unidentified session learns nothing.
  perform set_config('app.user_id', '', true);
  select (static_on_day + reels_in_week) into v_seen
    from app.count_project_content(v_project, v_day, v_day, v_day);
  if v_seen <> 0 then
    raise exception '087: an unidentified session counted % tasks', v_seen;
  end if;

  raise notice '087: the project''s own count is visible to its members, and to nobody else';
end $$;
