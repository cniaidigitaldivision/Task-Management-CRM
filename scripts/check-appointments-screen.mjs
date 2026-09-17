/* ============================================================================
 * DOES THE APPOINTMENTS SCREEN SHOW THE RIGHT PERSON THE RIGHT DIARY?
 * ----------------------------------------------------------------------------
 * Run: node scripts/check-appointments-screen.mjs
 *
 * `check-appointments.mjs` proves the WRITE path — who may book, and into whose
 * diary. This proves the READ that `/appointments` is drawn from, which is a
 * different query with its own way of being wrong.
 *
 * ⚠️ EVERY CHECK RUNS AS A REAL PERSON, never as an admin. The screen is guarded
 * by `crm_appointments`'s row-local policy (152) plus the query's own owner
 * clause, and an admin session passes both for everybody — so an admin run would
 * report a tick for a rule it never exercised. Six bugs in this codebase reached
 * the owner exactly that way.
 *
 * ⚠️ THE CHECK THAT MATTERS MOST IS THE PROJECT NAME, and it is not obvious.
 * The query was first written with `join public.projects`. Under a salesperson's
 * session `projects_select` asks for membership, a salesperson is a member of
 * nothing, and every row would have come back with a null project — a screen
 * that looked merely sparse rather than broken, and looked perfect from an admin
 * login. `app.crm_project_name()` is a SECURITY DEFINER and is the fix. Assert
 * the NAME, because asserting the row count would pass either way.
 *
 * ⚠️ AND IT RAISES RATHER THAN SKIPS. A self-check that shrugs when it cannot
 * find its fixture prints a tick for a rule it never ran.
 *
 * ⚠️ IT CLEANS UP AFTER ITSELF on every path, deleting ONLY the rows it wrote
 * — matched on its own marker, never on a date or a lead.
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

const MARK = 'check-appointments-screen.mjs';
const as = (id, fn) =>
  sql.begin(async (tx) => {
    await tx`select set_config('role','cni_app',true), set_config('app.user_id',${id},true)`;
    return fn(tx);
  });

let failures = 0;
const say = (ok, line) => {
  if (!ok) failures += 1;
  console.log(`${ok ? '\x1b[32m  ok \x1b[0m' : '\x1b[31mFAIL \x1b[0m'} ${line}`);
};
const cleanup = () => sql`delete from public.crm_appointments where notes = ${MARK}`;

/** The screen's own query, as `crmMyAppointments` issues it. */
const diary = (tx, backDays = 60) => tx`
  select a.id, a.status::text, a.scheduled_at, a.notes,
         l.full_name as lead_name,
         app.crm_project_name(a.project_id) as project_name
    from public.crm_appointments a
    join public.crm_leads l on l.id = a.lead_id
   where a.owner_id = app.current_user_id()
     and a.scheduled_at >= (date_trunc('day', now() at time zone 'Asia/Karachi')
                            - make_interval(days => ${backDays})) at time zone 'Asia/Karachi'
   order by a.scheduled_at desc
   limit 300`;

const book = (actorId, leadId, whenIso, status) => as(actorId, (tx) => tx`
  insert into public.crm_appointments
    (lead_id, project_id, property_id, kind, scheduled_at, duration_minutes,
     location, notes, owner_id, created_by_id, is_test_data, status)
  select l.id, l.project_id, l.property_id, 'site_visit', ${whenIso}::timestamptz, 60,
         'Plot A-101, Block A', ${MARK}, l.owner_id, ${actorId}::uuid, l.is_test_data,
         ${status}::public.crm_appointment_status
    from public.crm_leads l where l.id = ${leadId}
  returning id`);

try {
  const [project] = await sql`
    select p.id, p.name from public.projects p
      join public.departments d on d.id = p.lead_department_id
     where d.key = 'sales' and p.name like '%[demo]' limit 1`;
  if (!project) throw new Error('No demo sales project — the fixture this check needs does not exist.');

  const people = await sql`
    select e.user_id as id, e.full_name from app.crm_eligible_owners(${project.id}::uuid) e
     where e.eligible order by e.full_name`;
  if (people.length < 2) {
    throw new Error(`Need two eligible salespeople to prove the boundary; found ${people.length}.`);
  }
  /* ⚠️ NAMED BY ROLE IN THE CHECK, NOT BY PERSON. `order by full_name` decides
     who is first, so hard-coding "sarah" here printed every line with the names
     the wrong way round while asserting the right thing — a passing check that
     misreports who it tested is how a real failure gets read as somebody else's.
     Every line below prints `.full_name` and is symmetric either way. */
  const [owner, colleague] = people;

  const leadOf = async (person) => {
    const [lead] = await sql`
      select id, full_name from public.crm_leads
       where owner_id = ${person.id} and project_id = ${project.id} limit 1`;
    if (!lead) throw new Error(`${person.full_name} has no lead on ${project.name}.`);
    return lead;
  };
  const hers = await leadOf(owner);
  const his = await leadOf(colleague);

  /* ⚠️ Somebody who should see NOTHING. Not an admin — an admin is a member of
     nothing and passes every predicate, which is the whole trap. */
  const [outsider] = await sql`
    select u.id, u.full_name from public.users u
      join public.departments d on d.id = u.department_id
     where d.key <> 'sales' and u.is_active limit 1`;
  if (!outsider) throw new Error('No non-sales user to prove the screen is closed to them.');

  await cleanup();
  console.log(`\nProject: ${project.name}`);
  console.log(`${owner.full_name} → ${hers.full_name} · ${colleague.full_name} → ${his.full_name}`);
  console.log(`Outsider: ${outsider.full_name}\n`);

  const day = 864e5;
  /* Three rows that between them separate this screen from Today's plan. */
  const past = new Date(Date.now() - day * 9).toISOString();     // older than the rail's window
  const soon = new Date(Date.now() + day * 2).toISOString();
  const gone = new Date(Date.now() + day * 3).toISOString();

  const [pastId] = await book(owner.id, hers.id, past, 'scheduled');
  const [soonId] = await book(owner.id, hers.id, soon, 'scheduled');
  const [goneId] = await book(owner.id, hers.id, gone, 'cancelled');
  const [hisId] = await book(colleague.id, his.id, soon, 'scheduled');
  say(
    Boolean(pastId && soonId && goneId && hisId),
    'four fixture appointments written, two people, past · upcoming · cancelled',
  );

  // ── 1 · Each person's diary is their own ───────────────────────────────
  const mine = await as(owner.id, (tx) => diary(tx));
  const ours = mine.filter((r) => r.notes === MARK);
  say(ours.length === 3, `${owner.full_name} sees their own three (got ${ours.length})`);
  say(
    !mine.some((r) => String(r.id) === String(hisId.id)),
    `and NOT ${colleague.full_name}'s, which is the whole boundary`,
  );

  // ── 2 · ⚠️ THE PROJECT NAME. The bug this file exists for. ──────────────
  const named = ours.filter((r) => r.project_name);
  say(
    named.length === ours.length,
    `every row carries its project name under a SALESPERSON's session (${named.length}/${ours.length}) — a null here is the projects_select bug`,
  );
  if (named.length > 0) {
    say(
      String(named[0].project_name) === String(project.name),
      `and it is the right one — "${named[0].project_name}"`,
    );
  }

  // ── 3 · What this screen shows that Today's plan cannot ─────────────────
  say(
    ours.some((r) => String(r.id) === String(pastId.id)),
    'a visit from 9 days ago is here — the rail starts at today and would have lost it',
  );
  say(
    ours.some((r) => String(r.id) === String(goneId.id)),
    'a cancelled one is here too — the rail hides those, a record keeps them',
  );

  // ── 4 · The window is real, not decorative ──────────────────────────────
  const narrow = await as(owner.id, (tx) => diary(tx, 3));
  say(
    !narrow.some((r) => String(r.id) === String(pastId.id)),
    'and the 9-day-old one drops out at a 3-day window, so the window is doing something',
  );

  // ── 5 · Sahad sees his, and only his ────────────────────────────────────
  const theirs = await as(colleague.id, (tx) => diary(tx));
  say(
    theirs.some((r) => String(r.id) === String(hisId.id)) &&
      !theirs.some((r) => String(r.id) === String(soonId.id)),
    `${colleague.full_name} sees their own and none of ${owner.full_name}'s`,
  );

  // ── 6 · Somebody outside sales gets nothing ─────────────────────────────
  const none = await as(outsider.id, (tx) => diary(tx));
  say(
    none.length === 0,
    `${outsider.full_name}, outside sales, gets an empty diary rather than a refusal`,
  );

  // ── 7 · Recording one is the caller's own row only ──────────────────────
  const stolen = await as(colleague.id, (tx) => tx`
    update public.crm_appointments
       set status = 'completed', outcome = 'not mine to record', outcome_at = now()
     where id = ${soonId.id} returning id`);
  say(stolen.length === 0, `${colleague.full_name} cannot record an outcome on ${owner.full_name}'s appointment`);

  const recorded = await as(owner.id, (tx) => tx`
    update public.crm_appointments
       set status = 'completed', outcome = 'They came with their brother.', outcome_at = now()
     where id = ${pastId.id} returning status::text, outcome`);
  say(
    recorded.length === 1 && recorded[0].status === 'completed',
    `${owner.full_name} can record their own, and the outcome is stored with it`,
  );
} catch (err) {
  failures += 1;
  console.log(`\x1b[31mFAIL \x1b[0m ${err.message}`);
} finally {
  await cleanup();
  await sql.end();
}

console.log(
  failures === 0
    ? '\n\x1b[32mAll good.\x1b[0m The screen shows each salesperson their own diary, with project names.'
    : `\n\x1b[31m${failures} failed.\x1b[0m`,
);
process.exit(failures === 0 ? 0 : 1);
