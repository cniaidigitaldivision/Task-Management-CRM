/* ============================================================================
 * CAN SARAH BOOK A VISIT, AND ONLY ON HER OWN LEADS?
 * ----------------------------------------------------------------------------
 * Run: node scripts/check-appointments.mjs
 *
 * ⚠️ EVERY CHECK RUNS AS A REAL PERSON, never as an admin. `crm_appointments`
 * is guarded by a row-local RLS predicate rather than a definer, so the only
 * thing stopping one salesperson booking into another's diary is that policy —
 * and a policy is exactly what an admin session cannot test.
 *
 * ⚠️ AND IT CLEANS UP AFTER ITSELF on every path, including the failures.
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

const MARK = 'check-appointments.mjs';
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

try {
  const [project] = await sql`
    select p.id, p.name from public.projects p
      join public.departments d on d.id = p.lead_department_id
     where d.key = 'sales' and p.name like '%[demo]' limit 1`;
  if (!project) { console.log('No demo sales project.'); process.exit(0); }

  const people = await sql`
    select e.user_id as id, e.full_name from app.crm_eligible_owners(${project.id}::uuid) e
     where e.eligible order by e.full_name`;
  if (people.length < 1) { console.log('Nobody eligible.'); process.exit(0); }

  const sarah = people[0];
  const sahad = people[1] ?? null;

  const [hers] = await sql`
    select id, full_name from public.crm_leads
     where owner_id = ${sarah.id} and project_id = ${project.id} limit 1`;
  if (!hers) { console.log(`${sarah.full_name} has no demo lead.`); process.exit(0); }

  await cleanup();
  console.log(`\nProject: ${project.name}\nBooking on ${hers.full_name}, owned by ${sarah.full_name}\n`);

  const when = new Date(Date.now() + 36e5 * 26).toISOString();

  // 1 · She can book on her own lead.
  const booked = await as(sarah.id, (tx) => tx`
    insert into public.crm_appointments
      (lead_id, project_id, property_id, kind, scheduled_at, duration_minutes,
       location, notes, owner_id, created_by_id, is_test_data)
    select l.id, l.project_id, l.property_id, 'site_visit', ${when}::timestamptz, 60,
           'Plot A-101, Block A', ${MARK}, l.owner_id, ${sarah.id}::uuid, l.is_test_data
      from public.crm_leads l where l.id = ${hers.id}
    returning id, owner_id, project_id, is_test_data`);
  say(booked.length === 1, `${sarah.full_name} booked a site visit on her own lead`);

  if (booked.length === 1) {
    const b = booked[0];
    say(String(b.owner_id) === String(sarah.id), 'it landed in the LEAD OWNER’s diary, not the booker’s by accident');
    say(String(b.project_id) === String(project.id), 'and under the lead’s own project');
    say(b.is_test_data === true, 'and inherited the lead’s test-data flag without anybody ticking a box');

    // 2 · ⚠️ A colleague cannot book on a lead that is not theirs.
    if (sahad) {
      let refused = false;
      try {
        const r = await as(sahad.id, (tx) => tx`
          insert into public.crm_appointments
            (lead_id, project_id, kind, scheduled_at, duration_minutes, notes, owner_id, created_by_id)
          select l.id, l.project_id, 'site_visit', ${when}::timestamptz, 60, ${MARK}, l.owner_id, ${sahad.id}::uuid
            from public.crm_leads l where l.id = ${hers.id}
          returning id`);
        refused = r.length === 0;
      } catch { refused = true; }
      say(refused, `${sahad.full_name} cannot book on a lead that is not theirs`);

      const seen = await as(sahad.id, (tx) => tx`
        select 1 from public.crm_appointments where id = ${b.id}`);
      say(seen.length === 0, `${sahad.full_name} cannot even read it`);
    }

    // 3 · The owner sees it in her own diary.
    const diary = await as(sarah.id, (tx) => tx`
      select a.id from public.crm_appointments a
       where a.owner_id = app.current_user_id()
         and a.status not in ('cancelled','rescheduled')
         and a.scheduled_at >= date_trunc('day', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi'`);
    say(diary.some((d) => String(d.id) === String(b.id)), 'and it appears in her own upcoming diary');

    // 4 · ⚠️ COMPLETING WITHOUT AN OUTCOME IS REFUSED BY THE DATABASE (152).
    let bad = false;
    try {
      await as(sarah.id, (tx) => tx`
        update public.crm_appointments set status='completed', outcome_at=null where id=${b.id}`);
      bad = true;
    } catch { /* check_violation */ }
    say(!bad, 'an appointment cannot be completed with no record of what happened');

    // 5 · And with one it closes.
    const closed = await as(sarah.id, (tx) => tx`
      update public.crm_appointments
         set status='completed', outcome='They liked the corner plot.', outcome_at=now()
       where id=${b.id} returning id`);
    say(closed.length === 1, 'and closes once the outcome is recorded');
  }
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}

console.log(failures === 0
  ? '\n\x1b[32mAll checks passed.\x1b[0m\n'
  : `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`);
process.exit(failures === 0 ? 0 : 1);
