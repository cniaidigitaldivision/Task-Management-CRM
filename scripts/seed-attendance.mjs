#!/usr/bin/env node
/* ============================================================================
 * SEED A MONTH OF ATTENDANCE
 * ----------------------------------------------------------------------------
 *     node scripts/seed-attendance.mjs                 # this month, to today
 *     node scripts/seed-attendance.mjs --month=2026-07 # a specific month
 *     node scripts/seed-attendance.mjs --clear         # remove seeded rows
 *
 * The owner asked for demo history so the charts and the monthly table have
 * something to show before real check-ins accumulate.
 *
 * ── ⚠️ IT WRITES AS AN ADMIN, THROUGH THE REAL POLICIES ─────────────────────
 * Not as the migration owner with the triggers switched off. Every row goes in as
 * `cni_app` with `app.user_id` set to a real Admin, so the insert passes the same
 * RLS policy and the same guard trigger the application does. That makes this
 * script a test of migration 060 as well as a data generator — if the schema
 * refuses something the app would refuse, this fails here rather than in the UI.
 *
 * The one thing it does as the owner is `--clear`, because `cni_app` has no DELETE
 * on this table by design: attendance is a record, and the application corrects
 * rows rather than removing them.
 *
 * ── ⚠️ DETERMINISTIC, SO RE-RUNNING CHANGES NOTHING ─────────────────────────
 * Every decision comes from a hash of (person, date, question) — never from
 * `Math.random()`. Run it twice and the second run inserts nothing new and moves
 * nobody's arrival time, so a demo does not reshuffle itself between two looks at
 * the same screen. This is the same lesson as scripts/seed-demo-workload.mjs,
 * where a counter-based PRNG correlated the person with the outcome and one person
 * came out with 0 of 16.
 *
 * ── ⚠️ IT DOES NOT INVENT THE FUTURE ────────────────────────────────────────
 * Nothing is written for a date after today, and nothing for a team's day off. A
 * seeded Sunday for the Blue Area team would contradict the rules the page states
 * in its own sidebar.
 * ========================================================================= */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import postgres from 'postgres';

/* ---- Configuration ------------------------------------------------------- */

/** Working days by office, mirroring lib/domain/attendance.ts. 1 = Monday. */
const WORKING_DAYS = {
  blue_area: [1, 2, 3, 4, 5, 6],
  wah: [1, 2, 3, 4, 6, 7],
};

/**
 * How each person behaves, keyed by a fragment of their name.
 *
 * ⚠️ Deliberately NOT uniform. A month where everybody arrives at 10:02 shows
 * nothing: the page exists to make the difference between people visible, so the
 * demo has to contain one. `punctual` is the chance of arriving before 10:30,
 * `attends` the chance of coming in at all, and `forgets` the chance of leaving
 * without checking out — which is what the 9pm sweep is for.
 */
const PROFILES = [
  { match: 'Ammar', punctual: 0.95, attends: 0.97, forgets: 0.05, earliest: -22, spread: 26 },
  { match: 'Umm-e-Habiba', punctual: 0.9, attends: 0.99, forgets: 0.08, earliest: -18, spread: 30 },
  { match: 'Kashif', punctual: 0.72, attends: 0.96, forgets: 0.14, earliest: -8, spread: 46 },
  { match: 'Lareeb', punctual: 0.55, attends: 0.93, forgets: 0.2, earliest: -4, spread: 62 },
  { match: 'Najmulla', punctual: 0.8, attends: 0.95, forgets: 0.1, earliest: -12, spread: 38 },
  { match: 'Testing', punctual: 0.45, attends: 0.88, forgets: 0.24, earliest: 0, spread: 78 },
];

const DEFAULT_PROFILE = { punctual: 0.75, attends: 0.95, forgets: 0.12, earliest: -10, spread: 40 };

/** Karachi is UTC+5 and has not observed daylight saving since 2009. */
const OFFSET_MINUTES = 5 * 60;

/* ---- Helpers ------------------------------------------------------------- */

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

/**
 * FNV-1a → a fraction in [0, 1).
 *
 * ⚠️ Keyed on the row's identity, not on a position in a stream. A counter-based
 * generator makes consecutive decisions correlate, which is how the workload seed
 * ended up giving one person every failure.
 */
function hash01(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x100000000;
}

function isoWeekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function datesInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** A Karachi wall-clock on `date` as a UTC instant. */
function instant(date, minutesAfterMidnight) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutesAfterMidnight - OFFSET_MINUTES));
}

function profileFor(name) {
  return PROFILES.find((p) => name.includes(p.match)) ?? DEFAULT_PROFILE;
}

/* ---- Run ---------------------------------------------------------------- */

const args = process.argv.slice(2);
const clear = args.includes('--clear');
const monthArg = args.find((a) => a.startsWith('--month='))?.slice('--month='.length);

const env = readEnvLocal();
if (!env.DATABASE_URL) {
  console.error('✗ DATABASE_URL is not set in .env.local');
  process.exit(1);
}

const sql = postgres(env.DATABASE_URL, {
  max: 1,
  onnotice: () => {},
  /* Never echo the URL: postgres.js prints it on a parse failure and it holds the
     password. Same reason as scripts/migrate.mjs. */
  connection: { application_name: `seed-attendance(${basename(process.argv[1])})` },
});

try {
  const [{ today }] = await sql`select app.attendance_today() as today`;
  const todayIso = today instanceof Date ? today.toISOString().slice(0, 10) : String(today);
  const month = monthArg ?? todayIso.slice(0, 7);

  if (!/^\d{4}-\d{2}$/.test(month)) {
    console.error(`✗ --month must look like 2026-08, got "${month}".`);
    process.exit(1);
  }

  if (clear) {
    /* As the OWNER: `cni_app` has no DELETE on this table, deliberately. */
    const gone = await sql`
      delete from public.attendance_days
       where to_char(on_date, 'YYYY-MM') = ${month}
      returning id
    `;
    console.log(`\n✓ Removed ${gone.length} attendance row(s) for ${month}.`);
    await sql.end();
    process.exit(0);
  }

  const people = await sql`
    select id, full_name, office_team from public.users
     where is_active and account_state = 'active'
     order by full_name
  `;
  if (people.length === 0) {
    console.error('✗ No active people to seed.');
    process.exit(1);
  }

  const admin = await sql`
    select id, full_name from public.users
     where role in ('admin', 'super_admin') and is_active
     order by case role when 'admin' then 0 else 1 end
     limit 1
  `;
  if (admin.length === 0) {
    console.error('✗ No Admin to write as. The guard trigger requires one.');
    process.exit(1);
  }

  /* Never past today: see the header. */
  const dates = datesInMonth(month).filter((d) => d <= todayIso);
  if (dates.length === 0) {
    console.log(`\nNothing to do — ${month} has not started yet.`);
    await sql.end();
    process.exit(0);
  }

  const planned = [];
  for (const person of people) {
    const profile = profileFor(person.full_name);
    const team = WORKING_DAYS[person.office_team] ?? WORKING_DAYS.blue_area;

    for (const date of dates) {
      if (!team.includes(isoWeekday(date))) continue;

      const key = `${person.id}|${date}`;
      if (hash01(`${key}|attend`) > profile.attends) continue; // an absence

      /* Arrival: early or on time for the punctual, drifting later otherwise.
         `spread` is how far past 10:00 a late arrival can reach. */
      const onTime = hash01(`${key}|punctual`) < profile.punctual;
      const jitter = hash01(`${key}|minute`);
      const minutesFromTen = onTime
        ? Math.round(profile.earliest + jitter * (30 - profile.earliest))
        : Math.round(31 + jitter * profile.spread);

      const checkIn = 10 * 60 + minutesFromTen;

      /* ⚠️ A few days end with no check-out, on purpose. It is a real state — the
         owner's whole reason for the 9pm reminder — and a demo where everybody
         remembered would leave that column and that sweep untested by eye.
         Never for today, though: an open day today is indistinguishable from
         somebody who is simply still at work. */
      const forgot = date !== todayIso && hash01(`${key}|forgot`) < profile.forgets;

      let checkOut = null;
      if (!forgot) {
        const stay = hash01(`${key}|stay`);
        /* Most leave within half an hour of six; a fifth stay late, which the
           owner says is normal. */
        const extra = stay < 0.8 ? Math.round(-6 + stay * 45) : Math.round(45 + stay * 150);
        checkOut = Math.max(checkIn + 60, 18 * 60 + extra);
      }

      planned.push({
        userId: person.id,
        date,
        checkIn: instant(date, checkIn),
        checkOut: checkOut === null ? null : instant(date, checkOut),
      });
    }
  }

  console.log(`\nSeeding ${month}: ${planned.length} day(s) across ${people.length} people…`);

  let inserted = 0;
  let skipped = 0;

  /* One transaction, acting as the Admin, through the real policies. */
  await sql.begin(async (tx) => {
    await tx`
      select set_config('role', 'cni_app', true),
             set_config('app.user_id', ${admin[0].id}, true)
    `;

    for (const row of planned) {
      /* ⚠️ `on conflict do nothing`: re-running must not move a time somebody has
         already seen, and must never overwrite a REAL check-in with a fake one. */
      const done = await tx`
        insert into public.attendance_days
          (user_id, on_date, checked_in_at, checked_out_at)
        values
          (${row.userId}, ${row.date}::date, ${row.checkIn}, ${row.checkOut})
        on conflict (user_id, on_date) do nothing
        returning id
      `;
      if (done.length > 0) inserted += 1;
      else skipped += 1;
    }
  });

  console.log(`✓ ${inserted} inserted, ${skipped} already there.`);

  /* Report what the page will show, so the seed can be sanity-checked without
     opening a browser. */
  const summary = await sql`
    select u.full_name,
           count(*)::int as days,
           count(*) filter (
             where (a.checked_in_at at time zone 'Asia/Karachi')::time > '10:30'
           )::int as late,
           count(*) filter (where a.checked_out_at is null)::int as open_days,
           round(avg(
             extract(epoch from (a.checked_out_at - a.checked_in_at)) / 3600
           ) filter (where a.checked_out_at is not null), 1) as avg_hours
      from public.attendance_days a
      join public.users u on u.id = a.user_id
     where to_char(a.on_date, 'YYYY-MM') = ${month}
     group by u.full_name
     order by late desc, u.full_name
  `;

  console.log(`\n${month} — what the page will show:`);
  console.log('  person                 days  late  no check-out  avg hours');
  for (const row of summary) {
    console.log(
      `  ${String(row.full_name).padEnd(22)} ${String(row.days).padStart(4)}` +
        ` ${String(row.late).padStart(5)} ${String(row.open_days).padStart(13)}` +
        ` ${String(row.avg_hours ?? '—').padStart(10)}`,
    );
  }
  console.log('\n  Re-run safely: existing days are left alone. --clear removes the month.');
} catch (error) {
  /* ⚠️ Never print the error object whole: postgres.js attaches the connection
     details to some failures. */
  console.error(`\n✗ ${String(error.message).split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
