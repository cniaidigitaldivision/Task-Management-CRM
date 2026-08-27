/* ============================================================================
 * A MONTH OF POSTS, SO THE CALENDAR HAS SOMETHING TO DRAW
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24: *"First of all go and check in the database whether any
 * related data is present or not. If not then add dummy data for posting… Don't
 * add it on all days. Add random days: some days with some, some days with none,
 * and some days with absent. That way I can easily differentiate whether the
 * things are working fine or not."*
 *
 * ── WHAT WAS ALREADY THERE, SINCE THAT WAS THE FIRST INSTRUCTION ─────────────
 * GC Royal had SEVEN deliverables, all `done`, all with real Facebook and
 * Instagram placement URLs — but bunched onto 3–7 August plus the 24th, and with
 * `due_time` NULL on every single one. So the calendar was not empty because the
 * feature was broken; it was nearly empty because the data was thin, and the
 * mockup's "09:00 AM" had nothing to render from. Those rows are left alone.
 *
 * ── ⚠️ THE SPREAD IS THE POINT, NOT THE VOLUME ──────────────────────────────
 * A month where every day has two posts proves nothing: it looks identical
 * whether the grid is reading the data or drawing a fixed pattern. So this seeds
 * four distinguishable shapes on purpose, and the owner can tell them apart at a
 * glance:
 *
 *   busy days    two or three posts, different platforms and times
 *   light days   exactly one
 *   empty days   nothing at all, deliberately left blank
 *   MISSED days  in the past, still not done — the case a calendar exists to show
 *
 * ── WHY THE DATES ARE COMPUTED AND NOT LISTED ───────────────────────────────
 * `--month` defaults to the month the clock is in, so running this in September
 * seeds September. A hard-coded list of dates is a seed that silently produces an
 * empty calendar the moment the month rolls over.
 *
 * ── ⚠️ WHY IT DOES NOT USE `Math.random()` ──────────────────────────────────
 * "Random days" needs to be reproducible: run it twice and it must decide the same
 * thing, or `--remove` cannot find what it made and a second run doubles up. The
 * shapes below are picked by day-of-month arithmetic, which looks arbitrary and is
 * not.
 *
 *   node scripts/seed-posting-month.mjs                 # this month
 *   node scripts/seed-posting-month.mjs --month 2026-09
 *   node scripts/seed-posting-month.mjs --remove        # take them back out
 * ========================================================================= */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postgres from 'postgres';

/** ⚠️ `/\r?\n/`, not `'\n'` — .env.local has CRLF endings on this machine and
 *  splitting on the newline alone leaves a `\r` on every value. Same parser as
 *  scripts/migrate.mjs, which had already solved it. */
function readEnvLocal() {
  const env = {};
  let raw;
  try {
    raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  } catch {
    console.error('✗ .env.local not found.');
    process.exit(1);
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = readEnvLocal();
if (!env.DATABASE_URL) {
  console.error('✗ DATABASE_URL is not set in .env.local');
  process.exit(1);
}

const argv = process.argv.slice(2);
const remove = argv.includes('--remove');
const monthArg = argv[argv.indexOf('--month') + 1];
const month =
  argv.includes('--month') && /^\d{4}-\d{2}$/.test(monthArg ?? '')
    ? monthArg
    : new Date().toISOString().slice(0, 7);

/** Everything this script creates carries this, so `--remove` is exact and can
 *  never touch a real task. */
const MARK = '[demo]';

const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/* ── THE FOUR SHAPES ──────────────────────────────────────────────────────────
   `slot` decides what a given day looks like. The arithmetic is deliberately
   uneven so the month does not read as a repeating pattern. */
function shapeFor(day) {
  if (day % 7 === 3 || day % 11 === 5) return 'empty'; // nothing at all
  if (day % 5 === 0) return 'busy'; // three posts
  if (day % 3 === 0) return 'light'; // one post
  if (day % 4 === 1) return 'pair'; // two posts
  return 'empty';
}

/* Platform, content kind, time and what it is called. Cycled by index so a busy
   day gets three DIFFERENT platforms rather than three Instagram posts. */
const SLOTS = [
  { platform: 'instagram', kind: 'static', label: 'Instagram post', time: '09:00' },
  { platform: 'facebook', kind: 'static', label: 'Facebook post', time: '14:00' },
  { platform: 'linkedin', kind: 'static', label: 'LinkedIn post', time: '11:00' },
  { platform: 'tiktok', kind: 'video', label: 'TikTok video', time: '16:00' },
  { platform: 'instagram', kind: 'story', label: 'Instagram story', time: '18:00' },
  { platform: 'instagram', kind: 'reel', label: 'Instagram reel', time: '10:30' },
  { platform: 'facebook', kind: 'reel', label: 'Facebook reel', time: '15:00' },
  { platform: 'linkedin', kind: 'carousel', label: 'LinkedIn carousel', time: '12:00' },
];

/** A plausible-looking public URL. Not real, and the owner said so explicitly:
 *  *"make sure that some random URL is put there. Whether it's not working or not,
 *  it does not have a problem."* The shape is right so the link renders and opens;
 *  what it opens is a 404, which is the honest cost of demo data. */
function demoUrl(platform, date, index) {
  const token = `${date.replace(/-/g, '')}${index}`;
  switch (platform) {
    case 'instagram':
      return `https://www.instagram.com/p/DEMO${token}/`;
    case 'facebook':
      return `https://www.facebook.com/gcroyalemporium/posts/${token}`;
    case 'linkedin':
      return `https://www.linkedin.com/feed/update/urn:li:activity:${token}`;
    default:
      return `https://www.tiktok.com/@gcroyal/video/${token}`;
  }
}

const sql = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 20,
});

try {
  const [project] = await sql`
    select id, name, code from public.projects where name ilike ${'%GC Royal%'} limit 1
  `;
  if (!project) throw new Error('No project matching "GC Royal".');

  const [author] = await sql`
    select id, full_name from public.users
     where is_active and role in ('admin','super_admin') order by role limit 1
  `;
  if (!author) throw new Error('No active admin to record as the author.');

  console.log(`\nProject: ${project.name}   Month: ${month}   Author: ${author.full_name}\n`);

  if (remove) {
    const gone = await sql`
      delete from public.tasks
       where project_id = ${project.id} and title like ${'%' + MARK}
      returning title
    `;
    console.log(gone.length ? `Removed ${gone.length} demo tasks.` : 'Nothing to remove.');
    await sql.end({ timeout: 5 });
    process.exit(0);
  }

  /* Platform ids up front — one lookup rather than one per post. */
  const platformRows = await sql`select id, slug from public.platforms`;
  const platformId = new Map(platformRows.map((r) => [r.slug, r.id]));

  const today = new Date().toISOString().slice(0, 10);
  const total = daysInMonth(month);
  let made = 0;
  const summary = { busy: 0, light: 0, pair: 0, empty: 0, missed: 0 };

  for (let day = 1; day <= total; day += 1) {
    const shape = shapeFor(day);
    if (shape === 'empty') {
      summary.empty += 1;
      continue;
    }

    const count = shape === 'busy' ? 3 : shape === 'pair' ? 2 : 1;
    const date = `${month}-${pad(day)}`;
    const past = date < today;

    /* ⚠️ SOME PAST DAYS ARE LEFT UNDONE ON PURPOSE. A month where every past post
       is `done` cannot show the one thing the owner asked to be able to see — the
       difference between delivered, pending and missed. Every third past day is
       left `in_progress` so it reads as overdue. */
    const missed = past && day % 3 === 0;
    const status = past ? (missed ? 'in_progress' : 'done') : 'todo';
    if (missed) summary.missed += 1;
    summary[shape] += 1;

    for (let i = 0; i < count; i += 1) {
      const slot = SLOTS[(day + i * 3) % SLOTS.length];
      const [{ next_reference: reference }] = await sql`
        select app.next_reference(${project.code}) as next_reference
      `;

      /* ⚠️ completed_at is NOT optional for a done task. The constraint
         tasks_completed_at_matches_status makes status=done and completed_at an
         if-and-only-if, so a done row without a stamp is refused AND a pending row
         with one is refused. Taken from the due date rather than now(), so a post
         dated the 5th reads as completed on the 5th rather than today. */
      const [task] = await sql`
        insert into public.tasks
          (reference, title, project_id, created_by_id, effort_points,
           content_kind, due_date, due_time, status, completed_at, description)
        values (
          ${reference},
          ${`${slot.label} — ${day} ${month} ${MARK}`},
          ${project.id}, ${author.id}, 1,
          ${slot.kind}::public.content_kind,
          ${date}, ${slot.time},
          ${status}::public.task_status,
          ${status === 'done' ? date + 'T' + slot.time + ':00Z' : null},
          ${'Demo data for the posting calendar. Safe to delete.'}
        )
        returning id
      `;

      /* The placement is what makes the platform icon and the link appear. Only
         on a post that actually went out — a pending one has nothing published. */
      const pid = platformId.get(slot.platform);
      if (pid && status === 'done') {
        /* ⚠️ `published_on`, not `published_at` — it is a DATE. And placements
           carry their own `content_kind`, so a task with a reel on Instagram and a
           static on Facebook can say so per platform. */
        await sql`
          insert into public.task_placements (task_id, platform_id, content_kind, url, published_on)
          values (${task.id}, ${pid}, ${slot.kind}::public.content_kind,
                  ${demoUrl(slot.platform, date, i)}, ${date})
        `;
      } else if (pid) {
        /* Planned, not published: the platform is known, the URL is not yet. */
        await sql`
          insert into public.task_placements (task_id, platform_id, content_kind)
          values (${task.id}, ${pid}, ${slot.kind}::public.content_kind)
        `;
      }
      made += 1;
    }
  }

  console.log(`${made} demo posts across ${month}:`);
  console.log(`  busy days (3 posts):  ${summary.busy}`);
  console.log(`  pair days (2 posts):  ${summary.pair}`);
  console.log(`  light days (1 post):  ${summary.light}`);
  console.log(`  empty days:           ${summary.empty}`);
  console.log(`  of the past days, ${summary.missed} left undone so they read as missed`);
  console.log(`\nRemove them again with:  node scripts/seed-posting-month.mjs --remove`);

  await sql.end({ timeout: 5 });
  process.exit(0);
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
