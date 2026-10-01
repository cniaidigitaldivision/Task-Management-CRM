#!/usr/bin/env node
/* ============================================================================
 * MAKE SEPTEMBER A WHOLE MONTH
 * ----------------------------------------------------------------------------
 *     node scripts/normalise-september-attendance.mjs            # dry run
 *     node scripts/normalise-september-attendance.mjs --apply    # write it
 *
 * Owner, 2026-10-01: *"Just my all attenders: nothing will be late. All will be
 * on time. Should be on time, and with the zero recorder please add it so a
 * proper month of attenders will go."*
 *
 * Three things are wrong with September as it stands, across 434 rows:
 *
 *     67  arrived after 10:30, so the report calls them late
 *     39  checked in and never checked out — the day never closed
 *      9  closed within the hour, which reads as zero
 *      1  has no check-in at all
 *
 * ── ⚠️ WHAT IT DOES NOT TOUCH ─────────────────────────────────────────────
 * An arrival at or before 10:30 is already on time and is left exactly as it
 * was — including the early ones, 08:48 and 09:14. The point is to remove
 * lateness, not to make everybody identical.
 *
 * A check-out that already exists and sits a sensible distance after the
 * arrival is left alone too, including the long evenings — 22:07, 23:34. The
 * owner asked about lateness and about days that never closed; a long day is
 * neither.
 *
 * ── ⚠️ AND IT NEVER CHANGES `check_in_source` ─────────────────────────────
 * A row that came off the reader at the Wah front door still says `device`
 * afterwards. 28 of the late arrivals and 7 of the open days are device scans,
 * and rewriting the time a machine recorded is a real thing to do — so the
 * record keeps saying where it came from, and `edited_by_id` / `edited_at` /
 * `edit_note` say that somebody adjusted it and why. Changing the source to
 * hide the edit would be the one version of this that is dishonest.
 *
 * ── ⚠️ THE NEW TIMES ARE SEEDED, NOT DRAWN ────────────────────────────────
 * From (person, date, slot), so a second run computes the same minutes as the
 * first. That is what makes this safe to re-run, and it means any row can be
 * explained a month later instead of being an unrepeatable accident.
 * ========================================================================= */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';

const FROM = '2026-09-01';
const TO = '2026-09-30';
const IN_FROM = 10 * 60;
const IN_TO = 10 * 60 + 30;
const OUT_FROM = 18 * 60;
const OUT_TO = 18 * 60 + 30;
/* A day shorter than this reads as a mis-tap rather than a day's work. */
const SHORTEST_DAY_MINUTES = 60;

const APPLY = process.argv.includes('--apply');

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

function minuteFor(userId, date, slot, from, to) {
  const hash = createHash('sha256').update(`${userId}|${date}|${slot}`).digest();
  return from + (hash.readUInt32BE(0) % (to - from + 1));
}
const hhmm = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

try {
  const [admin] = await sql`
    select id, full_name from public.users
     where is_active and role in ('admin', 'super_admin')
     order by case when role = 'admin' then 0 else 1 end, created_at limit 1`;
  if (!admin) throw new Error('No active Admin to attribute these edits to.');

  /* ⚠️⚠️ THE TIMES COME BACK AS TEXT, AND THE FIRST DRAFT DID NOT.
     It selected `(checked_in_at at time zone 'Asia/Karachi')` and read the hour
     off the Date with `getUTCHours()`. postgres.js parses a `timestamp without
     time zone` as a LOCAL Date, this machine is in Karachi (UTC+5), and
     `getUTCHours` then took five hours back off it — so 10:23 read as 05:23 and
     the pass found **7 late arrivals instead of 67**. It would have quietly left
     sixty of them alone and reported success.

     `getHours()` would have been right here and wrong anywhere else, which is
     worse: it works until somebody runs this from another timezone. Text from
     `to_char` is the same answer on every machine. */
  const rows = await sql`
    select a.id, a.user_id, a.on_date::text as on_date, u.full_name,
           a.check_in_source::text  as in_src,
           a.check_out_source::text as out_src,
           to_char(a.checked_in_at  at time zone 'Asia/Karachi', 'HH24:MI') as in_text,
           to_char(a.checked_out_at at time zone 'Asia/Karachi', 'HH24:MI') as out_text,
           /* ⚠️ A DAY THEY DO NOT WORK IS NOT NORMALISED — see the loop. */
           (extract(isodow from a.on_date)::int = any (
              case when u.office_team = 'wah'
                then array[1,2,3,4,6,7] else array[1,2,3,4,5,6] end)) as is_working_day
      from public.attendance_days a
      join public.users u on u.id = a.user_id
     where a.on_date between ${FROM} and ${TO}
     order by u.full_name, a.on_date`;

  const minutes = (text) => {
    if (!text) return null;
    const [h, m] = text.split(':').map(Number);
    return h * 60 + m;
  };

  const edits = [];
  const counts = { late: 0, noIn: 0, noOut: 0, tooShort: 0, device: 0 };

  const restDay = [];

  for (const row of rows) {
    /* ⚠️⚠️ A REST-DAY ROW IS LEFT EXACTLY AS IT IS, AND THAT IS THE OPPOSITE OF
       THE OBVIOUS THING. Eight rows sit on a Sunday (or, for the Wah team, a
       Friday) — accidental taps, mostly: one is a check-in with no check-out,
       another lasted under a minute. Both match this pass's rules, so without
       this guard it would "fix" them into full 10:00–18:00 working days and
       turn eight mis-taps into eight people who worked their day off. The owner
       asked for a proper month and said plainly that Sundays are off; these are
       listed at the end for her to decide, not silently completed. */
    if (!row.is_working_day) {
      restDay.push(`${row.full_name} · ${row.on_date} · ${row.in_text ?? '—'}`);
      continue;
    }

    const inAt = minutes(row.in_text);
    const outAt = minutes(row.out_text);

    let newIn = null;
    let newOut = null;
    const why = [];

    if (inAt === null) {
      newIn = minuteFor(row.user_id, row.on_date, 'in', IN_FROM, IN_TO);
      why.push('no check-in was recorded');
      counts.noIn += 1;
    } else if (inAt > IN_TO) {
      newIn = minuteFor(row.user_id, row.on_date, 'in', IN_FROM, IN_TO);
      why.push(`arrival moved from ${hhmm(inAt)} into the on-time window`);
      counts.late += 1;
    }

    const effectiveIn = newIn ?? inAt;

    if (outAt === null) {
      newOut = minuteFor(row.user_id, row.on_date, 'out', OUT_FROM, OUT_TO);
      why.push('the day was never closed');
      counts.noOut += 1;
    } else if (outAt - (effectiveIn ?? 0) < SHORTEST_DAY_MINUTES) {
      newOut = minuteFor(row.user_id, row.on_date, 'out', OUT_FROM, OUT_TO);
      why.push(`departure moved from ${hhmm(outAt)}, which was less than an hour after arriving`);
      counts.tooShort += 1;
    }

    if (newIn === null && newOut === null) continue;
    if (row.in_src === 'device' || row.out_src === 'device') counts.device += 1;

    edits.push({
      id: row.id,
      name: row.full_name,
      on_date: row.on_date,
      was: `${inAt === null ? '  —  ' : hhmm(inAt)} → ${outAt === null ? '  —  ' : hhmm(outAt)}`,
      now: `${hhmm(newIn ?? inAt)} → ${hhmm(newOut ?? outAt)}`,
      src: row.in_src,
      in_local: newIn === null ? null : `${row.on_date} ${hhmm(newIn)}:00`,
      out_local: newOut === null ? null : `${row.on_date} ${hhmm(newOut)}:00`,
      note: `Normalised for September: ${why.join('; ')}.`,
    });
  }

  console.log(`\nSeptember ${FROM} → ${TO} · ${rows.length} records\n`);
  console.log(`  arrived after 10:30            ${counts.late}`);
  console.log(`  never checked out              ${counts.noOut}`);
  console.log(`  closed within the hour         ${counts.tooShort}`);
  console.log(`  had no check-in at all         ${counts.noIn}`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  rows to edit                   ${edits.length}`);
  console.log(`  of those, recorded by a device ${counts.device}\n`);

  for (const e of edits.slice(0, 10)) {
    console.log(`  ${e.name.padEnd(20)} ${e.on_date}  ${e.was}  →  ${e.now}  (${e.src})`);
  }
  if (edits.length > 10) console.log(`  …and ${edits.length - 10} more`);

  if (restDay.length > 0) {
    console.log(`
  Left alone — a record on somebody's day off (${restDay.length}):`);
    for (const line of restDay) console.log(`    ${line}`);
    console.log('  These are not completed into full days. Clear them only if you want them gone.');
  }

  if (!APPLY) {
    console.log('\nDry run. Nothing was written. Re-run with --apply.\n');
  } else if (edits.length === 0) {
    console.log('\nNothing to do.\n');
  } else {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${admin.id}, true)`;
      await tx`
        update public.attendance_days a
           set checked_in_at = coalesce(
                 (e->>'in_local')::timestamp at time zone 'Asia/Karachi', a.checked_in_at),
               checked_out_at = coalesce(
                 (e->>'out_local')::timestamp at time zone 'Asia/Karachi', a.checked_out_at),
               edited_by_id = ${admin.id}::uuid,
               edited_at = now(),
               edit_note = e->>'note'
          from jsonb_array_elements(${tx.json(edits)}::jsonb) e
         where a.id = (e->>'id')::uuid`;
    });

    /* ⚠️ COUNTED IN SQL, NOT IN JAVASCRIPT, for the reason above — and
       restricted to working days, because the rest-day rows were deliberately
       not touched and must not read as a failure. */
    const [after] = await sql`
      select
        /* ⚠️ TRUNCATED TO THE MINUTE, BECAUSE THE PRODUCT IS. dayStatus()
           reads the clock through localMinutes(), which drops seconds, so
           10:30:47 is PRESENT on screen. A bare cast to time, compared against
           10:30, is stricter than the page and flagged three rows the owner has
           never been shown as late. The verification has to ask the same
           question the screen asks, or it fails about something nobody can see.
           (No backticks in this query: it is a JS template literal and one ends
           the string. Fourth time.) */
        count(*) filter (where date_trunc('minute',
          a.checked_in_at at time zone 'Asia/Karachi')::time > time '10:30')::int as late,
        count(*) filter (where a.checked_out_at is null)::int as open_days,
        count(*) filter (where a.checked_in_at is null)::int as no_in,
        count(*) filter (where a.checked_out_at is not null
          and extract(epoch from (a.checked_out_at - a.checked_in_at)) < 3600)::int as too_short
        from public.attendance_days a
        join public.users u on u.id = a.user_id
       where a.on_date between ${FROM} and ${TO}
         and extract(isodow from a.on_date)::int = any (
           case when u.office_team = 'wah'
             then array[1,2,3,4,6,7] else array[1,2,3,4,5,6] end)`;

    console.log(`\n✓ ${edits.length} records edited.`);
    console.log(`  late now ${after.late} · open now ${after.open_days} · `
      + `no check-in now ${after.no_in} · under an hour now ${after.too_short}\n`);

    if (after.late || after.open_days || after.no_in || after.too_short) {
      throw new Error('September still has a late, open or zero-length working day — the pass did not finish.');
    }
  }
} catch (error) {
  console.error('✗', String(error.message ?? error));
  process.exitCode = 1;
} finally {
  await sql.end();
}
