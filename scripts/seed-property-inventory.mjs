/* ============================================================================
 * THE DEMO PROPERTY INVENTORY — 148 plots, so the Properties page has a scheme
 * ----------------------------------------------------------------------------
 *     node scripts/seed-property-inventory.mjs
 *     node scripts/seed-property-inventory.mjs --remove
 *
 * Owner, 2026-09-27: *"add some dummy data over here so I can see, by putting
 * the data over there, what the search will look like."*
 *
 * ── ⚠️ A [demo] SCHEME, NOT CHITRAL ────────────────────────────────────────
 * The reference image says "Chitral Royal Homes", and that project is a REAL
 * CLIENT with 683 real leads. Putting 148 invented plots into it would hand
 * their sales team an inventory that does not exist.
 *
 * So this creates **Chitral Royal Homes [demo]** — option (c) of
 * `13-PROPERTY-AND-QUOTATION-TESTPACK.md` §1, which the pack already
 * recommended: it reads as the reference intends and every existing safeguard
 * that keys off `[demo]` keeps working. Every row carries `is_test_data`.
 *
 * ── ⚠️ THE FIVE FROM THE REFERENCE ARE EXACT ───────────────────────────────
 * PROP-A101, A102, B201, C301 and B401 carry the sizes, dimensions, prices,
 * statuses and dates drawn in the owner's image, so the page can be compared
 * with it row by row. The other 143 are generated around them.
 *
 * ── ⚠️ AREA IS COMPUTED FROM THE PROJECT'S STANDARD, AND CHECKED ───────────
 * Not from a constant in this file. The script reads `marla_sqft_standard` back
 * out of `crm_project_settings` and refuses if a plot's dimensions disagree with
 * marla × standard — the same discipline as the payment plan below.
 *
 * ── ⚠️ AND NOTHING MESSAGES ANYBODY ────────────────────────────────────────
 * The six demo leads are written with `app.crm_quiet_insert = 'on'`,
 * `whatsapp_consent = false` and numbers in the unallocated `+92 300 000 00NN`
 * range. The script COUNTS queued sends afterwards and fails if the count is
 * not zero, rather than claiming it is safe.
 * ========================================================================= */
import fs from 'node:fs';
import postgres from 'postgres';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|(.*?))\s*$/);
  if (m) env[m[1]] = m[2] ?? m[3] ?? (m[4] || '').replace(/\s+#.*$/, '').trim();
}
const sql = postgres(env.DATABASE_URL, { prepare: false, ssl: 'require', connect_timeout: 20 });

const PROJECT_NAME = 'Chitral Royal Homes [demo]';
/* ⚠️ Exactly three capitals — projects_code_format. */
const PROJECT_CODE = 'CRD';
const CITY = 'Islamabad';
const remove = process.argv.includes('--remove');

/* ── the shapes a plot comes in ──────────────────────────────────────────── */
const SHAPES = [
  { label: '5 Marla', marla: 5, dims: '25 × 45 ft', kind: 'Residential plot' },
  { label: '10 Marla', marla: 10, dims: '30 × 75 ft', kind: 'Residential plot' },
  { label: '1 Kanal', marla: 20, dims: '50 × 90 ft', kind: 'Residential plot' },
  { label: '2 Kanal', marla: 40, dims: '75 × 120 ft', kind: 'Residential plot' },
  { label: '8 Marla', marla: 8, dims: '30 × 60 ft', kind: 'Commercial plot' },
];
const FACINGS = ['North facing', 'South facing', 'East facing', 'West facing'];
const ROADS = [30, 40, 60, 80];
const CATEGORIES = [
  { label: 'Standard', corner: false, park: false, boulevard: false, premiumPct: 0 },
  { label: 'Corner', corner: true, park: false, boulevard: false, premiumPct: 10 },
  { label: 'Park facing', corner: false, park: true, boulevard: false, premiumPct: 8 },
  { label: 'Boulevard', corner: false, park: false, boulevard: true, premiumPct: 15 },
];
const DEV = ['Developed', 'Under development', 'Balloted'];

/* The owner's plan shape, 20 / 10 / 50-over-N / 10 / 10. Whole rupees or it
   refuses — a payment plan that needs rounding is one that gets argued about. */
function planFor(price) {
  for (const n of [18, 20, 24, 30, 36, 40, 48, 60]) {
    const half = (price * 50) / 100;
    if (!Number.isInteger(half) || !Number.isInteger(half / n)) continue;
    const stages = [
      { label: 'Booking', pct: 20, instalments: null },
      { label: 'Confirmation, within 30 days', pct: 10, instalments: null },
      { label: `${n} monthly instalments`, pct: 50, instalments: n },
      { label: 'Balloting', pct: 10, instalments: null },
      { label: 'Possession', pct: 10, instalments: null },
    ];
    const built = stages.map((s, i) => ({ ...s, amount: (price * s.pct) / 100, sort: i + 1 }));
    if (built.every((s) => Number.isInteger(s.amount))) return built;
  }
  throw new Error(`No whole-rupee payment plan exists for PKR ${price} — refusing to round.`);
}

/* ── the five drawn in the reference, exactly ────────────────────────────── */
const REFERENCE = [
  { code: 'PROP-A101', plot: 'A-101', block: 'A', shape: 0, price: 4_500_000, status: 'available', updated: '2026-09-21', facing: 'North facing', road: 30, cat: 0, dev: 1 },
  { code: 'PROP-A102', plot: 'A-102', block: 'A', shape: 0, price: 4_650_000, status: 'reserved',  updated: '2026-09-20', facing: 'East facing',  road: 30, cat: 1, dev: 1 },
  { code: 'PROP-B201', plot: 'B-201', block: 'B', shape: 1, price: 8_200_000, status: 'available', updated: '2026-09-19', facing: 'North facing', road: 40, cat: 0, dev: 1 },
  { code: 'PROP-C301', plot: 'C-301', block: 'C', shape: 1, price: 8_500_000, status: 'sold',      updated: '2026-09-18', facing: 'South facing', road: 40, cat: 2, dev: 0 },
  { code: 'PROP-B401', plot: 'B-401', block: 'B', shape: 2, price: 12_500_000, status: 'on_hold',  updated: '2026-09-17', facing: 'West facing',  road: 60, cat: 3, dev: 1 },
];

/* Available 82 · Reserved 21 · Sold 38 · On hold 4 · Blocked 3 = 148, which is
   the split drawn on the reference's five cards. */
const TARGET = { available: 82, reserved: 21, sold: 38, on_hold: 4, blocked: 3 };

function* statusRoll() {
  const left = { ...TARGET };
  for (const r of REFERENCE) left[r.status] -= 1;
  const bag = [];
  for (const [status, n] of Object.entries(left)) for (let i = 0; i < n; i += 1) bag.push(status);
  /* Deterministic shuffle so two runs produce the same scheme. */
  let seed = 148;
  for (let i = bag.length - 1; i > 0; i -= 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  yield* bag;
}

async function main() {
  const [admin] = await sql`select id, full_name from public.users
    where is_active and role in ('admin','super_admin') order by created_at limit 1`;
  if (!admin) throw new Error('No admin to own the demo project.');

  /* The real Chitral project decides which department sees the demo one, so the
     same salespeople see both — otherwise the page is empty for Sarah. */
  const [real] = await sql`select lead_department_id from public.projects
    where name = 'Chitral Royal Homes' limit 1`;

  if (remove) {
    const [p] = await sql`select id from public.projects where name = ${PROJECT_NAME}`;
    if (!p) { console.log('Nothing to remove.'); await sql.end(); return; }
    await sql.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${admin.id}, true)`;
      await tx`delete from public.crm_leads where project_id = ${p.id} and is_test_data`;
      await tx`delete from public.crm_properties where project_id = ${p.id}`;
      await tx`delete from public.crm_project_settings where project_id = ${p.id}`;
      await tx`delete from public.projects where id = ${p.id}`;
    });
    console.log(`Removed ${PROJECT_NAME} and everything on it.`);
    await sql.end();
    return;
  }

  /* ── 1 · the scheme ──────────────────────────────────────────────────── */
  let project = (await sql`select id from public.projects where name = ${PROJECT_NAME}`)[0];
  if (!project) {
    [project] = await sql`
      insert into public.projects (name, code, type, status, owner_id, created_by_id, lead_department_id, is_draft)
      values (${PROJECT_NAME}, ${PROJECT_CODE}, 'client', 'active',
              ${admin.id}, ${admin.id}, ${real?.lead_department_id ?? null}, false)
      returning id`;
    console.log(`Created project ${PROJECT_NAME}`);
  }

  await sql`
    insert into public.crm_project_settings (project_id, sells, city, marla_sqft_standard)
    values (${project.id}, 'property', ${CITY}, 225)
    on conflict (project_id) do update
      set sells = 'property', city = ${CITY}, marla_sqft_standard = 225`;

  /* ⚠️ Read the standard back rather than trusting the constant above. */
  const [{ marla_sqft_standard: STANDARD }] = await sql`
    select marla_sqft_standard from public.crm_project_settings where project_id = ${project.id}`;
  console.log(`Marla standard for this scheme: ${STANDARD} sq ft`);

  /* ── 2 · the plots ───────────────────────────────────────────────────── */
  await sql`delete from public.crm_properties where project_id = ${project.id}`;

  const rows = [];
  const roll = statusRoll();
  for (const r of REFERENCE) {
    const shape = SHAPES[r.shape];
    const cat = CATEGORIES[r.cat];
    rows.push({
      code: r.code, plot: r.plot, block: r.block, shape, cat,
      price: r.price, status: r.status, updated: r.updated,
      facing: r.facing, road: r.road, dev: DEV[r.dev],
    });
  }

  const BLOCKS = ['A', 'B', 'C', 'D', 'E'];
  let made = REFERENCE.length;
  let n = 0;
  while (made < 148) {
    const block = BLOCKS[n % BLOCKS.length];
    const shape = SHAPES[n % SHAPES.length];
    const cat = CATEGORIES[(n >> 1) % CATEGORIES.length];
    const seq = 100 * (BLOCKS.indexOf(block) + 1) + Math.floor(n / BLOCKS.length) + 2;
    const code = `PROP-${block}${seq}`;
    if (rows.some((x) => x.code === code)) { n += 1; continue; }

    const perMarla = shape.kind === 'Commercial plot' ? 1_100_000 : 850_000;
    const base = shape.marla * perMarla + (n % 7) * 50_000;
    const price = Math.round(base / 100_000) * 100_000;

    rows.push({
      code, plot: `${block}-${seq}`, block, shape, cat, price,
      status: roll.next().value ?? 'available',
      updated: new Date(Date.UTC(2026, 8, 1 + (n % 26))).toISOString().slice(0, 10),
      facing: FACINGS[n % FACINGS.length],
      road: ROADS[n % ROADS.length],
      dev: DEV[n % DEV.length],
    });
    made += 1;
    n += 1;
  }

  for (const r of rows) {
    const areaSqft = r.shape.marla * STANDARD;
    /* ⚠️ The dimensions must agree with marla × the PROJECT's standard. */
    const [w, l] = r.shape.dims.replace(/[^0-9×]/g, '').split('×').map(Number);
    if (Math.abs(w * l - areaSqft) > areaSqft * 0.12) {
      throw new Error(`${r.code}: ${r.shape.dims} is ${w * l} sq ft but ${r.shape.marla} Marla × ${STANDARD} = ${areaSqft}.`);
    }
    const premium = Math.round((r.price * r.cat.premiumPct) / 100 / 1000) * 1000;

    const [prop] = await sql`
      insert into public.crm_properties
        (project_id, code, plot_number, block, kind, size_marla, area_sqft, dimensions,
         category, facing, road_width_ft, is_corner, is_park_facing, is_main_boulevard,
         base_price, premium_charges, status, development_status, price_updated_at,
         catalogue_kind, is_test_data, created_by_id, updated_at)
      values (${project.id}, ${r.code}, ${r.plot}, ${r.block}, ${r.shape.kind},
              ${r.shape.marla}, ${areaSqft}, ${r.shape.dims},
              ${r.cat.label}, ${r.facing}, ${r.road},
              ${r.cat.corner}, ${r.cat.park}, ${r.cat.boulevard},
              ${r.price}, ${premium}, ${r.status}::public.crm_property_status,
              ${r.dev}, ${r.updated}::timestamptz, 'plot', true, ${admin.id},
              ${r.updated}::timestamptz)
      returning id`;

    for (const s of planFor(r.price)) {
      await sql`
        insert into public.crm_payment_stages (property_id, sort_order, label, percentage, amount, instalments)
        values (${prop.id}, ${s.sort}, ${s.label}, ${s.pct}, ${s.amount}, ${s.instalments})`;
    }
  }
  console.log(`Seeded ${rows.length} plots and ${rows.length * 5} payment stages.`);

  /* ── 3 · a few leads, so Linked items is not always empty ─────────────── */
  const NAMES = [
    ['Faisal Rehman', 'PROP-A101'], ['Hina Shahzad', 'PROP-A102'],
    ['Ayesha Noor', 'PROP-B201'], ['Kamran Sheikh', 'PROP-C301'],
    ['Mohsin Ahmed', 'PROP-B401'], ['Bilal Tariq', 'PROP-A101'],
  ];
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${admin.id}, true),
                    set_config('app.crm_quiet_insert', 'on', true)`;
    let i = 0;
    for (const [name, code] of NAMES) {
      i += 1;
      const [p] = await tx`select id from public.crm_properties
        where project_id = ${project.id} and code = ${code}`;
      const phone = `+9230000000${String(i).padStart(2, '0')}`;
      /* ⚠️ RE-LINK, DO NOT SKIP. `crm_leads.property_id` is ON DELETE SET
         NULL, and this script deletes the whole catalogue before re-seeding it
         — so the second run silently unlinked every demo lead and the Related
         items panel went empty. Skipping an existing lead left it pointing at
         nothing; updating it puts the link back on the NEW plot row. */
      const exists = await tx`select id from public.crm_leads
        where project_id = ${project.id} and phone_e164 = ${phone}`;
      if (exists.length) {
        await tx`update public.crm_leads set property_id = ${p.id} where id = ${exists[0].id}`;
        continue;
      }
      await tx`select app.crm_create_lead(
        ${project.id}::uuid, ${name}::text, ${phone}::text, ${phone}::text,
        ${`${name.split(' ')[0].toLowerCase()}@example.invalid`}::text, ${CITY}::text,
        'manual'::public.crm_lead_source, 'Demo inventory'::text,
        ${`Asking about ${code}`}::text, ${p.id}::uuid, null::bigint,
        false, null, null, null, null, null, true)`;
    }
  });

  /* ── 4 · prove nothing is queued to a human ───────────────────────────── */
  const [{ n: queued }] = await sql`
    select count(*)::int n from public.crm_follow_ups f
     join public.crm_leads l on l.id = f.lead_id
    where l.project_id = ${project.id} and f.status in ('planned','due') and f.channel = 'whatsapp'`;
  const [{ n: consenting }] = await sql`
    select count(*)::int n from public.crm_leads
     where project_id = ${project.id} and whatsapp_consent`;
  const [{ n: linked }] = await sql`
    select count(*)::int n from public.crm_leads
     where project_id = ${project.id} and property_id is not null`;
  console.log(`queued WhatsApp follow-ups: ${queued}   leads with consent: ${consenting}   leads linked to a plot: ${linked}`);
  if (linked !== NAMES.length) {
    throw new Error(`${NAMES.length} leads should be linked to a plot and ${linked} are. The catalogue was probably re-seeded under them.`);
  }
  if (queued !== 0 || consenting !== 0) {
    throw new Error('A demo row could message somebody. Refusing to finish quietly.');
  }

  const [counts] = await sql`
    select count(*)::int total,
           count(*) filter (where status = 'available')::int available,
           count(*) filter (where status = 'reserved')::int reserved,
           count(*) filter (where status = 'sold')::int sold,
           count(*) filter (where status in ('on_hold','blocked'))::int held
      from public.crm_properties where project_id = ${project.id}`;
  console.log(counts);
  await sql.end();
}

main().catch(async (error) => {
  console.error(String(error.message ?? error));
  await sql.end();
  process.exit(1);
});
