/* ============================================================================
 * CAN SARAH ACTUALLY ADD A LEAD, AND DOES IT LAND WHERE IT SHOULD?
 * ----------------------------------------------------------------------------
 * Run: node scripts/check-add-lead.mjs
 *
 * ⚠️ THIS EXISTS BECAUSE AN ADMIN SESSION CANNOT FIND THIS CLASS OF BUG. Six
 * migrations in this codebase were one membership-predicate bug that reached the
 * owner because every check was made from an account that sees everything. The
 * whole Add Lead path runs through a SECURITY DEFINER function, which means RLS
 * is switched OFF inside it — so the only thing between a stranger and every
 * project's leads is a hand-written check, and a hand-written check is exactly
 * the kind that is right in the file and wrong in the database.
 *
 * Everything below runs under a REAL person's session, as `cni_app`.
 * ⚠️ AND IT CLEANS UP AFTER ITSELF — every row it writes carries a marker
 * phone number and is deleted at the end, pass or fail.
 * ========================================================================= */
import fs from 'node:fs';
import postgres from 'postgres';

const raw = fs.readFileSync('.env.local', 'utf8');
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|(.*?))\s*$/);
  if (m) env[m[1]] = m[2] ?? m[3] ?? (m[4] || '').replace(/\s+#.*$/, '').trim();
}
const sql = postgres(env.DATABASE_URL, { prepare: false, ssl: 'require', connect_timeout: 20 });

const MARK_A = '+923009990001';
const MARK_B = '+923009990002';

const as = (id, fn) =>
  sql.begin(async (tx) => {
    await tx`select set_config('role', 'cni_app', true)`;
    await tx`select set_config('app.user_id', ${id}, true)`;
    return fn(tx);
  });

let failures = 0;
const say = (ok, line) => {
  if (!ok) failures += 1;
  console.log(`${ok ? '\x1b[32m  ok \x1b[0m' : '\x1b[31mFAIL \x1b[0m'} ${line}`);
};

const cleanup = async () => {
  await sql`delete from public.crm_leads where phone_e164 in (${MARK_A}, ${MARK_B})`;
};

try {
  const [project] = await sql`
    select p.id, p.name from public.projects p
      join public.departments d on d.id = p.lead_department_id
     where d.key = 'sales' and p.name like '%[demo]' limit 1`;

  if (!project) {
    console.log('No demo sales project. Nothing to check.');
    process.exit(0);
  }
  console.log(`\nProject: ${project.name}\n`);

  const people = await sql`
    select e.user_id as id, e.full_name, e.eligible, e.blocked_always, e.why_not
      from app.crm_eligible_owners(${project.id}::uuid) e
     order by e.eligible desc, e.full_name`;

  console.log('Who may receive a lead:');
  for (const p of people) {
    console.log(
      `  ${p.eligible ? '✓' : '·'} ${p.full_name}${p.why_not ? ` — ${p.why_not}` : ''}`,
    );
  }
  console.log('');

  const eligible = people.filter((p) => p.eligible);
  if (eligible.length < 1) {
    say(false, 'nobody is eligible on the demo project');
    await cleanup();
    process.exit(1);
  }

  const sarah = eligible[0];
  const sahad = eligible[1] ?? null;

  /* Somebody outside the sales department entirely. */
  const [outsider] = await sql`
    select u.id, u.full_name from public.users u
      join public.projects p on p.id = ${project.id}::uuid
     where u.is_active and u.department_id is distinct from p.lead_department_id
     limit 1`;

  await cleanup();

  // ── 1 · The picker offers only what the write will accept ────────────────
  const offered = await as(sarah.id, (tx) => tx`select * from app.crm_add_lead_projects()`);
  say(
    offered.some((p) => p.id === project.id),
    `${sarah.full_name} is offered the demo project (${offered.length} project(s) in her picker)`,
  );

  if (outsider) {
    const theirs = await as(outsider.id, (tx) => tx`select * from app.crm_add_lead_projects()`);
    say(
      !theirs.some((p) => p.id === project.id),
      `${outsider.full_name} (outside sales) is NOT offered the demo project`,
    );
  }

  // ── 2 · She can create one, and the rota owns it ─────────────────────────
  const created = await as(sarah.id, (tx) => tx`
    select app.crm_create_lead(
      ${project.id}::uuid, 'Check Walk-in', '0300 999-0001', ${MARK_A}, null, 'Islamabad',
      'walk_in', 'Showroom desk', 'Asked about a 5 marla corner plot.',
      null, 12000000, true, 'whatsapp', 'Evenings',
      'Call back', now() + interval '1 day', 'call', false) as id`);
  const leadId = created[0]?.id ?? null;
  say(Boolean(leadId), 'a salesperson created a lead, which the RLS policy alone refuses');

  if (leadId) {
    const [row] = await sql`
      select l.owner_id, u.full_name as owner, l.is_test_data, l.whatsapp_consent,
             l.whatsapp_consent_at, l.budget, l.preferred_channel::text as chan,
             l.preferred_time, l.source::text as source, l.created_by_id
        from public.crm_leads l left join public.users u on u.id = l.owner_id
       where l.id = ${leadId}`;

    say(Boolean(row.owner_id), `the rota gave it to ${row.owner ?? 'nobody'}`);
    say(row.is_test_data === true, 'it is flagged as test data with nobody ticking a box');
    say(row.whatsapp_consent === true && row.whatsapp_consent_at !== null,
        'consent is recorded WITH the moment it was given');
    say(String(row.created_by_id) === String(sarah.id),
        `created_by is ${sarah.full_name}, whoever ended up owning it`);
    say(Number(row.budget) === 12000000, `budget stored as whole rupees (${row.budget})`);

    const [why] = await sql`
      select a.rule::text, a.reason, a.reason_text, u.full_name as who
        from public.crm_lead_assignments a
        left join public.users u on u.id = a.to_user_id
       where a.lead_id = ${leadId}`;
    say(why?.rule === 'rota', 'the assignment is recorded as a rota decision');
    say(Boolean(why?.reason?.eligible !== undefined),
        `the figures are frozen on the row: ${JSON.stringify(why?.reason ?? {})}`);
    say(Boolean(why?.reason_text), `and in a sentence: "${why?.reason_text ?? ''}"`);

    /* ⚠️ THREE, NOT TWO. 116 has a trigger on `crm_lead_notes` that writes
       `note_added`, so saving the enquiry puts it on the timeline as well —
       which is right, and an assertion of exactly two was this script being
       wrong about the schema rather than the schema misbehaving. */
    const acts = await sql`
      select kind::text from public.crm_lead_activity where lead_id = ${leadId} order by kind`;
    const kinds = acts.map((a) => a.kind);
    say(
      kinds.includes('created') && kinds.includes('assigned'),
      `the timeline records both the creation and the assignment (${kinds.join(', ')})`,
    );

    const notes = await sql`select body from public.crm_lead_notes where lead_id = ${leadId}`;
    say(notes.length === 1, 'the enquiry was kept in their own words');

    // ── 3 · The owner can see it; a colleague cannot ──────────────────────
    const ownerSees = await as(row.owner_id, (tx) => tx`
      select 1 from public.crm_leads where id = ${leadId}`);
    say(ownerSees.length === 1, 'the person who got it can read it');

    const other = eligible.find((p) => String(p.id) !== String(row.owner_id));
    if (other) {
      const otherSees = await as(other.id, (tx) => tx`
        select 1 from public.crm_leads where id = ${leadId}`);
      say(otherSees.length === 0, `${other.full_name} cannot read a lead that is not theirs`);

      // ── 4 · …but IS told it exists, which is the whole point ───────────
      const dupes = await as(other.id, (tx) => tx`
        select * from app.crm_lead_duplicates(${project.id}::uuid, ${MARK_A}, null)`);
      say(dupes.length > 0, `${other.full_name} IS told the person already exists`);
      say(
        dupes.some((d) => d.owner_name && d.is_open && d.is_mine === false),
        'and is told whose it is, without being given the lead',
      );

      // ── 5 · And retyping it is refused outright ───────────────────────
      let refused = null;
      try {
        await as(other.id, (tx) => tx`
          select app.crm_create_lead(
            ${project.id}::uuid, 'Check Walk-in', '0300 999-0001', ${MARK_A}, null, null,
            'walk_in', null, null, null, null, null, null, null, null, null, null,
            true) as id`);
      } catch (e) {
        refused = e.code ?? 'threw';
      }
      say(refused === 'CRM05', `retyping a colleague's open lead is refused (${refused})`);
    }
  }

  // ── 6 · An outsider cannot create one at all ────────────────────────────
  if (outsider) {
    let refused = null;
    try {
      await as(outsider.id, (tx) => tx`
        select app.crm_create_lead(
          ${project.id}::uuid, 'Check Trespass', null, ${MARK_B}, null, null,
          'walk_in', null, null, null, null, null, null, null, null, null, null, false) as id`);
    } catch (e) {
      refused = e.code ?? 'threw';
    }
    say(refused === 'CRM02', `${outsider.full_name} cannot create a lead here (${refused})`);
  }

  // ── 7 · The duplicate reader is not a phone directory ──────────────────
  if (outsider) {
    const probe = await as(outsider.id, (tx) => tx`
      select * from app.crm_lead_duplicates(${project.id}::uuid, ${MARK_A}, null)`);
    say(probe.length === 0, 'and cannot use the duplicate reader to look up a number');
  }
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}

console.log(
  failures === 0
    ? '\n\x1b[32mAll checks passed.\x1b[0m\n'
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
