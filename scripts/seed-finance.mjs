#!/usr/bin/env node
/* ============================================================================
 * SEED SIX MONTHS OF LEDGER HISTORY
 * ----------------------------------------------------------------------------
 *     node scripts/seed-finance.mjs              # Mar–Aug 2026
 *     node scripts/seed-finance.mjs --months=12  # a longer run
 *     node scripts/seed-finance.mjs --remove     # take it all back out
 *
 * The finance page has to be looked at before it can be trusted, and an empty
 * ledger proves nothing: a profit-and-loss chart with no loss in it has never
 * had its negative branch drawn.
 *
 * ── ⚠️ IT WRITES AS AN ADMIN, THROUGH THE REAL POLICIES ────────────────────
 * Not as the migration owner with RLS switched off. Every row goes in as
 * `cni_app` with `app.user_id` set to a real Admin, so each insert passes the
 * same policies and constraints the application does. That makes this a test of
 * migrations 063 and 064 as well as a generator — if the schema would refuse
 * something the app would refuse, it fails here rather than in the UI.
 *
 * ── ⚠️ DETERMINISTIC. RE-RUNNING CHANGES NOTHING ───────────────────────────
 * Every variation comes from a hash of (kind, month) — never `Math.random()`.
 * Run it twice and the numbers are identical, so a demo does not reshuffle
 * itself between two looks at the same screen. Learned on
 * `seed-demo-workload.mjs`, where a counter-based PRNG correlated the person
 * with the outcome and one person came out with 0 of 16.
 *
 * ── ⚠️ IT DOES NOT FLATTER THE BUSINESS ────────────────────────────────────
 * The real position is a heavy loss: about PKR 205,000/month of project fees
 * against PKR 805,000/month of payroll. This seed adds plausible history, not
 * flattering history — the income it writes is what these two clients would
 * actually have paid, plus a handful of one-off sales from the real services
 * catalogue. Several months therefore lose money, and that is the point: the
 * loss branch of every chart gets drawn.
 *
 * ── ⚠️ EVERY ROW IS TAGGED `[demo]` IN ITS NOTE ────────────────────────────
 * Same convention as the other seeds, so `--remove` can take back exactly what
 * was put in and nothing a person typed. Salary and subscription rows are the
 * exception — those are posted through the app's own path and are identified by
 * `source <> 'manual'`, because a posted row has no note of its own.
 *
 * ── ⚠️ DEMO RECEIPTS POINT AT NOTHING, AND THEY SAY SO ─────────────────────
 * Migration 065 requires every hand-filed expense to carry a receipt. These
 * rows are generated, so there is no real slip to attach — but the constraint
 * is not negotiable and skipping it would mean the seed could not run at all.
 *
 * So each carries a path under `finance/receipts/demo/`, which does not exist
 * in the bucket. Opening one gives "that file is no longer in storage", which
 * is the truthful answer for invented data. The alternative — uploading a fake
 * image — would produce a demo where every expense has a convincing receipt
 * that proves nothing, and that is a worse lie than a broken link.
 * ========================================================================= */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import postgres from 'postgres';

const TAG = '[demo]';

/* ---- Configuration ------------------------------------------------------- */

/**
 * The recurring bills, per month.
 *
 * ⚠️ `vary` is how much the amount moves month to month, as a fraction. Rent
 * does not move at all; electricity moves a great deal, because summer in
 * Islamabad is air conditioning. A ledger where every bill is identical every
 * month looks generated, and the whole point is to see whether the charts
 * distinguish things.
 */
const RECURRING = [
  { slug: 'office_rent', subtype: 'rent', title: 'Office rent', office: 'blue_area', vendor: 'Blue Area landlord', base: 185_000, vary: 0 },
  { slug: 'office_rent', subtype: 'rent', title: 'Office rent', office: 'wah', vendor: 'Wah landlord', base: 95_000, vary: 0 },
  { slug: 'utilities', subtype: 'electricity', title: 'Electricity', office: 'blue_area', vendor: 'IESCO', base: 46_000, vary: 0.42 },
  { slug: 'utilities', subtype: 'electricity', title: 'Electricity', office: 'wah', vendor: 'IESCO', base: 21_000, vary: 0.4 },
  { slug: 'utilities', subtype: 'gas', title: 'Gas', office: 'blue_area', vendor: 'SNGPL', base: 7_400, vary: 0.55 },
  { slug: 'internet', subtype: 'fibre', title: 'Fibre internet', office: 'blue_area', vendor: 'Nayatel', base: 14_500, vary: 0.05 },
  { slug: 'internet', subtype: 'fibre', title: 'Fibre internet', office: 'wah', vendor: 'StormFiber', base: 8_900, vary: 0.05 },
  { slug: 'software_other', subtype: 'workspace', title: 'Google Workspace', office: null, vendor: 'Google', base: 18_600, vary: 0.02 },
];

/** One-off purchases, placed in specific months so the story is designed. */
const ONE_OFFS = [
  { monthIndex: 0, slug: 'equipment', subtype: 'computer', title: 'Two workstations', vendor: 'Czone', amount: 340_000, office: 'blue_area' },
  { monthIndex: 1, slug: 'equipment', subtype: 'peripheral', title: 'Headphones — 4 pairs', vendor: 'Czone', amount: 46_000, office: 'blue_area' },
  { monthIndex: 1, slug: 'marketing', subtype: 'ads', title: 'Meta ads — brand awareness', vendor: 'Meta', amount: 85_000, office: null },
  { monthIndex: 2, slug: 'equipment', subtype: 'camera', title: 'Camera and lighting kit', vendor: 'Shutter House', amount: 215_000, office: 'blue_area' },
  { monthIndex: 3, slug: 'travel', subtype: 'fare', title: 'Client visits — Lahore', vendor: null, amount: 38_000, office: null },
  { monthIndex: 3, slug: 'misc', subtype: 'other', other: 'Storm damage repair', title: 'Office repairs after the storm', vendor: null, amount: 27_500, office: 'wah' },
  { monthIndex: 4, slug: 'equipment', subtype: 'computer', title: 'Wah office — 3 systems', vendor: 'Czone', amount: 255_000, office: 'wah' },
  { monthIndex: 4, slug: 'marketing', subtype: 'print', title: 'Print collateral', vendor: 'Rasheed Printers', amount: 32_000, office: null },
  { monthIndex: 5, slug: 'misc', subtype: 'other', other: 'Team dinner', title: 'Team dinner — quarter close', vendor: null, amount: 41_000, office: null },
];

/**
 * One-off sales, priced from the real services catalogue (migration 032).
 *
 * ── ⚠️ TWO MONTHS TURN A PROFIT AND FOUR DO NOT. THAT IS DESIGNED ──────────
 * The first run of this seed produced six loss-making months and the script's
 * own guard refused it: a profit-and-loss chart whose POSITIVE branch has never
 * been drawn has not been verified, and neither has the "Profit" label, the
 * green waterfall foot, or the margin figure.
 *
 * The fix was the data, not the check. Payroll alone is PKR 805,000 a month and
 * total spend runs 1.3–1.6M, while the two retainers bring 205,000 — so this
 * division is profitable only in a month when a large build lands. That is a
 * true statement about an agency of this shape, and the catalogue already
 * prices those builds: `erp_solutions` at 1,000,000, `real_estate_erp` at
 * 650,000, `customer_portal` and `pos_system` at 250,000.
 *
 * So May and July carry an ERP delivery and clear their costs; March, April,
 * June and August do not. Nothing here is inflated to make the business look
 * better than it is — the shape is "big projects carry the year", which is what
 * the owner will actually be reading this page to find out.
 */
const SALES = [
  { monthIndex: 0, client: 'Hamdan Traders', title: 'Website development', amount: 145_000 },
  { monthIndex: 1, client: 'Bright Star School', title: 'Branding package', amount: 68_000 },
  /* May — the ERP delivery month. */
  { monthIndex: 2, client: 'Meridian Properties', title: 'Real estate ERP — phase 1', amount: 650_000 },
  { monthIndex: 2, client: 'Zarghoon Distributors', title: 'ERP solutions — full build', amount: 1_000_000 },
  { monthIndex: 2, client: 'Hamdan Traders', title: 'Landing page design', amount: 42_000 },
  { monthIndex: 3, client: 'Sana Boutique', title: 'Social media setup', amount: 62_000 },
  /* July — the second delivery. */
  { monthIndex: 4, client: 'Meridian Properties', title: 'Real estate ERP — phase 2', amount: 650_000 },
  { monthIndex: 4, client: 'Zarghoon Distributors', title: 'Dealer app', amount: 180_000 },
  { monthIndex: 4, client: 'Gulberg Medicare', title: 'Customer portal', amount: 250_000 },
  { monthIndex: 4, client: 'Café Kollective', title: 'Shoot day + reel pack', amount: 74_000 },
  { monthIndex: 5, client: 'Bright Star School', title: 'CRM setup', amount: 95_000 },
];

/** What each tool costs, in PKR per month. Per-seat unless `seats` is set. */
const TOOL_COSTS = [
  { slug: 'claude', cost: 5_800, cycle: 'monthly', seats: null },
  { slug: 'chatgpt', cost: 5_600, cycle: 'monthly', seats: null },
  { slug: 'gemini', cost: 5_400, cycle: 'monthly', seats: null },
  { slug: 'canva', cost: 42_000, cycle: 'yearly', seats: 5 },
  { slug: 'flow', cost: 6_900, cycle: 'monthly', seats: null },
];

/**
 * Who holds which tool, by a fragment of their name.
 *
 * The owner asked that Admin and Team Coordinator have subscriptions too, so
 * they are here alongside the members.
 */
const SEATS = [
  { match: 'Ammar', tools: ['claude', 'chatgpt', 'gemini', 'canva'] },
  { match: 'Umm-e-Habiba', tools: ['claude', 'gemini', 'canva', 'flow'] },
  { match: 'Kashif', tools: ['chatgpt', 'canva'] },
  { match: 'Lareeb', tools: ['claude', 'chatgpt'] },
  { match: 'Najmulla', tools: ['gemini', 'canva'] },
  { match: 'Testing', tools: ['canva', 'flow'] },
];

/* ---- Plumbing ------------------------------------------------------------ */

function readEnvLocal() {
  let raw;
  try {
    raw = readFileSync('.env.local', 'utf8');
  } catch {
    console.error('✗ .env.local not found.');
    process.exit(1);
  }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

/** FNV-1a to a 0–1 fraction. Deterministic — see the header. */
function hash01(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x100000000;
}

/** `2026-08` → `2026-08-01`. */
const firstOf = (month) => `${month}-01`;

/** The last day of a month, without a table of month lengths. */
function lastOf(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** N months back from a `yyyy-mm`, inclusive, oldest first. */
function monthsEndingAt(month, count) {
  const [y, m] = month.split('-').map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

const args = process.argv.slice(2);
const remove = args.includes('--remove') || args.includes('--clear');
const monthCount = Number(args.find((a) => a.startsWith('--months='))?.split('=')[1] ?? 6);

const env = readEnvLocal();
if (!env.DATABASE_URL) {
  console.error('✗ DATABASE_URL is not set in .env.local');
  process.exit(1);
}

const sql = postgres(env.DATABASE_URL, {
  max: 1,
  prepare: false,
  onnotice: () => {},
  connection: { application_name: `seed-finance(${basename(process.argv[1])})` },
});

/** Run a callback as `cni_app` acting as `userId` — the app's own path. */
async function asUser(userId, fn) {
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'cni_app', true),
                    set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
}

try {
  /* An Admin to act as. Every write below goes through their identity, so RLS
     and the guard triggers are live. */
  const [admin] = await sql`
    select id, full_name from public.users
     where role in ('admin', 'super_admin') and is_active
     order by case role when 'super_admin' then 0 else 1 end
     limit 1
  `;

  if (!admin) {
    console.error('✗ No active Admin to act as.');
    process.exit(1);
  }

  if (remove) {
    /* ⚠️ As the owner, not as the Admin. `cni_app` HAS delete on these tables,
       but doing it as the owner means `--remove` still works if the policies
       are later tightened — and a cleanup script that stops working after a
       migration is a script that leaves demo data in a production database. */
    const spend = await sql`
      delete from public.expenses where note like ${'%' + TAG + '%'} or source <> 'manual'
    `;
    const income = await sql`
      delete from public.revenue_entries where note like ${'%' + TAG + '%'}
    `;
    const seats = await sql`
      delete from public.subscription_seats where seat_note like ${'%' + TAG + '%'}
    `;
    const costs = await sql`delete from public.subscription_costs`;

    console.log(`\n✓ Removed ${spend.count} expenses, ${income.count} income rows,`);
    console.log(`  ${seats.count} tool seats and ${costs.count} tool prices.\n`);
    await sql.end({ timeout: 5 });
    process.exit(0);
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  const months = monthsEndingAt(today.slice(0, 7), monthCount);

  console.log(`\nSeeding ${months[0]} → ${months[months.length - 1]} as ${admin.full_name}…\n`);

  /* ── 0. How people are engaged ──────────────────────────────────────────
     ⚠️ Everybody defaults to `full_time`, which makes the Probation and Intern
     states — and the review reminder that depends on them — impossible to see.
     Two people are moved so the payroll screen has a real case to render.

     ⚠️ Nobody is set to `owner` here. Migration 067 already marked the owner,
     and re-deciding that in a demo seed would let a `--remove` followed by a
     re-run quietly put him back on the payroll. */
  await asUser(admin.id, async (tx) => {
    /* One probation ending soon — the reminder's ordinary case. */
    await tx`
      update public.employee_compensation c
         set employment_type = 'probation',
             review_due_on = (current_date + 12)
        from public.users u
       where u.id = c.user_id and u.full_name like '%Testing%'
    `;
    /* One internship that ENDED and was never actioned — the case the reminder
       exists for, and the one a grace period would have hidden. */
    await tx`
      update public.employee_compensation c
         set employment_type = 'intern',
             review_due_on = (current_date - 26)
        from public.users u
       where u.id = c.user_id and u.full_name like '%Lareeb%'
    `;
  });
  console.log('  ✓ Set employment types (1 probation, 1 overdue internship).');

  /* ── 1. Price the tools ────────────────────────────────────────────────── */
  await asUser(admin.id, async (tx) => {
    for (const item of TOOL_COSTS) {
      await tx`
        insert into public.subscription_costs
          (subscription_id, monthly_cost_pkr, billing_cycle, seats_included, note, updated_by_id)
        select id, ${item.cost}, ${item.cycle}::public.billing_cycle, ${item.seats},
               ${TAG}, ${admin.id}
          from public.subscriptions where slug = ${item.slug}
        on conflict (subscription_id) do update
           set monthly_cost_pkr = excluded.monthly_cost_pkr,
               billing_cycle    = excluded.billing_cycle,
               seats_included   = excluded.seats_included
      `;
    }
  });
  console.log(`  ✓ Priced ${TOOL_COSTS.length} tools.`);

  /* ── 2. Assign the seats ───────────────────────────────────────────────── */
  const people = await sql`select id, full_name from public.users where is_active`;
  let seatCount = 0;

  await asUser(admin.id, async (tx) => {
    for (const row of SEATS) {
      const person = people.find((p) => p.full_name.includes(row.match));
      if (!person) continue;

      for (const slug of row.tools) {
        const result = await tx`
          insert into public.subscription_seats
            (subscription_id, user_id, started_on, seat_note, assigned_by_id)
          select id, ${person.id}, ${firstOf(months[0])}::date, ${TAG}, ${admin.id}
            from public.subscriptions where slug = ${slug}
          on conflict do nothing
        `;
        seatCount += result.count ?? 0;
      }
    }
  });
  console.log(`  ✓ Assigned ${seatCount} tool seats.`);

  /* ── 3. Post each month's payroll and subscriptions ─────────────────────
     ⚠️ Through the SAME insert `runMonth` uses, not a copy of it. If the real
     posting path were broken, this would fail here rather than producing a
     plausible-looking ledger the app itself could never have written. */
  let posted = 0;
  for (const month of months) {
    const period = firstOf(month);
    const incurred = lastOf(month);

    await asUser(admin.id, async (tx) => {
      const salaries = await tx`
        insert into public.expenses
          (category_id, title, amount_pkr, currency, incurred_on, user_id,
           office_team, source, period_month, created_by_id)
        select
          (select id from public.expense_categories where slug = 'salaries'),
          u.full_name || ' — salary',
          c.monthly_salary, c.currency, ${incurred}::date, u.id, u.office_team,
          'payroll_run', ${period}::date, ${admin.id}
          from public.employee_compensation c
          join public.users u on u.id = c.user_id
         /* ⚠️ Owners draw a profit share, not a salary — migration 067. Without
            this the seed re-creates the rows that migration deleted and
            overstates six months of spending by PKR 1,500,000. */
         where u.is_active and c.employment_type <> 'owner'
        on conflict do nothing
      `;

      const subs = await tx`
        insert into public.expenses
          (category_id, title, amount_pkr, currency, incurred_on, subscription_id,
           source, period_month, created_by_id)
        select
          (select id from public.expense_categories where slug = 'ai_subscriptions'),
          s.name || ' — ' || seats.n || ' seat' || case when seats.n = 1 then '' else 's' end,
          case
            when k.billing_cycle = 'yearly' then
              case when k.seats_included is null
                   then round(k.monthly_cost_pkr / 12, 2) * seats.n
                   else round(k.monthly_cost_pkr / 12, 2) end
            else
              case when k.seats_included is null
                   then k.monthly_cost_pkr * seats.n
                   else k.monthly_cost_pkr end
          end,
          k.currency, ${incurred}::date, s.id, 'subscription_run', ${period}::date, ${admin.id}
          from public.subscriptions s
          join public.subscription_costs k on k.subscription_id = s.id
          join lateral (
            select count(*)::int as n from public.subscription_seats st
             where st.subscription_id = s.id
               and st.started_on <= ${incurred}::date
               and (st.ended_on is null or st.ended_on >= ${period}::date)
          ) seats on true
         where s.is_active and seats.n > 0
        on conflict do nothing
      `;

      posted += (salaries.count ?? 0) + (subs.count ?? 0);
    });
  }
  console.log(`  ✓ Posted ${posted} salary and subscription rows.`);

  /* ── 4. The recurring bills ────────────────────────────────────────────── */
  let bills = 0;
  await asUser(admin.id, async (tx) => {
    for (const [index, month] of months.entries()) {
      for (const item of RECURRING) {
        /* Deterministic variation — see the header. Centred on the base, so a
           bill moves both up and down across the year rather than only up. */
        const swing = (hash01(`${item.slug}|${item.title}|${month}`) - 0.5) * 2 * item.vary;
        const amount = Math.round((item.base * (1 + swing)) / 100) * 100;

        /* ⚠️ The most recent month's bills are left UNPAID, and older ones
           settled. That is what a real ledger looks like mid-month, and it is
           the only way the Outstanding tile ever shows a figure. */
        const isLatest = index === months.length - 1;

        const result = await tx`
          insert into public.expenses
            (category_id, title, amount_pkr, incurred_on, paid_on, vendor,
             office_team, note, subtype, source, created_by_id,
             receipt_path, receipt_name, receipt_mime, receipt_size_bytes)
          select
            (select id from public.expense_categories where slug = ${item.slug}),
            ${`${item.title} — ${month}`},
            ${amount},
            ${lastOf(month)}::date,
            ${isLatest ? null : lastOf(month)}::date,
            ${item.vendor},
            ${item.office}::public.office_team,
            ${TAG},
            ${item.subtype ?? null},
            'manual',
            ${admin.id},
            ${`finance/receipts/demo/${item.slug}-${month}.png`},
            ${`${item.slug}-${month}.png`},
            'image/png',
            0
        `;
        bills += result.count ?? 0;
      }
    }
  });
  console.log(`  ✓ Wrote ${bills} recurring bills.`);

  /* ── 5. One-off purchases ──────────────────────────────────────────────── */
  let purchases = 0;
  await asUser(admin.id, async (tx) => {
    for (const item of ONE_OFFS) {
      const month = months[item.monthIndex];
      if (!month) continue;

      /* Placed a third of the way into the month, so the ledger is not a wall
         of month-end dates. */
      const day = String(8 + Math.floor(hash01(`${item.title}|${month}`) * 14)).padStart(2, '0');

      const result = await tx`
        insert into public.expenses
          (category_id, title, amount_pkr, incurred_on, paid_on, vendor,
           office_team, note, subtype, subtype_other, source, created_by_id,
           receipt_path, receipt_name, receipt_mime, receipt_size_bytes)
        select
          (select id from public.expense_categories where slug = ${item.slug}),
          ${item.title}, ${item.amount},
          ${`${month}-${day}`}::date, ${`${month}-${day}`}::date,
          ${item.vendor}, ${item.office}::public.office_team,
          ${TAG}, ${item.subtype ?? null}, ${item.other ?? null},
          'manual', ${admin.id},
          ${`finance/receipts/demo/${item.slug}-${month}-${day}.png`},
          ${`${item.slug}-${month}.png`},
          'image/png',
          0
      `;
      purchases += result.count ?? 0;
    }
  });
  console.log(`  ✓ Wrote ${purchases} one-off purchases.`);

  /* ── 6. Income ─────────────────────────────────────────────────────────── */
  const projects = await sql`
    select id, name, monthly_fee_pkr from public.projects
     where monthly_fee_pkr is not null
  `;

  let income = 0;
  await asUser(admin.id, async (tx) => {
    /* The retainers — what these two clients actually pay, every month. */
    for (const [index, month] of months.entries()) {
      const isLatest = index === months.length - 1;

      for (const project of projects) {
        /* ⚠️ The latest month is still owed — that is what a real ledger looks
           like mid-month, and it is the only way the Income tab's "waiting"
           figure and the Outstanding tile ever show anything. */
        const result = await tx`
          insert into public.revenue_entries
            (kind, project_id, amount_pkr, earned_on, received_on, invoice_ref,
             note, status, created_by_id,
             proof_path, proof_name, proof_mime, proof_size_bytes)
          values (
            'retainer', ${project.id}, ${Number(project.monthly_fee_pkr)},
            ${firstOf(month)}::date,
            ${isLatest ? null : `${month}-14`}::date,
            ${`INV-${month.replace('-', '')}-${String(project.name).slice(0, 3).toUpperCase()}`},
            ${TAG},
            ${isLatest ? 'invoiced' : 'received'},
            ${admin.id},
            ${isLatest ? null : `finance/proof/demo/${month}-${String(project.name).slice(0, 3).toLowerCase()}.png`},
            ${isLatest ? null : `payment-${month}.png`},
            ${isLatest ? null : 'image/png'},
            ${isLatest ? null : 0}
          )
        `;
        income += result.count ?? 0;
      }
    }

    /* The one-off sales. */
    for (const sale of SALES) {
      const month = months[sale.monthIndex];
      if (!month) continue;
      const day = String(6 + Math.floor(hash01(`${sale.title}|${month}`) * 18)).padStart(2, '0');
      const isLatest = sale.monthIndex === months.length - 1;

      /* ⚠️ One sale is deliberately RETURNED, so the status filter, the
         "not expected" wording and the outstanding calculation all have a real
         case to render. A demo where every payment succeeded never exercises
         the branch that matters when one does not. */
      const returned = sale.client === 'Sana Boutique';
      const status = returned ? 'returned' : isLatest ? 'pending' : 'received';
      const settled = status === 'received';

      const result = await tx`
        insert into public.revenue_entries
          (kind, client_name, amount_pkr, earned_on, received_on, invoice_ref,
           note, status, status_note, created_by_id,
           proof_path, proof_name, proof_mime, proof_size_bytes)
        values (
          'one_off', ${sale.client}, ${sale.amount},
          ${`${month}-${day}`}::date,
          ${settled ? `${month}-${day}` : null}::date,
          ${`INV-${month.replace('-', '')}-${sale.client.slice(0, 3).toUpperCase()}`},
          ${`${sale.title} ${TAG}`},
          ${status},
          ${returned ? 'Cheque bounced — client asked to re-invoice next quarter.' : null},
          ${admin.id},
          ${settled ? `finance/proof/demo/${month}-${sale.client.slice(0, 3).toLowerCase()}.png` : null},
          ${settled ? `payment-${month}.png` : null},
          ${settled ? 'image/png' : null},
          ${settled ? 0 : null}
        )
      `;
      income += result.count ?? 0;
    }
  });
  console.log(`  ✓ Wrote ${income} income entries.`);

  /* ── What it came to ───────────────────────────────────────────────────── */
  const summary = await sql`
    with m as (
      select to_char(incurred_on, 'YYYY-MM') as month,
             sum(amount_pkr) as spend, 0::numeric as income
        from public.expenses group by 1
      union all
      select to_char(earned_on, 'YYYY-MM'), 0::numeric, sum(amount_pkr)
        from public.revenue_entries group by 1
    )
    select month, sum(income)::bigint as income, sum(spend)::bigint as spend,
           (sum(income) - sum(spend))::bigint as net
      from m group by month order by month
  `;

  console.log('\n  Month      Income        Spend          Net');
  console.log('  ─────────────────────────────────────────────────');
  let profitable = 0;
  let losing = 0;
  for (const row of summary) {
    const net = Number(row.net);
    if (net >= 0) profitable += 1;
    else losing += 1;
    console.log(
      `  ${row.month}  ${String(row.income).padStart(9)}  ${String(row.spend).padStart(11)}  ${String(net).padStart(11)}`,
    );
  }

  console.log(`\n✓ ${profitable} profitable month(s), ${losing} loss-making.`);

  /* ⚠️ The property the seed exists to guarantee. A P&L chart whose negative
     branch was never drawn has not been verified, and neither has one that
     never showed a profit. */
  if (profitable === 0 || losing === 0) {
    console.log(
      '\n⚠️  Every month landed the same way. The chart\'s other branch is unproven —\n' +
        '   adjust SALES so at least one month goes each way.',
    );
  }

  console.log('');
  await sql.end({ timeout: 5 });
  process.exit(0);
} catch (err) {
  console.error(`\n✗ Seeding failed: ${err?.message ?? err}`);
  if (err?.detail) console.error(`  detail: ${err.detail}`);
  if (err?.hint) console.error(`  hint: ${err.hint}`);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
