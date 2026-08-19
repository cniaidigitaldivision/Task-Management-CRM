-- =============================================================================
-- 032 · THE AGENCY CATALOGUE — packages, services, platforms, clients
-- -----------------------------------------------------------------------------
-- Owner set out the real business model on 2026-08-19 and supplied the source
-- documents. Analysis and decisions: docs/PROJECTS-REDESIGN.md.
--
-- CNI sells eight monthly growth packages (SPARK → ENTERPRISE) and fifteen
-- services, to clients who are either inside the Attari Group umbrella or
-- outside it. A package fixes how many platforms are managed and how many
-- content assets are published a month; that target is what every report is
-- measured against.
--
-- ── ⚠️ WHY THIS IS A TABLE AND NOT AN ENUM ───────────────────────────────────
-- The obvious shape is `create type package as enum ('spark', 'starter', …)`.
-- It is wrong here. An agency's offering changes — a package gets renamed, a new
-- tier appears between two others, an asset count moves. An enum change is a
-- migration and a deploy; a row is an afternoon in the admin screen. The owner
-- was explicit about wanting to manage this themselves.
--
-- The same reasoning applies to platforms and clients. `channel: "Instagram +
-- YouTube"` as free text in a JSONB blob is exactly what is being replaced, and
-- replacing it with a hardcoded enum would only move the problem.
--
-- ── ⚠️ THIS MIGRATION ADDS NOTHING TO `projects` ──────────────────────────────
-- Deliberately. It creates the catalogue and seeds it, and nothing reads it yet,
-- so it cannot break a screen. Wiring projects to it is 033, which is reviewable
-- on its own.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · Platforms
-- -----------------------------------------------------------------------------
-- A row per social platform, because the whole point is being able to ask "how
-- many projects include Instagram" and get a number.

create table if not exists public.platforms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null,
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint platforms_name_present check (length(btrim(name)) > 0),
  constraint platforms_slug_shape   check (slug ~ '^[a-z0-9_]+$')
);

create unique index if not exists platforms_slug_key on public.platforms (slug);

comment on table public.platforms is
  'Social platforms the division manages. A table rather than an enum so the '
  'list can change without a deploy (owner, 2026-08-19).';


-- -----------------------------------------------------------------------------
-- 2 · Packages
-- -----------------------------------------------------------------------------
-- Seeded from page 3 of CNI_AI_Digital_Packages_2026_Final_Expanded.pdf, the
-- "Package Comparison & Add-Ons" matrix. That page is the authority because it
-- states all eight in ONE table and therefore cannot disagree with itself — the
-- rate card and the per-package booklet do disagree, on pricing and subtitles.

create table if not exists public.packages (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text not null,
  tagline           text,
  sort_order        integer not null,

  /* NULL where the document says "750,000+" rather than a figure. `fee_is_from`
     records that the number is a floor, so a screen can print "from PKR …"
     instead of stating a price the agency has not committed to. */
  monthly_fee_pkr   numeric(12, 2),
  fee_is_from       boolean not null default false,

  /* NULL for Multi-location / Multi-market / Custom, which name an arrangement
     rather than a count. NOT 0 — zero platforms is a different claim entirely. */
  platform_count    integer,

  /* ⚠️ The range is real and both ends matter. The MINIMUM is the promise
     (owner's decision): 14 published against "14–16" means the target is met and
     15–16 is bonus. `assets_max` NULL means "up to N" has no floor, or the
     package is described in words rather than numbers. */
  assets_min        integer,
  assets_max        integer,

  /* Only SPARK prints a reel number ("2 reels / short videos included"). The
     rest are NULL and the owner fills them in — see §13/§14 of the analysis. */
  reels_min         integer,

  includes_website  boolean not null default false,
  website_note      text,
  includes_crm      boolean not null default false,
  crm_note          text,

  automation_note   text,
  reporting_cadence text,
  free_benefit      text,
  best_for          text,

  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint packages_name_present check (length(btrim(name)) > 0),
  constraint packages_slug_shape   check (slug ~ '^[a-z0-9_]+$'),

  /* A range that runs backwards is a typo, and it would make every report on
     that package nonsense. Refused at the door. */
  constraint packages_assets_ordered check (
    assets_min is null or assets_max is null or assets_min <= assets_max
  ),
  constraint packages_counts_sane check (
    (assets_min is null or assets_min >= 0)
    and (assets_max is null or assets_max >= 0)
    and (reels_min  is null or reels_min  >= 0)
    and (platform_count is null or platform_count > 0)
  ),
  /* Reels live INSIDE the asset total (owner's decision), so a package promising
     more reels than assets is incoherent. */
  constraint packages_reels_fit check (
    reels_min is null or assets_max is null or reels_min <= assets_max
  )
);

create unique index if not exists packages_slug_key on public.packages (slug);
create index if not exists packages_order_idx on public.packages (sort_order);

comment on table public.packages is
  'The eight growth packages. Supplies DEFAULTS for a new project; the agreed '
  'targets are then copied onto the project itself, so editing a package never '
  'rewrites what an existing client was promised. See PROJECTS-REDESIGN.md §13.';
comment on column public.packages.assets_min is
  'The promise. A project meeting assets_min has met its target; anything up to '
  'assets_max is bonus (owner, 2026-08-19).';


-- Which platforms a package includes by default. Only the lower tiers name
-- theirs; GROWTH upward give a count and the platforms are chosen per project.
create table if not exists public.package_platforms (
  package_id  uuid not null references public.packages (id)  on delete cascade,
  platform_id uuid not null references public.platforms (id) on delete cascade,
  primary key (package_id, platform_id)
);


-- -----------------------------------------------------------------------------
-- 3 · Services and add-ons
-- -----------------------------------------------------------------------------
-- The fifteen from the service card, plus the eight add-ons from page 3. One
-- table with a `category`, because they behave identically — a name, a price,
-- and a project may buy either.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'service_unit') then
    create type public.service_unit as enum ('monthly', 'per_project', 'on_demand');
  end if;
  if not exists (select 1 from pg_type where typname = 'service_category') then
    create type public.service_category as enum ('service', 'add_on');
  end if;
end
$$;

create table if not exists public.services (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null,
  category      public.service_category not null default 'service',
  unit          public.service_unit not null default 'per_project',
  price_pkr     numeric(12, 2),
  price_is_from boolean not null default false,
  notes         text,
  sort_order    integer not null default 100,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint services_name_present check (length(btrim(name)) > 0),
  constraint services_slug_shape   check (slug ~ '^[a-z0-9_]+$'),
  constraint services_price_sane   check (price_pkr is null or price_pkr >= 0)
);

create unique index if not exists services_slug_key on public.services (slug);


-- -----------------------------------------------------------------------------
-- 4 · Clients
-- -----------------------------------------------------------------------------
-- ⚠️ NO COMPANY LIST IS HARDCODED. Owner, 2026-08-19: *"I will add all of the
-- project by myself, by putting in a proper internal or external. You just
-- organize all of the form."* So this table ships EMPTY and they populate it.
--
-- It exists rather than a free-text `client_name` for one reason: free text
-- cannot be grouped. "AGC Interior" and "AGC interior" are two clients to a
-- report and one client to a human, and the entire purpose of this work is
-- reporting.

create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  is_internal boolean not null,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint clients_name_present check (length(btrim(name)) > 0)
);

create unique index if not exists clients_name_key on public.clients (lower(name));

comment on column public.clients.is_internal is
  'True for a company inside the Attari Group umbrella, false for a paying '
  'outside client. Set by the owner per client — no list is hardcoded.';


-- -----------------------------------------------------------------------------
-- 5 · RLS
-- -----------------------------------------------------------------------------
-- The catalogue is READ by everybody signed in — the package dropdown has to
-- render for whoever creates a project — and WRITTEN by Admin+, because it is
-- the company's commercial offering.

alter table public.platforms         enable row level security;
alter table public.packages          enable row level security;
alter table public.package_platforms enable row level security;
alter table public.services          enable row level security;
alter table public.clients           enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['platforms','packages','package_platforms','services','clients']
  loop
    if not exists (select 1 from pg_policy where polname = t || '_select') then
      execute format(
        'create policy %I on public.%I for select to cni_app using (app.current_user_id() is not null)',
        t || '_select', t);
    end if;

    if not exists (select 1 from pg_policy where polname = t || '_write') then
      execute format(
        'create policy %I on public.%I for all to cni_app '
        'using (app.acting_at_least(''admin''::public.user_role)) '
        'with check (app.acting_at_least(''admin''::public.user_role))',
        t || '_write', t);
    end if;

    execute format('grant select, insert, update, delete on public.%I to cni_app', t);
    execute format('revoke all on public.%I from anon, authenticated', t);

    /* package_platforms is a pure join table with no updated_at. */
    if t <> 'package_platforms' then
      execute format('drop trigger if exists %I on public.%I', t || '_touch_updated_at', t);
      execute format(
        'create trigger %I before update on public.%I '
        'for each row execute function app.touch_updated_at()',
        t || '_touch_updated_at', t);
    end if;
  end loop;
end
$$;


-- -----------------------------------------------------------------------------
-- 6 · SEED — platforms
-- -----------------------------------------------------------------------------
-- `on conflict do nothing` throughout: this migration must be re-runnable, and
-- re-running it must never overwrite a name the owner has since edited.

insert into public.platforms (slug, name, sort_order) values
  ('facebook',        'Facebook',        10),
  ('instagram',       'Instagram',       20),
  ('tiktok',          'TikTok',          30),
  ('youtube',         'YouTube',         40),
  ('linkedin',        'LinkedIn',        50),
  ('whatsapp',        'WhatsApp',        60),
  ('google_business', 'Google Business', 70),
  ('x',               'X (Twitter)',     80),
  ('threads',         'Threads',         90),
  ('pinterest',       'Pinterest',      100),
  ('snapchat',        'Snapchat',       110)
on conflict (slug) do nothing;


-- -----------------------------------------------------------------------------
-- 7 · SEED — the eight packages
-- -----------------------------------------------------------------------------

insert into public.packages (
  slug, name, tagline, sort_order, monthly_fee_pkr, fee_is_from, platform_count,
  assets_min, assets_max, reels_min,
  includes_website, website_note, includes_crm, crm_note,
  automation_note, reporting_cadence, free_benefit, best_for
) values
  ('spark', 'SPARK', 'Starter Presence Package', 1, 50000, false, 2,
   14, 16, 2,
   false, 'No website',                         false, 'No CRM',
   'Basic WhatsApp auto-reply', 'Monthly', 'Visibility Consultation',
   'First professional presence'),

  ('starter', 'STARTER', 'Active Local Business Package', 2, 85000, false, 3,
   22, 25, null,
   true,  '1 conversion landing page',
   /* The booklet is explicit: "CRM begins from the next package level". So
      "Basic lead tracking" is NOT a CRM, and the flag says so. */
   false, 'Basic lead tracking — CRM begins at GROWTH',
   'Automated follow-up sequence', 'Bi-weekly', 'Growth Guidance Session',
   'Active local businesses'),

  ('growth', 'GROWTH', 'Consistent Growth Package', 3, 125000, false, 4,
   30, 32, null,
   true, '1 landing page + optimisation',       true,  'Light CRM',
   'WhatsApp follow-up', 'Weekly + dashboard', 'Performance Audit',
   'Consistent growth'),

  ('momentum', 'MOMENTUM', 'Stronger Engagement Package', 4, 175000, false, 5,
   /* A single figure, not a range: min and max are both 40. */
   40, 40, null,
   true, '5-page basic website',                true,  'Intermediate CRM',
   '1 CRM automation + AI-UGC + AEO/GEO', 'Advanced dashboard',
   'Annual Expo Promotion Opportunity', 'Stronger engagement'),

  ('performance', 'PERFORMANCE', 'Lead Generation Package', 5, 250000, false, 5,
   /* "Up to 75" is a ceiling with no floor, so assets_min is NULL. */
   null, 75, null,
   true, '10-page corporate website',           true,  'Advanced CRM',
   'AI Sales Agent', 'Executive dashboard', 'Executive Growth Workshop',
   'Lead generation'),

  ('scale', 'SCALE', 'Scaling Brands Package', 6, 350000, false, null,
   null, 120, null,
   true, 'Advanced website / redesign',         true,  'Advanced CRM + BI',
   'AI Voice Agent', 'BI dashboard', 'Brand Authority Film',
   'Scaling brands'),

  ('platinum', 'PLATINUM', 'Full Digital Growth System', 7, 500000, false, null,
   /* "High-volume" is a description, not a number. Both NULL rather than a
      guess — an invented target would be measured against in a board report. */
   null, null, null,
   true, 'Custom portal / internal tool',       true,  'ERP / CRM integration',
   'Professional videography + multilingual', 'Board-level',
   'Leadership Brand Film', 'Full digital growth'),

  ('enterprise', 'ENTERPRISE', 'Dedicated Growth Department', 8, 750000, true, null,
   null, null, null,
   true, 'Full SaaS / custom software',         true,  'Custom CRM',
   'Executive videography + governance', 'Custom executive',
   'Executive Brand Documentary', 'Multi-brand / enterprise')
on conflict (slug) do nothing;


-- The two packages whose platforms the documents actually name.
insert into public.package_platforms (package_id, platform_id)
select p.id, pl.id
  from public.packages p
  join public.platforms pl on pl.slug = any (
    case p.slug
      when 'spark'   then array['facebook','instagram']
      when 'starter' then array['facebook','instagram','tiktok']
      else array[]::text[]
    end
  )
on conflict do nothing;


-- -----------------------------------------------------------------------------
-- 8 · SEED — services, then add-ons
-- -----------------------------------------------------------------------------

insert into public.services (slug, name, category, unit, price_pkr, price_is_from, sort_order) values
  ('crm_solutions',        'CRM Solutions',                    'service', 'monthly',      150000, false,  1),
  ('whatsapp_api',         'WhatsApp API Automation',          'service', 'monthly',      125000, false,  2),
  ('website_development',  'Website Development',              'service', 'per_project',   75000, true,   3),
  ('seo_ai_visibility',    'SEO & AI Visibility',              'service', 'monthly',       60000, false,  4),
  ('social_setup',         'Automatic Social Media Setup',     'service', 'per_project',   55000, true,   5),
  ('dealer_app',           'Dealer App',                       'service', 'per_project',  180000, false,  6),
  ('customer_portal',      'Customer Portal',                  'service', 'per_project',  250000, false,  7),
  ('executive_portal',     'Executive Portal',                 'service', 'per_project',  180000, false,  8),
  ('app_development',      'App Development',                  'service', 'per_project',  120000, true,   9),
  ('real_estate_erp',      'Real Estate ERP',                  'service', 'per_project',  650000, false, 10),
  ('erp_solutions',        'ERP Solutions',                    'service', 'per_project', 1000000, false, 11),
  ('pos_system',           'POS System',                       'service', 'per_project',  250000, false, 12),
  ('custom_software',      'Custom Software',                  'service', 'on_demand',      null, false, 13),
  ('branding',             'Branding',                         'service', 'per_project',    3500, true,  14),
  ('printing',             'Printing',                         'service', 'per_project',    9000, true,  15),

  ('extra_reel_pack',      'Extra Reel Pack',                  'add_on',  'per_project',   25000, true,  20),
  ('shoot_day',            'Shoot Day / On-Site Production',   'add_on',  'per_project',   40000, true,  21),
  ('landing_page_design',  'Landing Page Design',              'add_on',  'per_project',   35000, true,  22),
  ('crm_setup',            'CRM Setup',                        'add_on',  'per_project',   60000, true,  23),
  ('whatsapp_automation',  'WhatsApp Automation Setup',        'add_on',  'per_project',   75000, true,  24),
  ('ad_creative_pack',     'Meta / Google Ad Creative Pack',   'add_on',  'per_project',   30000, true,  25),
  ('brand_mini_refresh',   'Brand Identity Mini Refresh',      'add_on',  'per_project',   50000, true,  26),
  ('website_revamp',       'Website Design / Revamp',          'add_on',  'on_demand',      null, false, 27)
on conflict (slug) do nothing;


-- -----------------------------------------------------------------------------
-- 9 · SELF-CHECK
-- -----------------------------------------------------------------------------

do $$
declare
  n int;
  v_member uuid;
begin
  select count(*) into n from public.packages;
  if n < 8 then raise exception '032 · expected 8 packages, found %', n; end if;

  select count(*) into n from public.services where category = 'service';
  if n < 15 then raise exception '032 · expected 15 services, found %', n; end if;

  select count(*) into n from public.services where category = 'add_on';
  if n < 8 then raise exception '032 · expected 8 add-ons, found %', n; end if;

  select count(*) into n from public.platforms;
  if n < 11 then raise exception '032 · expected 11 platforms, found %', n; end if;

  -- SPARK is the one package whose numbers the PDF states completely.
  select count(*) into n from public.packages
   where slug = 'spark' and assets_min = 14 and assets_max = 16
     and reels_min = 2 and platform_count = 2
     and includes_website = false and includes_crm = false;
  if n <> 1 then raise exception '032 · SPARK was not seeded as the document states it'; end if;

  -- ...and its two named platforms came across.
  select count(*) into n
    from public.package_platforms pp
    join public.packages p  on p.id = pp.package_id
    join public.platforms pl on pl.id = pp.platform_id
   where p.slug = 'spark';
  if n <> 2 then raise exception '032 · SPARK should have 2 named platforms, has %', n; end if;

  -- A backwards range must be impossible.
  begin
    insert into public.packages (slug, name, sort_order, assets_min, assets_max)
    values ('__bad_range__', 'Bad', 99, 30, 10);
    raise exception '032 · a backwards asset range was accepted';
  exception when check_violation then null;
  end;

  -- Reels cannot exceed the assets they sit inside.
  begin
    insert into public.packages (slug, name, sort_order, assets_min, assets_max, reels_min)
    values ('__bad_reels__', 'Bad', 99, 10, 12, 20);
    raise exception '032 · reels_min exceeding assets_max was accepted';
  exception when check_violation then null;
  end;

  -- ── The catalogue must be READABLE by an ordinary member, or no Member can
  --    ever see which package their project is on.
  select id into v_member from public.users where role = 'member' and is_active limit 1;
  if v_member is not null then
    set local role cni_app;
    perform set_config('app.user_id', v_member::text, true);

    select count(*) into n from public.packages;
    if n < 8 then raise exception '032 · a member cannot read the packages'; end if;

    -- ...but must not be able to change the company's offering.
    begin
      update public.packages set monthly_fee_pkr = 1 where slug = 'spark';
      if found then raise exception '032 · A MEMBER EDITED THE PRICE LIST'; end if;
    exception when insufficient_privilege then null;
    end;

    reset role;
  end if;

  raise notice '032 · catalogue seeded: 8 packages, 15 services, 8 add-ons, 11 platforms';
end
$$;
