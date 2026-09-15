/* ============================================================================
 * THE DEMO CATALOGUE — the owner's two plots and two quotations
 * ----------------------------------------------------------------------------
 * Seeds `docs/crm/13-PROPERTY-AND-QUOTATION-TESTPACK.md` exactly.
 * Run AFTER `seed-desk-showcase.mjs`, which creates the leads these attach to.
 *
 *     node scripts/seed-catalogue.mjs
 *
 * ── ⚠️ THE DEMO PROJECT ONLY, AND IT REFUSES OTHERWISE ─────────────────────
 * Every row carries `is_test_data = true` and lives on the project whose name
 * ends `[demo]`. Chitral's 632 real leads are never touched.
 *
 * ── ⚠️ AND THE PAYMENT PLAN IS COMPUTED, NOT TYPED ─────────────────────────
 * The owner's pack lists both plans in full, and both reconcile exactly. Typing
 * the figures in would mean a second copy that can drift from the percentages
 * beside it; deriving them from the price proves the arithmetic on every run —
 * and the script REFUSES if a stage lands on a fraction of a rupee, because a
 * payment plan that needs rounding is one that gets argued about.
 * ========================================================================= */
import fs from 'node:fs';
import postgres from 'postgres';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|(.*?))\s*$/);
  if (m) env[m[1]] = m[2] ?? m[3] ?? (m[4] || '').replace(/\s+#.*$/, '').trim();
}
const sql = postgres(env.DATABASE_URL, { prepare: false, ssl: 'require', connect_timeout: 20 });

const MARLA_SQFT = 225;

/** The owner's plan shape: 20 / 10 / 50-over-N / 10 / 10. */
function planFor(price, instalments) {
  const stages = [
    { label: 'Booking', pct: 20, instalments: null },
    { label: 'Confirmation, within 30 days', pct: 10, instalments: null },
    { label: `${instalments} monthly instalments`, pct: 50, instalments },
    { label: 'Balloting', pct: 10, instalments: null },
    { label: 'Possession', pct: 10, instalments: null },
  ];

  return stages.map((s, i) => {
    const amount = (price * s.pct) / 100;
    if (!Number.isInteger(amount)) {
      throw new Error(`${s.label}: ${amount} is not a whole rupee — refusing to round.`);
    }
    if (s.instalments) {
      const each = amount / s.instalments;
      if (!Number.isInteger(each)) {
        throw new Error(
          `${s.label}: ${amount} / ${s.instalments} = ${each} is not a whole rupee — refusing to round.`,
        );
      }
    }
    return { ...s, amount, sort: i + 1 };
  });
}

const PROPERTIES = [
  {
    code: 'PROP-A101', plot: 'A-101', block: 'A', marla: 5,
    dimensions: '25 × 45 ft', price: 4_500_000, instalments: 18,
    facing: 'North', road: 30, possession: 18,
  },
  {
    code: 'PROP-B201', plot: 'B-201', block: 'B', marla: 10,
    dimensions: '30 × 75 ft', price: 8_200_000, instalments: 20,
    facing: 'East', road: 40, possession: 24,
  },
];

const run = async () => {
  const [project] = await sql`
    select id, name from public.projects where name like '%[demo]' limit 1`;
  if (!project) {
    console.error('No [demo] project. Refusing to seed a catalogue anywhere else.');
    process.exit(1);
  }

  /* ⚠️ THE STANDARD GOES ON THE PROJECT, not into the script's arithmetic. */
  await sql`
    update public.projects
       set marla_sqft_standard = ${MARLA_SQFT}, has_catalogue = true
     where id = ${project.id}`;

  const [sarah] = await sql`select id, full_name from public.users where full_name = 'Sarah' limit 1`;
  const [manager] = await sql`
    select u.id, u.full_name from public.users u
      join public.departments d on d.id = u.department_id
     where d.key = 'sales' and u.department_role = 'manager' and u.is_active limit 1`;

  if (!sarah || !manager) {
    console.error('Need Sarah and a sales manager. Refusing — 151 forbids self-approval.');
    process.exit(1);
  }

  console.log(`project  : ${project.name}`);
  console.log(`marla    : ${MARLA_SQFT} sq ft`);
  console.log(`prepared : ${sarah.full_name}   approved by: ${manager.full_name}\n`);

  /* Clear only this script's own rows. Quotations first — payment stages cascade
     from them, and a property cannot go while a quotation points at it. */
  await sql`delete from public.crm_quotations
             where project_id = ${project.id} and is_test_data
               and number in ('QT-1042','QT-1043')`;
  await sql`delete from public.crm_properties
             where project_id = ${project.id} and is_test_data
               and code in ('PROP-A101','PROP-B201')`;

  const ids = {};
  for (const p of PROPERTIES) {
    const area = p.marla * MARLA_SQFT;
    const [row] = await sql`
      insert into public.crm_properties
        (project_id, code, plot_number, block, kind, size_marla, area_sqft, dimensions,
         category, facing, road_width_ft, base_price, status, development_status,
         possession_months, price_updated_at, is_test_data)
      values (${project.id}, ${p.code}, ${p.plot}, ${p.block}, 'Residential plot',
              ${p.marla}, ${area}, ${p.dimensions}, 'Standard', ${p.facing}, ${p.road},
              ${p.price}, 'available', 'Under development', ${p.possession}, now(), true)
      returning id`;
    ids[p.code] = row.id;

    const plan = planFor(p.price, p.instalments);
    for (const s of plan) {
      await sql`
        insert into public.crm_payment_stages
          (property_id, sort_order, label, percentage, amount, instalments)
        values (${row.id}, ${s.sort}, ${s.label}, ${s.pct}, ${s.amount}, ${s.instalments})`;
    }
    const total = plan.reduce((n, s) => n + s.amount, 0);
    if (total !== p.price) throw new Error(`${p.code}: plan totals ${total}, price is ${p.price}`);

    console.log(`  ${p.code}  ${p.marla} Marla · ${area} sq ft · PKR ${p.price.toLocaleString('en-PK')}  ✓ plan reconciles`);
  }

  /* ── The two quotations ──────────────────────────────────────────────── */
  const lead = async (name) => {
    const [r] = await sql`
      select id from public.crm_leads
       where project_id = ${project.id} and full_name = ${name} limit 1`;
    return r?.id ?? null;
  };

  const faisal = await lead('Faisal Rehman');
  const hina = await lead('Hina Shahzad');
  if (!faisal || !hina) {
    console.error('\nRun scripts/seed-desk-showcase.mjs first — the leads are missing.');
    process.exit(1);
  }

  /* QT-1042 — approved. ⚠️ Approved BY THE MANAGER: 151 refuses self-approval. */
  const [q1] = await sql`
    insert into public.crm_quotations
      (lead_id, project_id, property_id, number, version, base_price, net_amount,
       valid_until, status, prepared_by_id, approved_by_id, approved_at, is_test_data)
    values (${faisal}, ${project.id}, ${ids['PROP-A101']}, 'QT-1042', 1,
            4500000, 4500000, date '2026-09-30', 'approved',
            ${sarah.id}, ${manager.id}, now(), true)
    returning id`;
  for (const s of planFor(4_500_000, 18)) {
    await sql`
      insert into public.crm_payment_stages
        (quotation_id, sort_order, label, percentage, amount, instalments)
      values (${q1.id}, ${s.sort}, ${s.label}, ${s.pct}, ${s.amount}, ${s.instalments})`;
  }
  await sql`update public.crm_leads
               set property_id = ${ids['PROP-A101']}, stage = 'quotation_sent', budget = 4500000
             where id = ${faisal}`;

  /* QT-1043 — pending. ⚠️ NO approver and NO approved_discount: the discount is
     REQUESTED, and 151's constraint refuses an "approved" row with neither. */
  const [q2] = await sql`
    insert into public.crm_quotations
      (lead_id, project_id, property_id, number, version, base_price, net_amount,
       requested_discount, approved_discount, valid_until, status,
       prepared_by_id, approval_note, is_test_data)
    values (${hina}, ${project.id}, ${ids['PROP-B201']}, 'QT-1043', 1,
            8200000, 8200000, 200000, 0, date '2026-09-30', 'pending_approval',
            ${sarah.id}, 'Client requested a special discount', true)
    returning id`;
  for (const s of planFor(8_200_000, 20)) {
    await sql`
      insert into public.crm_payment_stages
        (quotation_id, sort_order, label, percentage, amount, instalments)
      values (${q2.id}, ${s.sort}, ${s.label}, ${s.pct}, ${s.amount}, ${s.instalments})`;
  }
  await sql`update public.crm_leads
               set property_id = ${ids['PROP-B201']}, stage = 'proposal_pending', budget = 8000000
             where id = ${hina}`;

  console.log(`\n  QT-1042  Faisal Rehman   PKR 4,500,000   approved by ${manager.full_name}`);
  console.log(`  QT-1043  Hina Shahzad    PKR 8,200,000   pending · 200,000 discount requested`);

  /* ⚠️ And prove the discount would recompute cleanly, without applying it —
     the approval flow will do that, and this only checks it CAN. */
  try {
    planFor(8_000_000, 20);
    console.log('  → after a 200,000 approval the plan recomputes to whole rupees ✓');
  } catch (e) {
    console.log(`  → ⚠️ ${e.message}`);
  }

  console.log(`\nDone, on ${project.name}. Every row is_test_data = true.`);
  await sql.end();
};

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
