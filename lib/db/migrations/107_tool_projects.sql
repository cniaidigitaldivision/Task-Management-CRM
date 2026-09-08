-- ============================================================================
-- 107 · TOOL PROJECTS — the column, the three that exist, and the proof
-- ----------------------------------------------------------------------------
-- The second half of 106. That file could only add the enum labels; anything
-- that USES `'tool'` had to wait for its transaction to commit. See its header.
--
-- Owner, 2026-09-08:
--
--   *"Also mention internal and external. For example maybe I will be creating
--   this for some client but the social media posting is not included in that
--   because that's a tool… on the studio page, in the dropdown, these projects
--   will not be shown because these are tools. They have no social media
--   accounts so there is no means of trend and engagement."*
--
-- ── ⚠️ `tool_audience` IS NULLABLE, AND NULL IS THE RIGHT ANSWER FOR EVERY
--    PROJECT THAT IS NOT A TOOL ────────────────────────────────────────────
-- A client project is neither internal nor external in this sense — the word
-- only means something once the project IS a product. Defaulting every existing
-- row to 'external' would put a fact on eighteen projects that nobody asserted,
-- and a report grouping by it would then be quietly wrong. The CHECK below
-- enforces the pairing in both directions.
-- ============================================================================

alter table public.projects
  add column if not exists tool_audience text;

comment on column public.projects.tool_audience is
  'internal | external, and only for type = tool (107). Whether the product is '
  'ours or built for a client. Null for every other kind of project.';

/* ⚠️ BOTH DIRECTIONS, DELIBERATELY. "A tool must say which" is the obvious
   half; "nothing else may" is the half that stops the column drifting into a
   general-purpose flag on client projects, which is how a column ends up
   meaning two things.

   ⚠️ AND `tool_audience is not null` IS LOAD-BEARING, NOT BELT AND BRACES.
   **A CHECK constraint passes when its expression evaluates to NULL** — SQL
   requires it to be provably false before it rejects a row. Two versions of
   this constraint were written and applied before that mattered enough to
   notice:

       (type = 'tool' and tool_audience in ('internal','external'))
       or (type <> 'tool' and tool_audience is null)

   For a tool with a null audience that is `NULL or false` → NULL → accepted.
   Wrapping the same test in a `case` changed nothing, because the branch itself
   is `null in (…)` → NULL. Only the explicit null test produces a real `false`,
   which `and` then short-circuits.

   The self-check at the foot of this file caught both attempts. It is the
   reason the constraint is correct rather than merely present. */
alter table public.projects
  drop constraint if exists projects_tool_audience_pairing;

alter table public.projects
  add constraint projects_tool_audience_pairing check (
    case
      when type = 'tool'
        then tool_audience is not null and tool_audience in ('internal', 'external')
      else tool_audience is null
    end
  );


-- ════════════════════════════════════════════════════════════════════════════
-- THE THREE THAT ALREADY EXIST
-- ----------------------------------------------------------------------------
-- Owner, naming them from the list: *"15, 17, 18 yes exactly"* — Internal CRM,
-- Social Media Automation Tool, WhatsApp Business API Automation.
--
-- ⚠️ BY NAME, AND ONLY IF THEY STILL LOOK LIKE TOOLS. Matching on name alone
-- would move a future client project that happens to share one. The extra
-- conditions — currently `other`, and carrying no linked social account — are
-- what make this safe to run twice and safe to run late.
-- ════════════════════════════════════════════════════════════════════════════
update public.projects p
   set type = 'tool',
       /* All three are ours. A tool built FOR a client is marked external when
          it is created; none of these is. */
       tool_audience = 'internal'
 where p.name in (
         'Internal CRM',
         'Social Media Automation Tool',
         'WhatsApp Business API Automation'
       )
   and p.type = 'other'
   and not exists (
         select 1 from public.meta_accounts a
          where a.project_id = p.id and a.is_active
       );


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ The Studio's exclusion is enforced in the QUERY, not in a policy — see
-- `listStudioProjects`. So what this file can prove is the shape the query
-- relies on: that the three are tools, that a tool cannot exist without saying
-- which kind it is, and that nothing else can claim to be internal or external.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  n        integer;
  v_client uuid;
begin
  -- 1 · The three moved, and nothing else did.
  select count(*) into n from public.projects where type = 'tool';
  if n <> 3 then
    raise exception '107 · expected 3 tool projects, found %', n;
  end if;

  select count(*) into n
    from public.projects
   where type = 'tool' and tool_audience is distinct from 'internal';
  if n > 0 then
    raise exception '107 · % tool project(s) have no audience', n;
  end if;

  -- 2 · ⚠️ NO TOOL CARRIES A SOCIAL ACCOUNT. The Studio drops tools from its
  --     dropdown; if one ever had a linked account, that account would still be
  --     synced by the cron and its figures would become unreachable rather than
  --     absent — data collected and shown nowhere.
  select count(*) into n
    from public.meta_accounts a
    join public.projects p on p.id = a.project_id
   where p.type = 'tool' and a.is_active;
  if n > 0 then
    raise exception '107 · % social account(s) are linked to a tool project', n;
  end if;

  -- 3 · A tool without an audience is refused.
  begin
    insert into public.projects (name, type, code, status, owner_id, created_by_id)
    select '107 self-check', 'tool', 'OTH', 'active', u.id, u.id
      from public.users u where u.role = 'super_admin' limit 1;
    raise exception '107 · a tool project was accepted with no audience';
  exception when check_violation then
    null;
  end;

  -- 4 · And a client project may not claim one.
  select id into v_client from public.projects where type = 'client' limit 1;
  if v_client is not null then
    begin
      update public.projects set tool_audience = 'internal' where id = v_client;
      raise exception '107 · a client project was allowed an audience';
    exception when check_violation then
      null;
    end;
  end if;

  raise notice '107 · 3 tool projects, each internal, none carrying a social account';
end $$;
