-- ============================================================================
-- 098 · THE REPORT TEMPLATE LIBRARY — owner, 2026-09-04
-- ----------------------------------------------------------------------------
-- The owner's reference for the Reports & Exports tab, in full: *"I want the UI
-- to be exactly the same, beautiful, sleek, and interactive… I'm not talking
-- about the template or the generated file being exactly the same. Right now I'm
-- focusing on the UI."*
--
-- So this migration gives the library the data the drawing needs, and the
-- drawing needs four things 096 did not store.
--
-- ── ⚠️ `sections` IS A SPEC, NOT A DECORATION, AND IT CHANGED MY MIND ───────
-- 096 deliberately had no `sections` column: the composer draws at fixed
-- geometry, so a section list would have been a preference nothing read. The
-- owner has now said the differing layouts come later — which turns the list
-- from a dead preference into the SPECIFICATION for that work, and into three
-- things the page can honestly show today:
--
--   · the drawer's "Sections Included" checklist, per template
--   · the "AI Summary Blocks" figure, which counts the insight-writing sections
--     across every template — the reference's own footnote says "Across all
--     templates", so it is a count of exactly this
--   · which sample thumbnails a template previews
--
-- ⚠️ Every section key below is checked against a whitelist by the self-check.
-- A typo would silently drop a tick off a client-facing checklist.
--
-- ── ⚠️ `formats` LISTS WHAT A TEMPLATE OFFERS, `format` IS WHAT IT WRITES ───
-- The reference shows five format marks. Two have writers. `format` (096) stays
-- the single format the engine actually produces and is what the export runs;
-- `formats` is the row of marks the drawer draws. Keeping them as two columns is
-- what stops "offered" and "produced" from drifting into one another.
-- ============================================================================

alter table public.report_templates
  add column if not exists sections text[] not null default '{}',
  add column if not exists formats  text[] not null default '{pdf}',
  -- A chart-palette token name, so a card's chip colour is data rather than a
  -- hash of its title. The reference's palette runs teal, amber, purple, blue,
  -- green, red, orange across the grid.
  add column if not exists accent   text not null default 'chart-4',
  -- An icon KEY, resolved to a mark by the client. Never a component: a column
  -- cannot hold one, and `lib/domain` may not import React.
  add column if not exists icon     text not null default 'document';

comment on column public.report_templates.sections is
  'Ordered section keys this template''s report contains (098). The drawer''s '
  'checklist, the AI-block count, and the spec for the per-template layouts.';
comment on column public.report_templates.formats is
  'Format marks the drawer offers (098). `format` is what the engine writes.';


-- ════════════════════════════════════════════════════════════════════════════
-- THE TWENTY-FOUR
-- ----------------------------------------------------------------------------
-- ⚠️ EVERY ROW STILL NAMES AN ENGINE THAT RUNS TODAY. That was 096's rule and
-- it has not been relaxed — pressing "Use this template" on any of these
-- produces a real file. What is not yet true is that each produces a DIFFERENT
-- one; the owner has that as later work, and `sections` is its brief.
--
-- The nine from 096 keep their slugs and gain the four new columns. Fifteen
-- more are added, starting with the seven the reference names by title.
-- ════════════════════════════════════════════════════════════════════════════

-- ── The nine that already exist ────────────────────────────────────────────
update public.report_templates set
  sections = '{masthead,top-line-metrics,published-posts,who-did-what,platform-distribution,key-insights,notes}',
  formats  = '{pdf,csv}',
  accent   = 'chart-1',
  icon     = 'calendar-day'
 where slug = 'daily-snapshot';

update public.report_templates set
  sections = '{masthead,top-line-metrics,published-posts,who-did-what,platform-distribution,notes}',
  formats  = '{pdf,csv}',
  accent   = 'chart-6',
  icon     = 'history'
 where slug = 'yesterday-wrap';

update public.report_templates set
  sections = '{masthead,top-line-metrics,performance-overview,channel-breakdown,who-did-what,key-insights,trends-comparisons,notes}',
  formats  = '{pdf,csv,pptx}',
  accent   = 'chart-3',
  icon     = 'chart'
 where slug = 'weekly-performance';

update public.report_templates set
  sections = '{masthead,top-line-metrics,performance-overview,channel-breakdown,delivery-vs-promise,key-insights,recommendations,notes}',
  formats  = '{pdf,xlsx,pptx,csv,gslides}',
  accent   = 'chart-5',
  icon     = 'client'
 where slug = 'monthly-client-report';

update public.report_templates set
  sections = '{masthead,top-line-metrics,performance-overview,trends-comparisons,channel-breakdown,executive-narrative,recommendations}',
  formats  = '{pdf,pptx,gslides}',
  accent   = 'chart-2',
  icon     = 'signature'
 where slug = 'annual-review';

update public.report_templates set
  sections = '{task-columns}', formats = '{csv,xlsx}', accent = 'chart-4', icon = 'table'
 where slug = 'task-export';

update public.report_templates set
  sections = '{workload-columns}', formats = '{csv,xlsx}', accent = 'chart-7', icon = 'people'
 where slug = 'workload-export';

update public.report_templates set
  sections = '{metric-columns}', formats = '{csv,xlsx}', accent = 'chart-8', icon = 'pulse'
 where slug = 'meta-metrics-export';

update public.report_templates set
  sections = '{post-columns}', formats = '{csv,xlsx}', accent = 'chart-2', icon = 'image'
 where slug = 'meta-posts-export';


-- ── Fifteen more, the reference's seven first ──────────────────────────────
insert into public.report_templates
  (slug, name, description, category, engine, kind, format, is_builtin,
   sections, formats, accent, icon) values

  ('executive-summary',
   'Executive Summary',
   'High-level overview of performance across all key metrics and channels. Perfect for stakeholders who need a quick summary.',
   'executive', 'project_report', 'month', 'pdf', true,
   '{performance-overview,top-line-metrics,channel-breakdown,key-insights,top-campaigns,trends-comparisons,recommendations}',
   '{pdf,xlsx,pptx,csv,gslides}', 'chart-3', 'document'),

  ('weekly-snapshot',
   'Weekly Snapshot',
   'Quick weekly performance snapshot with key highlights and insights.',
   'performance', 'project_report', 'week', 'pdf', true,
   '{top-line-metrics,performance-overview,published-posts,key-insights,best-times}',
   '{pdf,pptx,csv}', 'chart-6', 'calendar-day'),

  ('campaign-performance',
   'Campaign Performance',
   'Deep dive into campaign performance, trends and optimization insights.',
   'performance', 'project_report', 'month', 'pdf', true,
   '{performance-overview,top-campaigns,engagement-rate,trends-comparisons,key-insights,recommendations}',
   '{pdf,xlsx,pptx,csv}', 'chart-1', 'chart'),

  ('audience-insights',
   'Audience Insights',
   'Detailed audience demographics, interests and behavior insights.',
   'audience', 'meta_metrics_csv', null, 'csv', true,
   '{audience-mix,follower-growth,top-locations,best-times,key-insights}',
   '{csv,xlsx,pdf}', 'chart-3', 'people'),

  ('account-health',
   'Account Health',
   'Overview of account health, policy status and recommendations.',
   'delivery', 'project_report', 'month', 'pdf', true,
   '{account-health,sync-status,delivery-vs-promise,recommendations}',
   '{pdf,csv}', 'chart-2', 'shield'),

  ('board-presentation',
   'Board Presentation',
   'Board-ready presentation with key metrics and strategic insights.',
   'executive', 'project_report', 'month', 'pdf', true,
   '{executive-narrative,top-line-metrics,performance-overview,trends-comparisons,recommendations}',
   '{pdf,pptx,gslides}', 'chart-6', 'presentation'),

  ('quarterly-review',
   'Quarterly Review',
   'Three months side by side, with the direction of travel on every headline figure.',
   'executive', 'project_report', 'year', 'pdf', true,
   '{executive-narrative,trends-comparisons,performance-overview,channel-breakdown,recommendations}',
   '{pdf,pptx,gslides}', 'chart-5', 'signature'),

  ('content-mix',
   'Content Mix Breakdown',
   'What was published and in what shape — statics, reels, carousels and stories, by share and by reach.',
   'content', 'meta_posts_csv', null, 'csv', true,
   '{content-mix,channel-breakdown,top-posts,key-insights}',
   '{csv,xlsx,pdf}', 'chart-2', 'image'),

  ('reels-performance',
   'Reels Performance',
   'Reels against everything else: views, reach and interactions, with the multiple stated plainly.',
   'content', 'meta_posts_csv', null, 'csv', true,
   '{content-mix,engagement-rate,top-posts,trends-comparisons}',
   '{csv,xlsx,pdf}', 'chart-8', 'play'),

  ('top-posts',
   'Top Performing Posts',
   'Every collected post ranked by reach and by engagement, each with its live permalink.',
   'content', 'meta_posts_csv', null, 'csv', true,
   '{top-posts,engagement-rate,channel-breakdown}',
   '{csv,xlsx,pdf}', 'chart-1', 'trophy'),

  ('engagement-deep-dive',
   'Engagement Deep Dive',
   'Engagement rate day by day, against reach and against the previous period.',
   'performance', 'meta_metrics_csv', null, 'csv', true,
   '{engagement-rate,performance-overview,trends-comparisons,key-insights}',
   '{csv,xlsx,pdf}', 'chart-4', 'pulse'),

  ('follower-growth',
   'Follower Growth',
   'The follower series per account, with the platform difference in how it is collected made explicit.',
   'audience', 'meta_metrics_csv', null, 'csv', true,
   '{follower-growth,trends-comparisons,channel-breakdown}',
   '{csv,xlsx,pdf}', 'chart-3', 'growth'),

  ('platform-comparison',
   'Platform Comparison',
   'Facebook beside Instagram on every metric both platforms actually report.',
   'audience', 'meta_metrics_csv', null, 'csv', true,
   '{channel-breakdown,performance-overview,engagement-rate,follower-growth}',
   '{csv,xlsx,pdf}', 'chart-7', 'compare'),

  ('posting-cadence',
   'Posting Cadence Review',
   'Whether the agreed rhythm was met, day by day, with the days that were missed named.',
   'delivery', 'project_report', 'month', 'pdf', true,
   '{delivery-vs-promise,best-times,who-did-what,notes}',
   '{pdf,csv,xlsx}', 'chart-6', 'calendar-day'),

  ('delivery-vs-promise',
   'Delivery vs Promise',
   'Assets and reels delivered against what the contract says, for the month and for the year to date.',
   'delivery', 'project_report', 'month', 'pdf', true,
   '{delivery-vs-promise,top-line-metrics,who-did-what,recommendations,notes}',
   '{pdf,xlsx,csv}', 'chart-5', 'target')

on conflict (slug) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ TOUCHES NO LIVE ROW, and runs its policy assertions as `cni_app` — a
-- migration executes as the schema owner and bypasses RLS entirely, which is
-- how 094's self-check came to pass while proving nothing.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin  uuid;
  n        integer;
  bad      text;
  ai_count integer;
  -- ⚠️ THE WHITELIST. A section key is rendered as a tick on a client-facing
  -- checklist, so a typo does not fail loudly — it silently drops a line. Every
  -- key in every template must appear here.
  known    text[] := array[
    'masthead','top-line-metrics','performance-overview','channel-breakdown',
    'published-posts','who-did-what','platform-distribution','notes',
    'key-insights','recommendations','executive-narrative',
    'trends-comparisons','top-campaigns','top-posts','content-mix',
    'engagement-rate','follower-growth','audience-mix','top-locations',
    'best-times','delivery-vs-promise','account-health','sync-status',
    'task-columns','workload-columns','metric-columns','post-columns'
  ];
  -- ⚠️ NOT NAMED `formats`. A PL/pgSQL variable sharing a name with a column
  -- of a table in the same query is ambiguous, and postgres refuses rather
  -- than guessing — which is the right call and cost one failed apply.
  ok_formats text[] := array['pdf','csv','xlsx','pptx','gslides'];
begin
  select id into v_admin from public.users
   where role in ('super_admin','admin') and is_active limit 1;

  -- 1 · The library is the size the reference draws.
  select count(*) into n from public.report_templates where is_builtin;
  if n <> 24 then
    raise exception '098 · the library holds % built-in templates; the reference draws 24', n;
  end if;

  -- 2 · Every engine is one the application implements. 096's rule, restated
  --     because fifteen new rows are the moment it would have been broken.
  select count(*) into n from public.report_templates
   where engine not in ('project_report','tasks_csv','workload_csv','meta_metrics_csv','meta_posts_csv');
  if n > 0 then
    raise exception '098 · % template(s) name an engine nothing implements', n;
  end if;

  -- 3 · Every section key is known. ⚠️ The assertion that stops a typo becoming
  --     a missing line on a client's checklist.
  select string_agg(distinct s, ', ') into bad
    from public.report_templates t, unnest(t.sections) as s
   where not (s = any(known));
  if bad is not null then
    raise exception '098 · unknown section key(s): %', bad;
  end if;

  -- 4 · Every template has at least one section, or its drawer is empty.
  select count(*) into n from public.report_templates where cardinality(sections) = 0;
  if n > 0 then
    raise exception '098 · % template(s) list no sections; their drawer would be blank', n;
  end if;

  -- 5 · Every offered format is one the drawer can draw a mark for.
  select string_agg(distinct f, ', ') into bad
    from public.report_templates t, unnest(t.formats) as f
   where not (f = any(ok_formats));
  if bad is not null then
    raise exception '098 · unknown format(s): %', bad;
  end if;

  -- 6 · ⚠️ A TEMPLATE MUST OFFER THE FORMAT IT ACTUALLY WRITES. Otherwise the
  --     drawer's marks and the button underneath them disagree.
  select count(*) into n from public.report_templates where not (format = any(formats));
  if n > 0 then
    raise exception '098 · % template(s) do not offer the format their engine writes', n;
  end if;

  -- 7 · The accent is a real palette token, so a chip cannot paint with an
  --     undefined variable — which is exactly how the Sync Health icon came to
  --     be invisible.
  select count(*) into n from public.report_templates
   where accent not in ('chart-1','chart-2','chart-3','chart-4','chart-5','chart-6','chart-7','chart-8');
  if n > 0 then
    raise exception '098 · % template(s) carry an accent that is not a chart token', n;
  end if;

  -- 8 · The AI-block figure is a real count, and worth printing so the number on
  --     the card is traceable to this migration.
  select count(*) into ai_count
    from public.report_templates t, unnest(t.sections) as s
   where s in ('key-insights','recommendations','executive-narrative');
  raise notice '098 · 24 templates; % insight-writing section blocks across them', ai_count;

  -- ── Under the application's own role ─────────────────────────────────────
  if v_admin is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_admin::text, true);

    select count(*) into n from public.report_templates;
    if n <> 24 then
      raise exception '098 · the app role sees % templates, not 24 — RLS is hiding rows', n;
    end if;

    -- The new rows are built-ins and stay immutable, like the first nine.
    update public.report_templates set name = '098 renamed' where slug = 'executive-summary';
    if found then
      raise exception '098 · a built-in template was renamed through RLS';
    end if;

    reset role;
  end if;

  raise notice '098 · the report template library is in place';
end $$;
