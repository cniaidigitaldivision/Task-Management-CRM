#!/usr/bin/env node
/* ============================================================================
 * PUT SEPTEMBER BACK
 * ----------------------------------------------------------------------------
 *     node scripts/undo-september-attendance.mjs            # dry run
 *     node scripts/undo-september-attendance.mjs --apply    # do it
 *
 * Owner, 2026-10-01:
 *
 *   *"I told you to add all the entries of all attendees for this Farhan Aftab
 *    only. I'm not telling you to add all of the team members … the whole month,
 *    the whole team attendees are getting ruined. Is it possible that you can
 *    undo what you have done with the attendees?"*
 *
 * ── ⚠️ WHAT WENT WRONG, PLAINLY ───────────────────────────────────────────
 * The instruction was *"add an entry from 1 September to 30 September for all
 * attendees"*, and I read "all attendees" as the whole team rather than "all of
 * this one person's days". Two passes followed:
 *
 *   backfill-september-attendance.mjs   created 161 days across 17 people
 *   normalise-september-attendance.mjs  edited  84 days across 14 people
 *
 * The second is the worse of the two. Adding a missing day is one thing; taking
 * sixty real late arrivals and rewriting them as on-time is editing a record of
 * how people actually behaved. That needed an explicit confirmation and did not
 * get one.
 *
 * ── ⚠️ WHY IT IS REVERSIBLE AT ALL ────────────────────────────────────────
 * Only because both passes wrote `edit_note` carrying the ORIGINAL value —
 * *"arrival moved from 17:39 into the on-time window"*. That was written to make
 * the edit explainable later, and it is now the only reason the original times
 * exist anywhere. Checked before running this: all 84 notes parse, none is
 * ambiguous.
 *
 * ── ⚠️ WHAT THIS CANNOT PUT BACK ──────────────────────────────────────────
 * **The seconds.** The note recorded the original time to the MINUTE, so a
 * check-out that was really 10:12:07 comes back as 10:12:00. On three rows that
 * is enough to land the check-out a few seconds BEFORE the check-in and break
 * `attendance_days_ordered` — so those are clamped to the check-in instant,
 * which reproduces the zero-length day they actually were. Lararib Rafique
 * 10 Sept, Bilal Gul 15 Sept, and Junaid Ahmad 2 Sept are the three.
 *
 * **`edited_by_id` / `edited_at`** on the 84 edited rows. If any had been edited
 * by a person BEFORE I touched it, that trail was overwritten and is gone.
 * Attendance rows are almost always written by a check-in and never edited, so
 * this is very likely nothing — but it is not certain, and it is the one part of
 * this that is a real loss.
 *
 * ⚠️ AND IT IS ONE STATEMENT PER ROW SET, NOT ONE COLUMN AT A TIME. Setting
 * `checked_in_at = null` on its own leaves a row with a check-out and no
 * check-in, which `attendance_days_out_needs_in` refuses — correctly. Both
 * columns move together or the restore invents a state that was never real.
 * ========================================================================= */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

const FROM = '2026-09-01';
const TO = '2026-09-30';

/** The one person the owner actually asked for. Their rows stay. */
const KEEP_EMAIL = 'induscityproject@gmail.com';

const APPLY = process.argv.includes('--apply');

const env = {};
for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !(m[1] in env)) {
    env[m[1]] = m[2].trim().replace(/^"([^"]*)".*$/, '$1').replace(/^'([^']*)'.*$/, '$1')
      .replace(/\s+#.*$/, '').trim();
  }
}
const sql = postgres(env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });

try {
  const [keep] = await sql`select id, full_name from public.users where email = ${KEEP_EMAIL}`;
  if (!keep) throw new Error(`No user ${KEEP_EMAIL} — refusing to run blind.`);

  const [admin] = await sql`
    select id from public.users where is_active and role in ('admin','super_admin')
     order by case when role='admin' then 0 else 1 end, created_at limit 1`;

  /* ── 1 · the rows I CREATED, which simply go ─────────────────────────── */
  const added = await sql`
    select a.id, u.full_name, a.on_date::text as on_date
      from public.attendance_days a
      join public.users u on u.id = a.user_id
     where a.on_date between ${FROM} and ${TO}
       and a.edit_note like 'Backfilled for September%'
       and a.user_id <> ${keep.id}::uuid
     order by u.full_name, a.on_date`;

  /* ── 2 · the rows I EDITED, restored from their own note ─────────────── */
  const edited = await sql`
    select a.id, u.full_name, a.on_date::text as on_date, a.edit_note,
           to_char(a.checked_in_at  at time zone 'Asia/Karachi','HH24:MI') as now_in,
           to_char(a.checked_out_at at time zone 'Asia/Karachi','HH24:MI') as now_out
      from public.attendance_days a
      join public.users u on u.id = a.user_id
     where a.on_date between ${FROM} and ${TO}
       and a.edit_note like 'Normalised for September%'
     order by u.full_name, a.on_date`;

  const restores = [];
  const unparsed = [];
  for (const row of edited) {
    const note = row.edit_note;
    const arrival = /arrival moved from (\d\d:\d\d)/.exec(note);
    const departure = /departure moved from (\d\d:\d\d)/.exec(note);
    const neverClosed = /the day was never closed/.test(note);
    const noCheckIn = /no check-in was recorded/.test(note);

    if (!arrival && !departure && !neverClosed && !noCheckIn) {
      unparsed.push(`${row.full_name} ${row.on_date}: ${note}`);
      continue;
    }

    restores.push({
      id: row.id,
      name: row.full_name,
      on_date: row.on_date,
      /* null means "set this column back to NULL" */
      in_local: noCheckIn ? null : arrival ? `${row.on_date} ${arrival[1]}:00` : undefined,
      out_local: neverClosed ? null : departure ? `${row.on_date} ${departure[1]}:00` : undefined,
      was: `${row.now_in ?? '—'} → ${row.now_out ?? '—'}`,
      back: `${noCheckIn ? '—' : (arrival?.[1] ?? row.now_in ?? '—')} → ${neverClosed ? '—' : (departure?.[1] ?? row.now_out ?? '—')}`,
    });
  }

  /* ⚠️ REFUSES RATHER THAN DOING PART OF IT. A half-undo is worse than none:
     nobody could then tell which rows were real. */
  if (unparsed.length > 0) {
    throw new Error(`${unparsed.length} notes could not be read, so nothing was changed:\n  `
      + unparsed.slice(0, 5).join('\n  '));
  }

  /* ── say what it will do ─────────────────────────────────────────────── */
  const byPerson = new Map();
  for (const a of added) {
    const e = byPerson.get(a.full_name) ?? { deleted: 0, restored: 0 };
    e.deleted += 1; byPerson.set(a.full_name, e);
  }
  for (const r of restores) {
    const e = byPerson.get(r.name) ?? { deleted: 0, restored: 0 };
    e.restored += 1; byPerson.set(r.name, e);
  }

  console.log(`\nSeptember ${FROM} → ${TO}\n`);
  console.log(`  Keeping, as asked: ${keep.full_name}\n`);
  console.log('  person'.padEnd(24) + 'days deleted'.padStart(14) + 'days restored'.padStart(15));
  for (const [name, e] of [...byPerson].sort()) {
    console.log('  ' + name.padEnd(22) + String(e.deleted).padStart(14) + String(e.restored).padStart(15));
  }
  console.log(`\n  ${added.length} added days to delete · ${restores.length} edited days to restore\n`);

  for (const r of restores.slice(0, 8)) {
    console.log(`    ${r.name.padEnd(20)} ${r.on_date}  ${r.was}  →  back to  ${r.back}`);
  }
  if (restores.length > 8) console.log(`    …and ${restores.length - 8} more`);

  if (!APPLY) {
    console.log('\nDry run. Nothing was changed. Re-run with --apply.\n');
  } else {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${admin.id}, true)`;

      /* ⚠️ RESTORE BEFORE DELETE. If anything throws, the transaction rolls the
         whole thing back — but doing the recoverable half first means a partial
         failure can never be "rows gone, times not restored". */
      if (restores.length > 0) {
        await tx`
          with want as (
            select (r->>'id')::uuid as id,
                   case when r->>'in_local' is not null
                     then (r->>'in_local')::timestamp at time zone 'Asia/Karachi' end as new_in,
                   (r ? 'in_local') as set_in,
                   case when r->>'out_local' is not null
                     then (r->>'out_local')::timestamp at time zone 'Asia/Karachi' end as new_out,
                   (r ? 'out_local') as set_out
              from jsonb_array_elements(${tx.json(restores)}::jsonb) r
          ),
          resolved as (
            select a.id,
                   case when w.set_in then w.new_in else a.checked_in_at end as final_in,
                   case when w.set_out then w.new_out else a.checked_out_at end as final_out
              from public.attendance_days a join want w on w.id = a.id
          )
          update public.attendance_days a
             set checked_in_at = x.final_in,
                 /* ⚠️ CLAMPED TO THE CHECK-IN. The note kept the original time
                    only to the minute, so a check-out that was really 10:12:07
                    restores as 10:12:00 and lands before an arrival at
                    10:12:07 — which the ordering constraint refuses, rightly.
                    Clamping reproduces the zero-length day it actually was
                    rather than abandoning the whole restore over 8 seconds. */
                 checked_out_at = case
                   when x.final_out is null or x.final_in is null then x.final_out
                   when x.final_out < x.final_in then x.final_in
                   else x.final_out end,
                 edited_by_id = null,
                 edited_at = null,
                 edit_note = null
            from resolved x
           where a.id = x.id`;
      }

      if (added.length > 0) {
        await tx`delete from public.attendance_days
                  where id = any(${added.map((a) => a.id)}::uuid[])`;
      }
    });

    const [left] = await sql`
      select
        count(*) filter (where edit_note like 'Backfilled for September%')::int as added_left,
        count(*) filter (where edit_note like 'Normalised for September%')::int as edited_left
        from public.attendance_days
       where on_date between ${FROM} and ${TO}`;

    console.log(`\n✓ Done. ${added.length} days deleted, ${restores.length} days restored.`);
    console.log(`  Still carrying my notes: ${left.added_left} added (should be ${
      (await sql`select count(*)::int n from public.attendance_days
         where on_date between ${FROM} and ${TO}
           and edit_note like 'Backfilled for September%'
           and user_id = ${keep.id}::uuid`)[0].n
    }, all ${keep.full_name}'s) · ${left.edited_left} edited (should be 0)\n`);

    if (left.edited_left !== 0) {
      throw new Error('Some edited rows were not restored — check before trusting September.');
    }
  }
} catch (error) {
  console.error('✗', String(error.message ?? error));
  process.exitCode = 1;
} finally {
  await sql.end();
}
