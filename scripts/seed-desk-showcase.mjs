/* ============================================================================
 * THE DESK'S SHOWCASE ROWS — the owner's reference design, made real
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-14: *"I want this exact dummy data… Please add the exact UI
 * that is shown in this reference image."*
 *
 * ── ⚠️ IT ONLY EVER TOUCHES THE DEMO PROJECT ───────────────────────────────
 * Every row it writes is `source = 'manual'` with an `external_id` beginning
 * `showcase:`, on the project whose name ends `[demo]`. It refuses to run if it
 * cannot find that project, and it deletes ONLY rows carrying its own prefix.
 * Chitral's 632 real leads are never read, moved or counted by this file. The
 * owner was explicit that they must not be: *"Chitral Royal Home… having realer
 * data or realer leads, you can say, is not disturbing that."*
 *
 * ── ⚠️ THE PROJECT AND CITY IN THE DESIGN ARE TEXT, NOT REAL PROJECTS ──────
 * The reference shows "Chitral Royal Homes · Islamabad" and "CNI Digital
 * Services · Karachi" under the names. Those are the DESIGN's labels. Filing a
 * demo lead onto the real Chitral project would put fake people into a client's
 * pipeline, which is the one thing that must not happen — so every row here sits
 * on the demo project and carries the design's own city.
 *
 * Run: node scripts/seed-desk-showcase.mjs
 * ========================================================================= */
import fs from 'node:fs';
import postgres from 'postgres';

function env() {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|(.*?))\s*$/);
    if (m) out[m[1]] = m[2] ?? m[3] ?? (m[4] || '').replace(/\s+#.*$/, '').trim();
  }
  return out;
}

const E = env();
const sql = postgres(E.DATABASE_URL, { prepare: false, ssl: 'require' });
const PREFIX = 'showcase:';

/* ⚠️ RELATIVE TO NOW, NEVER HARD-CODED DATES. A seed with "12 Sept" in it reads
   as overdue this week and as ancient history next month, and then the screen it
   was written to demonstrate stops demonstrating it. */
const H = 3600_000;
const D = 24 * H;
const now = Date.now();

/** Today at a given Karachi wall-clock time, as an ISO instant. */
function karachiAt(dayOffset, hour24, minute = 0) {
  /* Karachi is UTC+5 all year — no DST — so this is exact rather than lucky. */
  const d = new Date(now + dayOffset * D);
  const ymd = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  return new Date(`${ymd}T${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:00`).toISOString();
}

/* ── The seven rows, in the design's own order ───────────────────────────── */
const ROWS = [
  {
    name: 'Faisal Rehman', city: 'Islamabad', stage: 'qualified', temperature: 'hot',
    label: 'Chitral Royal Homes',
    conv: { body: 'Quote QT-1042 sent', dir: 'outbound', at: new Date(now - 18 * H).toISOString() },
    next: { note: 'Quotation check-in', at: karachiAt(1, 10, 0) },
    seq: { state: 'scheduled', step: 1, total: 3, note: null },
    owner: 0,
  },
  {
    name: 'Hina Shahzad', city: 'Islamabad', stage: 'qualified', temperature: null,
    label: 'CNI Digital Services',
    conv: { body: 'Proposal requested', dir: 'inbound', at: new Date(now - 2 * D).toISOString() },
    next: { note: 'Send proposal', at: new Date(now - 2 * D).toISOString() },
    seq: { state: 'not_started', step: null, total: null, note: null },
    owner: 1,
  },
  {
    name: 'Adnan Bashir', city: 'Rawalpindi', stage: 'follow_up', temperature: null,
    label: 'Chitral Royal Homes',
    conv: { body: 'Please send the plan for the corner plot', dir: 'inbound', at: new Date(now - 10 * 60_000).toISOString() },
    next: { note: 'Reply needed', at: new Date(now - 4 * H).toISOString() },
    seq: { state: 'paused', step: 1, total: 3, note: null },
    owner: 0,
  },
  {
    name: 'Ayesha Noor', city: 'Lahore', stage: 'follow_up', temperature: 'warm',
    label: 'Chitral Royal Homes',
    conv: { body: 'Brochure delivered', dir: 'outbound', at: new Date(now - D).toISOString() },
    next: { note: 'Site visit reminder', at: karachiAt(0, 15, 0) },
    seq: { state: 'active', step: 2, total: 3, note: null },
    owner: 1,
  },
  {
    name: 'Zara Malik', city: 'Multan', stage: 'contacted', temperature: null,
    label: 'Travel & Tours',
    conv: { body: 'Package enquiry', dir: 'inbound', at: new Date(now - D).toISOString() },
    next: null,                       // the "Add follow-up" state
    seq: { state: 'not_started', step: null, total: null, note: null },
    owner: 0,
  },
  {
    name: 'Kamran Sheikh', city: 'Karachi', stage: 'contacted', temperature: null,
    label: 'CNI Digital Services',
    conv: { body: 'Pricing shared', dir: 'outbound', at: new Date(now - 2 * D).toISOString() },
    next: { note: 'Email clarification', at: karachiAt(3, 10, 0) },
    seq: { state: 'scheduled', step: 2, total: 3, note: null },
    owner: 1,
  },
  {
    name: 'Sana Ahmed', city: 'Islamabad', stage: 'won', temperature: 'hot',
    label: 'Chitral Royal Homes',
    conv: { body: 'Booking confirmed', dir: 'inbound', at: new Date(now - 2 * H).toISOString() },
    next: null,
    seq: { state: 'stopped', step: 3, total: 3, note: 'Booked' },
    owner: 0,
  },
];

const run = async () => {
  const [project] = await sql`
    select id, name from public.projects where name like '%[demo]' limit 1`;
  if (!project) {
    console.error('No demo project found. Refusing to write showcase rows anywhere else.');
    process.exit(1);
  }

  /* Two owners, so the column varies as the design does. The real sales testers,
     not invented staff — a fake colleague on the Team page is a person somebody
     tries to assign real work to. */
  const owners = await sql`
    select u.id, u.full_name
      from public.users u join public.departments d on d.id = u.department_id
     where d.key = 'sales' and u.is_active and u.department_role is distinct from 'manager'::public.department_role
     order by u.full_name`;
  if (owners.length === 0) {
    console.error('Nobody in Sales to own these. Refusing.');
    process.exit(1);
  }

  const [form] = await sql`
    select id from public.crm_lead_forms where project_id = ${project.id} limit 1`;

  console.log(`project : ${project.name}`);
  console.log(`owners  : ${owners.map((o) => o.full_name).join(', ')}\n`);

  /* ⚠️ ONLY THIS SCRIPT'S OWN ROWS. Messages first — `crm_lead_messages` has no
     DELETE policy for a session, and this runs as the owner connection, so the
     order is ours to get right rather than the database's to enforce. */
  const mine = await sql`
    select id from public.crm_leads
     where project_id = ${project.id} and external_id like ${PREFIX + '%'}`;
  if (mine.length > 0) {
    const ids = mine.map((r) => r.id);
    await sql`delete from public.crm_lead_messages where lead_id = any(${ids}::uuid[])`;
    await sql`delete from public.crm_lead_activity where lead_id = any(${ids}::uuid[])`;
    await sql`delete from public.crm_lead_notes    where lead_id = any(${ids}::uuid[])`;
    await sql`delete from public.crm_leads         where id      = any(${ids}::uuid[])`;
    console.log(`cleared ${ids.length} previous showcase row(s)\n`);
  }

  let n = 0;
  for (const [i, r] of ROWS.entries()) {
    const owner = owners[r.owner % owners.length];
    /* ⚠️ A REAL, REACHABLE NUMBER ON NONE OF THEM. These are illustrations; a
       number that dials somewhere is how a demo row becomes a real phone call to
       a stranger. `+92 300 000 00NN` is in no allocated range. */
    const phone = `+9230000000${String(i + 10).padStart(2, '0')}`;

    const [lead] = await sql`
      insert into public.crm_leads
        (project_id, form_id, owner_id, source, external_id,
         full_name, phone, phone_e164, email, city, stage, temperature,
         next_action, next_action_at, submitted_at, imported_at,
         sequence_state, sequence_step, sequence_total, sequence_note, answers)
      values (
        ${project.id}, ${form?.id ?? null}, ${owner.id}, 'manual',
        ${PREFIX + r.name.toLowerCase().replace(/\s+/g, '-')},
        ${r.name}, ${phone}, ${phone},
        ${i % 3 === 0 ? `${r.name.split(' ')[0].toLowerCase()}@example.com` : null},
        ${r.city}, ${r.stage}::public.crm_stage,
        ${r.temperature}::public.crm_temperature,
        ${r.next?.note ?? null}, ${r.next?.at ?? null},
        ${new Date(now - (i + 3) * D).toISOString()}, ${new Date(now - (i + 3) * D).toISOString()},
        ${r.seq.state}::public.crm_sequence_state, ${r.seq.step}, ${r.seq.total}, ${r.seq.note},
        ${sql.json({ 'Which project are you interested in?': r.label })}
      )
      returning id`;

    await sql`
      insert into public.crm_lead_messages
        (lead_id, wa_message_id, direction, kind, body, occurred_at, status, sent_by_id)
      values (
        ${lead.id}, ${PREFIX + lead.id}, ${r.conv.dir}::public.crm_message_direction,
        'text', ${r.conv.body}, ${r.conv.at},
        ${r.conv.dir === 'outbound' ? 'read' : null}::public.crm_message_status,
        ${r.conv.dir === 'outbound' ? owner.id : null}
      )`;

    n += 1;
    const seq =
      r.seq.state === 'not_started' ? 'Not started'
      : r.seq.note ? `Stopped · ${r.seq.note}`
      : `${r.seq.state} · ${r.seq.step}/${r.seq.total}`;
    console.log(
      `  ${r.name.padEnd(16)} ${r.stage.padEnd(10)} ${seq.padEnd(18)} ${owner.full_name}`,
    );
  }

  console.log(`\n${n} showcase leads on ${project.name}.`);
  console.log('Chitral and every other project untouched.');
  await sql.end();
};

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
