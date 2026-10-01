#!/usr/bin/env node
/* ============================================================================
 * FILL IN SEPTEMBER'S ATTENDANCE
 * ----------------------------------------------------------------------------
 *     node scripts/backfill-september-attendance.mjs            # dry run
 *     node scripts/backfill-september-attendance.mjs --apply    # write it
 *
 * Owner, 2026-10-01: *"I want to add an entry from 1 September to 30 September
 * for all attendees: check-in and check-out times … According to the team you
 * should know which day is off … check-in is from 10 to 10:30 and check-out is
 * from 6 to 6:30 pm but not at the same time for all."*
 *
 * ── ⚠️ THE DAY OFF IS PER TEAM, AND GETTING IT WRONG IS THE WHOLE JOB ──────
 * `lib/domain/attendance.ts` carries two office teams and they do NOT share a
 * weekend:
 *
 *     blue_area (Islamabad)     Mon–Sat          Sunday off      10 people
 *     wah (Headquarters)        Mon–Thu, Sat–Sun Friday off       8 people
 *
 * So "except Sunday" is right for ten of the eighteen and wrong for the other
 * eight — marking the Wah team present on a Friday and absent on a Sunday would
 * invert their month. The team is read off each person's own row.
 *
 * ── ⚠️ AND IT IS MARKED, NOT DISGUISED ────────────────────────────────────
 * Every row written here carries `check_in_source = 'scheduled'` — the word
 * migration 263 added so a report can tell a pressed button from an automation —
 * plus `edited_by_id`, `edited_at` and an `edit_note` naming this script and the
 * day it ran. An attendance record that cannot be told apart from somebody
 * actually arriving is not a record, it is a claim. The export already reads
 * `check_in_source`, so nothing downstream has to be taught anything.
 *
 * ── ⚠️ WHAT IT REFUSES TO WRITE ───────────────────────────────────────────
 *   · a day that is not a working day for THAT person's team
 *   · a day before their account existed — Farhan Shah joined on 29 September,
 *     and a record of him at work on the 1st is a record of somebody who had no
 *     account. The owner asked for "1 September to 30 September for all"; this
 *     starts each person at whichever is later, and says so in the summary
 *     rather than quietly doing one or the other.
 *   · a day they were on approved leave, a holiday, or blocked as unavailable
 *   · a day that already has a row — the 30 days already hold between 2 and 13
 *     real check-ins each, and those are somebody's actual arrivals
 *
 * ── ⚠️ THE TIMES ARE RANDOM BUT NOT ARBITRARY ─────────────────────────────
 * Seeded from (person, date), so a second run produces the same minutes as the
 * first. That is what makes this safe to re-run, and it means any row can be
 * explained later rather than being an unrepeatable accident.
 *
 * 10:00–10:30 is deliberately inside the on-time window: `LATE_AFTER_MINUTES`
 * is 10:30 and `late` is *after* it, so nothing written here reads as late.
 * ========================================================================= */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';

const FROM = '2026-09-01';
const TO = '2026-09-30';
/* Karachi minutes past midnight. Inclusive both ends. */
const IN_FROM = 10 * 60;
const IN_TO = 10 * 60 + 30;
const OUT_FROM = 18 * 60;
const OUT_TO = 18 * 60 + 30;

const APPLY = process.argv.includes('--apply');

function redact(text) {
  return String(text).replace(/:\/\/([^:@\s]+):(.*)@([^@\s/]+)/g, '://$1:••••••••@$3');
}

const env = {};
for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !(m[1] in env)) {
    env[m[1]] = m[2].trim().replace(/^"([^"]*)".*$/, '$1').replace(/^'([^']*)'.*$/, '$1')
      .replace(/\s+#.*$/, '').trim();
  }
}
if (!env.DATABASE_URL) {
  console.error('✗ DATABASE_URL is not set in .env.local');
  process.exit(1);
}

const sql = postgres(env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });

/** ISO weekday of a YYYY-MM-DD. 1 = Monday … 7 = Sunday. */
function isoWeekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  const at = Date.UTC(y, m - 1, d);
  return new Date(at).getUTCDay() === 0 ? 7 : new Date(at).getUTCDay();
}

/* ⚠️ The same table as `OFFICE_TEAMS` in lib/domain/attendance.ts. Transcribed
   rather than imported because this is a plain script and that file is TypeScript
   — so the check at the end reads the real one and refuses to run if they ever
   disagree. */
const WORKING_DAYS = {
  blue_area: [1, 2, 3, 4, 5, 6],
  wah: [1, 2, 3, 4, 6, 7],
};

/** A stable minute inside [from, to] for this person on this day. */
function minuteFor(userId, date, slot, from, to) {
  const hash = createHash('sha256').update(`${userId}|${date}|${slot}`).digest();
  return from + (hash.readUInt32BE(0) % (to - from + 1));
}

const hhmm = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

try {
  /* ── 1 · the transcription above must still match the product ──────────── */
  const domain = readFileSync(resolve(process.cwd(), 'lib/domain/attendance.ts'), 'utf8');
  for (const [team, days] of Object.entries(WORKING_DAYS)) {
    const block = domain.slice(domain.indexOf(`${team}: {`), domain.indexOf(`${team}: {`) + 600);
    const found = /workingDays:\s*\[([0-9,\s]+)\]/.exec(block);
    if (!found) throw new Error(`Could not read workingDays for ${team} out of lib/domain/attendance.ts`);
    const real = found[1].split(',').map((n) => Number(n.trim())).filter((n) => !Number.isNaN(n));
    if (real.join(',') !== days.join(',')) {
      throw new Error(
        `${team} works [${real}] in lib/domain/attendance.ts and [${days}] in this script. `
        + 'Fix the script rather than the product.',
      );
    }
  }

  const [admin] = await sql`
    select id, full_name from public.users
     where is_active and role in ('admin', 'super_admin')
     order by case when role = 'admin' then 0 else 1 end, created_at limit 1`;
  if (!admin) throw new Error('No active Admin to attribute these rows to.');

  const people = await sql`
    select u.id, u.full_name, u.office_team, (u.created_at at time zone 'Asia/Karachi')::date as joined
      from public.users u
     where u.is_active and u.account_state = 'active'
     order by u.office_team, u.full_name`;

  const existing = new Set(
    (await sql`select user_id, on_date::text as d from public.attendance_days
                where on_date between ${FROM} and ${TO}`)
      .map((r) => `${r.user_id}|${r.d}`),
  );

  const away = await sql`
    select user_id, start_date::text as s, end_date::text as e
      from public.availability
     where type in ('leave', 'holiday', 'unavailable')
       and start_date <= ${TO} and end_date >= ${FROM}`;

  const dates = [];
  for (let d = new Date(`${FROM}T00:00:00Z`); d <= new Date(`${TO}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  const rows = [];
  const summary = [];

  for (const person of people) {
    const team = person.office_team ?? 'blue_area';
    const works = WORKING_DAYS[team] ?? WORKING_DAYS.blue_area;
    const joined = person.joined.toISOString
      ? person.joined.toISOString().slice(0, 10)
      : String(person.joined).slice(0, 10);

    let added = 0;
    let had = 0;
    let offDay = 0;
    let beforeJoining = 0;
    let onLeave = 0;

    for (const date of dates) {
      if (!works.includes(isoWeekday(date))) { offDay += 1; continue; }
      if (date < joined) { beforeJoining += 1; continue; }
      if (existing.has(`${person.id}|${date}`)) { had += 1; continue; }
      if (away.some((a) => a.user_id === person.id && date >= a.s && date <= a.e)) {
        onLeave += 1; continue;
      }

      const inAt = minuteFor(person.id, date, 'in', IN_FROM, IN_TO);
      const outAt = minuteFor(person.id, date, 'out', OUT_FROM, OUT_TO);
      rows.push({
        user_id: person.id,
        on_date: date,
        /* ⚠️ Written as a Karachi wall-clock time and cast by Postgres, never
           as a UTC instant computed here. `2026-09-03 10:17 Asia/Karachi` is
           unambiguous; subtracting five hours by hand is how a backfill lands an
           hour out the moment anything about the offset is misremembered. */
        in_local: `${date} ${hhmm(inAt)}:00`,
        out_local: `${date} ${hhmm(outAt)}:00`,
      });
      added += 1;
    }

    summary.push({ name: person.full_name, team, joined, added, had, offDay, beforeJoining, onLeave });
  }

  /* ── 2 · say what it found ─────────────────────────────────────────────── */
  console.log(`\nSeptember ${FROM} → ${TO} · ${people.length} active people\n`);
  console.log(
    'person'.padEnd(22) + 'team'.padEnd(11) + 'joined'.padEnd(12)
    + 'to add'.padStart(7) + 'already'.padStart(9) + 'day off'.padStart(9)
    + 'pre-join'.padStart(10) + 'away'.padStart(6),
  );
  for (const s of summary) {
    console.log(
      s.name.padEnd(22) + s.team.padEnd(11) + s.joined.padEnd(12)
      + String(s.added).padStart(7) + String(s.had).padStart(9) + String(s.offDay).padStart(9)
      + String(s.beforeJoining).padStart(10) + String(s.onLeave).padStart(6),
    );
  }
  console.log(`\n${rows.length} rows to write.`);

  const sample = rows.slice(0, 4).map((r) => `  ${r.on_date}  in ${r.in_local.slice(11, 16)}  out ${r.out_local.slice(11, 16)}`);
  if (sample.length) console.log('\nFirst few:\n' + sample.join('\n'));

  if (!APPLY) {
    console.log('\nDry run. Nothing was written. Re-run with --apply.\n');
  } else if (rows.length === 0) {
    console.log('\nNothing to do.\n');
  } else {
    /* ── 3 · write them, as the Admin, in one statement ──────────────────── */
    await sql.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${admin.id}, true)`;
      await tx`
        insert into public.attendance_days
          (user_id, on_date, checked_in_at, checked_out_at,
           check_in_source, check_out_source,
           edited_by_id, edited_at, edit_note)
        select (r->>'user_id')::uuid,
               (r->>'on_date')::date,
               (r->>'in_local')::timestamp at time zone 'Asia/Karachi',
               (r->>'out_local')::timestamp at time zone 'Asia/Karachi',
               'scheduled'::public.attendance_source,
               'scheduled'::public.attendance_source,
               ${admin.id}::uuid,
               now(),
               ${`Backfilled for September by scripts/backfill-september-attendance.mjs on ${new Date().toISOString().slice(0, 10)}.`}
          from jsonb_array_elements(${tx.json(rows)}::jsonb) r
        on conflict (user_id, on_date) do nothing`;
    });

    const [{ n }] = await sql`
      select count(*)::int n from public.attendance_days
       where on_date between ${FROM} and ${TO} and check_in_source = 'scheduled'`;
    console.log(`\n✓ Written. ${n} rows in September now carry check_in_source = 'scheduled'.\n`);
  }
} catch (error) {
  console.error('✗', redact(error.message ?? error));
  process.exitCode = 1;
} finally {
  await sql.end();
}
