/* ============================================================================
 * THREE MONTHS OF WORK ACROSS THE DIVISION, BUILT TO SHOW DIFFERENCES
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24:
 *
 *   "I want the same type of data put in the Danyal marketing project and also in
 *    the CNI project… plus the AI digital project… Make sure that all the members
 *    who are present in the database also engage. Everyone should engage so I can
 *    see the performance differences: who did how many tasks, who did how much
 *    posting, which platform or which project is progressively showing good input,
 *    having regular posting, and whose progress is improving, which project is
 *    lacking… the data should be accurate. Logically implement."
 *
 * ── ⚠️ THE DIFFERENCES ARE DESIGNED, NOT RANDOM ─────────────────────────────
 * Random data proves nothing: a report over noise looks the same as a report over a
 * bug. So each project gets a PROFILE with a story a report should be able to tell,
 * and each person gets a reliability, so "who is performing" has an answer to check
 * the reports against:
 *
 *   GC Royal Emporium     strong and IMPROVING     72% → 86% → 96%
 *   Daniyal Marketing     steady and RELIABLE      88% → 87% → 89%
 *   AI & Digital Division RECOVERING from bad      41% → 63% → 88%
 *   Taskly Automation     LACKING throughout       35% → 30% → 38%
 *
 * `CNI Website` is deliberately left alone — the owner said *"not the CNI
 * website"*.
 *
 * ⚠️ "the CNI project" WAS AMBIGUOUS. There is no project named CNI; the candidates
 * were `AI & Digital Division` and `Taskly Automation`, and the owner named the
 * first separately in the same sentence. Both are seeded, so whichever was meant is
 * covered, and both are internal so neither is a client-facing surprise.
 *
 * ── ⚠️ THREE THINGS HAD TO BE SET UP BEFORE ANY POST COULD BE COHERENT ──────
 * Checked before writing anything, and this is why the script is longer than a loop:
 *
 *   1. `AI & Digital Division` and `Taskly Automation` had NO PLATFORMS. Posting to
 *      a platform a project does not manage is data that contradicts itself, and
 *      the report's platform table would show shares of nothing.
 *   2. `Taskly Automation` had NO CADENCE, so its target is 0 and "achieved vs
 *      target" cannot be read. A project that is "lacking" needs a target to fall
 *      short OF.
 *   3. `Daniyal Marketing` had ONE member. "Everyone should engage" is impossible
 *      while five of six people are not on the project, and assigning work to a
 *      non-member would be a row no screen can explain.
 *
 * All three are created idempotently and only where missing.
 *
 * ── ⚠️ WHY `published_on` IS NEVER WRITTEN DIRECTLY ─────────────────────────
 * Migration 055 put a trigger on `task_placements` that sets `tasks.published_on`
 * to the earliest published placement. So this script records placements and lets
 * the trigger do it — which also means the seeded data exercises the fix rather
 * than sidestepping it. Writing both by hand would let them disagree, which is
 * exactly the bug 055 exists to prevent.
 *
 * ── REPRODUCIBLE, NOT RANDOM ────────────────────────────────────────────────
 * No `Math.random()`. A seeded counter drives every choice, so two runs decide the
 * same thing, `--remove` finds exactly what was made, and a number in a report can
 * be traced back to a rule rather than to luck.
 *
 *   node scripts/seed-demo-workload.mjs           # three months, all four projects
 *   node scripts/seed-demo-workload.mjs --remove  # every [demo] task, everywhere
 * ========================================================================= */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postgres from 'postgres';

/** ⚠️ `/\r?\n/` — .env.local is CRLF here. Same parser as scripts/migrate.mjs. */
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

const remove = process.argv.includes('--remove');
/* ⚠️ THE SAME MARK `scripts/seed-posting-month.mjs` USES, ON PURPOSE.
   So `--remove` here clears that script's rows too — it did, once, without being
   asked to, and the posting calendar went briefly empty. Kept shared rather than
   split because the owner’s reason for wanting a remove at all was *"After my
   testing when I deploy this project, I have to delete all these data"*, and for
   that one sweep is the point. Two marks would mean remembering two commands and
   shipping whichever one you forgot.

   Nothing real is ever at risk: only titles ENDING in this are deleted, and no
   hand-created task ends in it. */
const MARK = '[demo]';

/* ── THE MONTHS ──────────────────────────────────────────────────────────────
   Three, ending with the current one, so a trend has somewhere to go. The current
   month is only seeded up to today: a report claiming posts published next week
   would be the least believable thing on the screen. */
const now = new Date();
const MONTHS = [-2, -1, 0].map((offset) => {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
});
const TODAY = now.toISOString().slice(0, 10);

/* ── THE PROJECT PROFILES ────────────────────────────────────────────────────
   `rate` is the share of planned posts that actually went out, per month, oldest
   first. `perWeek` is how many posts a week the project attempts — the volume,
   kept separate from the reliability so a busy-but-sloppy project and a
   quiet-but-perfect one are both expressible. */
const PROFILES = [
  {
    match: 'GC Royal',
    story: 'strong, improving',
    perWeek: 5,
    rate: [0.72, 0.86, 0.96],
    platforms: ['facebook', 'instagram', 'linkedin'],
    cadence: { staticPerDay: 1, reelsPerWeek: 1 },
  },
  {
    match: 'Daniyal Marketing',
    story: 'steady, reliable',
    perWeek: 4,
    /* Owner, mid-run: *"kashif is team coodinator but he is manageing daniyal
       marketing pages also"*. His `share` in PEOPLE is division-wide; running one
       project’s pages is a DIFFERENT fact, and a global share cannot say it — it
       would just make him busier everywhere. So the profile names the person and
       the pool below weights them inside this project only. The report should then
       read "Kashif owns Daniyal Marketing" rather than "Kashif is busy". */
    pagesRunBy: 'Kashif',
    rate: [0.88, 0.87, 0.89],
    platforms: ['facebook', 'instagram', 'tiktok'],
    cadence: { staticPerDay: 1, reelsPerWeek: 1 },
  },
  {
    match: 'AI & Digital Division',
    story: 'recovering',
    perWeek: 3,
    rate: [0.41, 0.63, 0.88],
    platforms: ['facebook', 'instagram', 'linkedin'],
    cadence: { staticPerDay: 1, reelsPerWeek: 1 },
  },
  {
    match: 'Taskly Automation',
    story: 'lacking',
    perWeek: 3,
    rate: [0.35, 0.3, 0.38],
    platforms: ['linkedin', 'x'],
    cadence: { staticPerDay: 1, reelsPerWeek: 0 },
  },
];

/* ── THE PEOPLE ──────────────────────────────────────────────────────────────
   `share` is how much of the work they get; `reliability` is how much of it they
   finish. Two different numbers on purpose: a person can carry a lot and drop
   some, or carry little and never miss, and a performance report should be able to
   tell those apart. Matched on name so ids are never hard-coded. */
const PEOPLE = [
  { match: 'Kashif', share: 4, reliability: 0.95, role: 'manager' },
  { match: 'Najmulla', share: 3, reliability: 0.9, role: 'content' },
  { match: 'Lareeb', share: 3, reliability: 0.62, role: 'design' },
  /* A test account, not a colleague — so: present, engaged, and unambiguously the
     weakest. It was 0.45, which put it at 50% against Lareeb's 0.62 at 35% on a
     third of the sample. Two people out of reliability order is exactly the kind
     of thing that gets read off a report as a real finding, and here it would have
     been an artefact of n=18. 0.30 leaves no room for the sample size to invert it. */
  { match: 'Testing', share: 1, reliability: 0.3, role: 'other' },
  /* ⚠️ share 0 — CTO, for the same reason as the CEO below.
     Owner, mid-run: *"and admin ummehabiba is CTO"*. Same correction, same fix.
     With both executives out of content, the delivery roster is Kashif (team
     coordinator), Najmulla, Lareeb and Testing — which is EXACTLY the set of
     non-executive active users in the database. So "everyone engages" is now
     satisfied by the org chart rather than in spite of it, and the oversight pass
     further down gives both executives real, non-posting work so neither reads as
     idle. */
  { match: 'Habiba', share: 0, reliability: 0.88, role: 'manager' },
  /* ⚠️ share 0 — THE CEO IS NOT A DELIVERY RESOURCE.
     Owner, mid-run: *"Ammar is ceo"*. He was seeded at share 1 and came out of a
     run with 14 of 21 posts published, sitting in the BY PERSON table between two
     designers. That is the one row in this whole dataset that would discredit the
     rest of it: the report exists to be put in front of him, and it opened by
     claiming he personally shipped fourteen Instagram statics.

     share 0 means the weighted pool below repeats him zero times, so he is never
     assigned content — but he stays in `roster`, so he is still added as a MEMBER
     of all four projects and still appears in the team and access views. The
     project_role enum has no owner/lead value (migration 033: manager, content,
     design, development, ads, video, other), so `manager` is the nearest thing to
     oversight it can express.

     He will therefore read as 0 assigned in every per-person view. That is the
     accurate answer for a CEO, not a gap in the data. */
  { match: 'Ammar', share: 0, reliability: 1.0, role: 'manager' },
];

/** The share given to whoever runs a project’s pages, inside that project only.
 *  10 against the other three delivering people’s 3 + 3 + 1 puts them at roughly
 *  sixty per cent of that project — a clear majority that still leaves the rest of
 *  the team visibly present, rather than a project that is one person’s alone. */
const PAGES_OWNER_SHARE = 10;

const KINDS = ['static', 'static', 'static', 'reel', 'carousel', 'story', 'static', 'video'];

/** What an executive actually does on a project. Deliberately none of them a post:
 *  these become tasks with a NULL content_kind, so they are work without being
 *  content. See the oversight pass for why that distinction is load-bearing. */
const OVERSIGHT = [
  'Monthly performance review',
  'Client check-in call',
  'Content strategy sign-off',
  'Budget and ad spend review',
  'Quarterly roadmap alignment',
];

/* ── ⚠️ MULBERRY32, NOT A TEXTBOOK LCG ───────────────────────────────────────
   Reproducible, still — see the header. But the first version used the classic
   `tick * 1103515245 + 12345` LCG and took `% list.length` off it, and that LCG's
   LOW BITS are famously non-random: with a 14-entry weighted pool (14 = 2 × 7) one
   person was selected ZERO times out of 185 draws. The bug looked like a design
   choice — "Ammar has a small share" — which is the worst kind.

   Mulberry32 mixes before it returns, so the low bits are as good as the high
   ones and a modulo is safe. Seeded to a constant so runs are identical. */
let tick = 0x9e3779b9;
const next = () => {
  tick = (tick + 0x6d2b79f5) | 0;
  let t = tick;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * A stable 0…1 derived from a STRING rather than from stream position.
 *
 * FNV-1a, then the same avalanche mulberry32 uses so the low bits are usable. Used
 * for every decision where the ANSWER must not depend on how many other decisions
 * came first — see the delivery gate for what goes wrong when it does.
 */
const hash01 = (key) => {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
};
/** A stable integer in [0, n). ⚠️ Its own function BECAUSE `next()` returns a
   FLOAT: swapping the LCG for mulberry32 turned every `next() % n` in this script
   into a fraction, and three of them broke silently — the hour became "9.37" and
   produced an unparseable timestamp, the volume gate stopped skipping any day, and
   the not-delivered status was always the same value. A float and an int drawn from
   one function is how that happens twice. */
const nextInt = (n) => Math.floor(next() * n) % n;
const pick = (list) => list[nextInt(list.length)];
/* ⚠️ There is deliberately NO `roll()` here any more. It was `() => next()`, and
   every probability question in this script went through it — which is exactly how
   the stride correlation described at the delivery gate got in. `next()` now feeds
   nothing but `nextInt`, i.e. cosmetic choices where order genuinely doesn't
   matter; anything whose ANSWER matters goes through `hash01` instead. */

const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

function demoUrl(slug, date, i) {
  const token = `${date.replace(/-/g, '')}${i}`;
  if (slug === 'instagram') return `https://www.instagram.com/p/DEMO${token}/`;
  if (slug === 'facebook') return `https://www.facebook.com/demo/posts/${token}`;
  if (slug === 'linkedin') return `https://www.linkedin.com/feed/update/urn:li:activity:${token}`;
  if (slug === 'tiktok') return `https://www.tiktok.com/@demo/video/${token}`;
  return `https://x.com/demo/status/${token}`;
}

const sql = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 20,
});

try {
  if (remove) {
    const gone = await sql`
      delete from public.tasks where title like ${'%' + MARK} returning id
    `;
    console.log(`\nRemoved ${gone.length} demo task(s) across every project.`);
    console.log('Platforms, cadences and memberships added by this script are LEFT IN');
    console.log('PLACE — they are configuration rather than demo rows, and removing a');
    console.log("project's platforms would break its real data too.\n");
    await sql.end({ timeout: 5 });
    process.exit(0);
  }

  const users = await sql`select id, full_name, role from public.users where is_active`;
  const platformRows = await sql`select id, slug from public.platforms`;
  const platformId = new Map(platformRows.map((r) => [r.slug, r.id]));

  const roster = PEOPLE.map((p) => {
    const row = users.find((u) => u.full_name.includes(p.match));
    return row ? { ...p, id: row.id, name: row.full_name } : null;
  }).filter(Boolean);

  if (roster.length === 0) throw new Error('No matching users found.');

  const [admin] = await sql`
    select id from public.users where is_active and role in ('super_admin','admin') limit 1
  `;

  console.log(`\nPeople engaged: ${roster.map((r) => r.name).join(', ')}\n`);

  const report = [];
  let oversightMade = 0;

  for (const profile of PROFILES) {
    const [project] = await sql`
      select id, name, code, static_posts_per_day, reels_per_week
        from public.projects where name ilike ${'%' + profile.match + '%'} limit 1
    `;
    if (!project) {
      console.log(`  ! no project matching "${profile.match}" — skipped`);
      continue;
    }

    /* ── 1. PLATFORMS. Only where the project has none: a project that already
          names its channels has been configured by a person and must not be
          overwritten by a seed. */
    const existing = await sql`
      select count(*)::int as n from public.project_platforms where project_id = ${project.id}
    `;
    if (existing[0].n === 0) {
      for (const slug of profile.platforms) {
        const pid = platformId.get(slug);
        if (pid) {
          await sql`
            insert into public.project_platforms (project_id, platform_id)
            values (${project.id}, ${pid})
            on conflict do nothing
          `;
        }
      }
      console.log(`  + ${project.name}: platforms set to ${profile.platforms.join(', ')}`);
    }

    /* ── 2. CADENCE. Only where absent — the target is what "lacking" is measured
          against, and a null cadence makes every target 0. */
    if (project.static_posts_per_day === null) {
      await sql`
        update public.projects
           set static_posts_per_day = ${profile.cadence.staticPerDay},
               reels_per_week = ${profile.cadence.reelsPerWeek},
               /* ⚠️ Cast in SQL. postgres.js sends a JS number array as text[],
                  and these columns are smallint[] — Postgres refuses the implicit
                  conversion rather than guessing. */
               posting_days = ${[1, 2, 3, 4, 5]}::smallint[],
               reel_days = ${[3]}::smallint[]
         where id = ${project.id}
      `;
      console.log(
        `  + ${project.name}: cadence set to ${profile.cadence.staticPerDay}/day, ${profile.cadence.reelsPerWeek} reel(s)/week`,
      );
    }

    /* ── 3. MEMBERSHIP. Everybody, so everybody can be assigned work. */
    for (const person of roster) {
      await sql`
        insert into public.project_members (project_id, user_id, role, added_by_id)
        values (${project.id}, ${person.id}, ${person.role}::public.project_role, ${admin.id})
        on conflict (project_id, user_id) do nothing
      `;
    }

    /* ── 4. THE WORK ─────────────────────────────────────────────────────────
          Posts on weekdays only, `perWeek` of them, spread by the counter. Each is
          assigned to somebody by their share, and whether it got DONE depends on
          both the project's month rate and that person's reliability — so a weak
          month and a weak person compound, which is what makes the report's
          per-person and per-project views tell different stories. */
    const perProject = { planned: 0, done: 0, byPerson: new Map() };

    for (const [monthIndex, month] of MONTHS.entries()) {
      const rate = profile.rate[monthIndex];
      const total = daysInMonth(month);

      for (let day = 1; day <= total; day += 1) {
        const date = `${month}-${pad(day)}`;
        if (date > TODAY) continue; // never publish into the future

        const weekday = new Date(Date.UTC(...date.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))))).getUTCDay();
        if (weekday === 0 || weekday === 6) continue; // weekdays only

        /* ── ⚠️ VOLUME IS EXACT; ONLY DELIVERY IS RANDOM ────────────────────
           This gate used to be `nextInt(5) >= profile.perWeek` — a coin flip per
           day. It made the one number the owner reads as EFFORT depend on luck:
           Taskly Automation and AI & Digital have the identical `perWeek: 3` and
           came out of a run with 4 and 10 posted days in the same month. A report
           that says one project attempted less than half as much as another, when
           the seed asked both for the same, is not "dummy data showing the
           differences" — it is noise the owner would read as a real finding.

           So the week is a rota: `perWeek` of the five weekdays, every week,
           exactly. Rotating by the week of the month means it is not "always
           Monday" — the day that gets skipped moves — while the COUNT stays fixed.

           This leaves the two dimensions independent, which is the whole point:
             volume    = perWeek       exact, comparable, the project’s commitment
             delivery  = rate × person  random, the story of who kept up
           A project can now be busy and unreliable, or quiet and dependable, and
           the report can tell those two apart. */
        const weekOfMonth = Math.floor((day - 1) / 7);
        if ((weekday - 1 + weekOfMonth) % 5 >= profile.perWeek) continue;

        /* Weighted pick: repeat each person `share` times in the pool. Whoever
           runs this project’s pages gets `PAGES_OWNER_SHARE` instead of their
           division-wide share, so they take the clear majority of it — and share 0
           still means zero, which is what keeps the two executives out. */
        const pool = roster.flatMap((p) => {
          const share = p.share === 0 ? 0 : p.match === profile.pagesRunBy ? PAGES_OWNER_SHARE : p.share;
          return Array.from({ length: share }, () => p);
        });
        const person = pick(pool);
        const kind = pick(KINDS);
        const slug = pick(profile.platforms);
        const hour = 9 + nextInt(9);
        const time = `${pad(hour)}:${pick(['00', '15', '30', '45'])}`;

        /* ── ⚠️ ONE DRAW AGAINST A PRODUCT. NOT TWO DRAWS. ─────────────────
           This started as two independent gates:

               roll() < rate && roll() < person.reliability          ✗

           which is wrong, and it is worth being exact about WHY, because the fix
           below looks like the same arithmetic. Two draws multiply the two
           probabilities AND square the variance — a day could fail the person gate
           while passing the project gate, so a run of bad luck on one roster member
           dragged a project’s number down independently of its own rate. GC Royal’s
           designed 0.96 month landed at 69% across three months and Daniyal
           Marketing, designed LOWER, outranked it at 76%. The story inverted.

           The overcorrection was `rate * (0.7 + 0.3 * reliability)` — one draw, but
           the person could only move the result by 30% while `rate` spans 0.30 to
           0.96, better than 3×. So the project swamped the person completely, and
           the BY PERSON table stopped meaning anything: Ammar, designed at 1.00,
           the most reliable person in the roster, came out bottom-equal at 53%, and
           Kashif at 0.95 ranked below Lareeb at 0.62. Whoever drew the most Taskly
           Automation days looked worst, whatever their reliability.

           So: ONE draw, against the plain product. Both factors span their full
           range and neither hides the other —

             project %  ≈ rate × 0.83   (share-weighted mean reliability)
             person  %  ≈ 0.72 × reliability   (volume-weighted mean project rate)

           which keeps all four project stories separated AND puts the roster back
           in reliability order. The owner asked to see both at once: *"who did how
           many tasks, who did how much posting… which project is lacking so I can
           see the differentiation between them easily."* One number cannot be read
           two ways unless both inputs actually reach it. */
        const effective = rate * person.reliability;

        /* ── ⚠️ HASHED, NOT PULLED FROM THE SHARED STREAM ───────────────────
           This was `roll() < effective`, and it produced Testing at 0 of 16
           published against a designed ~30% — odds of about 1 in 500 — right after
           the same script had produced Ammar at 0 of 185. Two "unlucky" zeroes on
           the two smallest shares is not luck, it is structure:

           mulberry32 here is COUNTER-based (tick += a constant), so its outputs are
           a fixed function of position in the stream. Each selected day consumes a
           FIXED stride of draws — person, kind, platform, hour, minute, delivery —
           so the delivery draw always sits a constant distance behind the person
           draw. A constant offset into a counter-based generator is not an
           independent sample: certain person indices land on reliably high delivery
           values. And it self-reinforces — a person who never delivers never
           consumes the extra status draw, so THEIR stride never varies, locking the
           correlation in for the whole run.

           Hashing the identifying tuple removes order from the question entirely.
           The answer to "did this person deliver this post on this day" now depends
           only on WHICH post it is, not on how many draws happened to precede it.
           Still perfectly reproducible, and now genuinely independent of the person
           pick. `|deliver` and `|status` are separate namespaces so the two
           questions cannot correlate with each other either. */
        const key = `${project.code}|${date}|${person.match}|${kind}`;
        const delivered = hash01(`${key}|deliver`) < effective;
        const status = delivered ? 'done' : hash01(`${key}|status`) < 0.5 ? 'in_progress' : 'todo';

        const [{ next_reference: reference }] = await sql`
          select app.next_reference(${project.code}) as next_reference
        `;

        const [task] = await sql`
          insert into public.tasks
            (reference, title, project_id, created_by_id, assignee_id, effort_points,
             content_kind, due_date, due_time, status, completed_at, description)
          values (
            ${reference},
            ${`${kind === 'reel' ? 'Reel' : kind === 'story' ? 'Story' : kind === 'video' ? 'Video' : kind === 'carousel' ? 'Carousel' : 'Static post'} — ${date} ${MARK}`},
            ${project.id}, ${admin.id}, ${person.id}, 1,
            ${kind}::public.content_kind,
            ${date}, ${time},
            ${status}::public.task_status,
            ${delivered ? `${date}T${time}:00Z` : null},
            ${'Demo workload for reporting. Safe to delete.'}
          )
          returning id
        `;

        /* ⚠️ A placement only where it actually went out, and `published_on` only
           then too. The trigger from migration 055 reads this to set the task's
           own published_on — which is what every target report counts. */
        const pid = platformId.get(slug);
        if (pid) {
          await sql`
            insert into public.task_placements
              (task_id, platform_id, content_kind, url, published_on)
            values (
              ${task.id}, ${pid}, ${kind}::public.content_kind,
              ${delivered ? demoUrl(slug, date, day) : null},
              ${delivered ? date : null}
            )
          `;
        }

        perProject.planned += 1;
        if (delivered) perProject.done += 1;
        const tally = perProject.byPerson.get(person.name) ?? { planned: 0, done: 0 };
        tally.planned += 1;
        if (delivered) tally.done += 1;
        perProject.byPerson.set(person.name, tally);
      }
    }

    /* ── 5. OVERSIGHT, SO THE EXECUTIVES ARE NOT BLANK ROWS ────────────────
          The CEO and the CTO are share 0 above: they do not post. But the owner’s
          reason for wanting this data at all was *"everyone is engaging in
          something or a productive task"*, and a report where the two most senior
          people show nothing at all answers that badly — it looks like missing
          data rather than like a division of labour.

          ⚠️ `content_kind` IS LEFT NULL ON PURPOSE. Every posting metric in this
          system filters on `content_kind is not null` (migration 033’s index,
          migration 055’s check, projectReportData’s asset query), so these rows
          are invisible to every published/planned/platform number and cannot
          inflate anyone’s posting figures. They are work, counted as work, and
          not counted as content. That separation is the only reason this is safe
          to add.

          One per month per project per executive — monthly review cadence, which
          is what the owner described: *"At the end of the month or you can say at
          the end of the week, every meeting is held."* */
    for (const exec of roster.filter((r) => r.share === 0)) {
      for (const [monthIndex, month] of MONTHS.entries()) {
        const kind = OVERSIGHT[nextInt(OVERSIGHT.length)];
        /* The 25th, or today if the month has not reached it — a review happens at
           the end of the period it reviews, never in the future. */
        const wanted = `${month}-25`;
        const date = wanted > TODAY ? TODAY : wanted;
        if (date < `${month}-01`) continue;

        /* Executives close their own oversight items. Not always, though — the
           current month’s review is still open, which is what makes a status
           filter on the reports page show something other than all-done. */
        const done = monthIndex < MONTHS.length - 1;

        const [{ next_reference: reference }] = await sql`
          select app.next_reference(${project.code}) as next_reference
        `;
        await sql`
          insert into public.tasks
            (reference, title, project_id, created_by_id, assignee_id, effort_points,
             due_date, status, completed_at, description)
          values (
            ${reference},
            ${`${kind} — ${month} ${MARK}`},
            ${project.id}, ${admin.id}, ${exec.id}, 2,
            ${date},
            ${done ? 'done' : 'in_progress'}::public.task_status,
            ${done ? `${date}T17:00:00Z` : null},
            ${'Demo oversight item for reporting. Not a content deliverable.'}
          )
        `;
        oversightMade += 1;
      }
    }

    report.push({ name: project.name, story: profile.story, ...perProject });
  }

  /* ── WHAT WAS MADE, SO THE REPORTS HAVE SOMETHING TO BE CHECKED AGAINST ──── */
  console.log('\n── BY PROJECT ────────────────────────────────────────────────');
  for (const r of report) {
    const pct = r.planned ? Math.round((r.done / r.planned) * 100) : 0;
    console.log(
      `  ${r.name.padEnd(24)} ${String(r.done).padStart(3)}/${String(r.planned).padEnd(3)} published  ${String(pct).padStart(3)}%   (${r.story})`,
    );
  }

  const people = new Map();
  for (const r of report) {
    for (const [name, tally] of r.byPerson) {
      const at = people.get(name) ?? { planned: 0, done: 0 };
      at.planned += tally.planned;
      at.done += tally.done;
      people.set(name, at);
    }
  }

  console.log('\n── BY PERSON ─────────────────────────────────────────────────');
  for (const [name, t] of [...people.entries()].sort((a, b) => b[1].done - a[1].done)) {
    const pct = t.planned ? Math.round((t.done / t.planned) * 100) : 0;
    console.log(
      `  ${name.padEnd(24)} ${String(t.done).padStart(3)}/${String(t.planned).padEnd(3)} published  ${String(pct).padStart(3)}%`,
    );
  }

  const execs = roster.filter((r) => r.share === 0).map((r) => r.name).join(' and ');
  console.log(
    `
Oversight: ${oversightMade} non-content task(s) for ${execs} — a NULL content_kind, ` +
      'so they are invisible to every posting metric.',
  );

  console.log(`\nMonths seeded: ${MONTHS.join(', ')} (current month only up to ${TODAY}).`);
  console.log('Remove everything again:  node scripts/seed-demo-workload.mjs --remove\n');

  await sql.end({ timeout: 5 });
  process.exit(0);
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
