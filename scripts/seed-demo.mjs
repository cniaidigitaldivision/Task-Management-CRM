#!/usr/bin/env node
/* ============================================================================
 * CNI CRM — DEMO SEED
 * ----------------------------------------------------------------------------
 *     npm run seed:demo          create the demo division
 *     npm run seed:demo -- --wipe   remove everything this script created
 *
 * ── WHY THIS IS A SCRIPT AND NOT A MIGRATION ─────────────────────────────────
 * ADR-009 is explicit: the system ships with NO team data. The Admin creates
 * every member through the application. A migration runs on every environment
 * including production, so seed data in a migration would make ADR-009 false.
 *
 * A real install therefore still starts empty. This is a separate, opt-in,
 * reversible act — run deliberately, for a demonstration, and undone with
 * `--wipe`. The decision stands; this does not contradict it.
 *
 * ── WHY THE DATA LOOKS LIKE THIS ─────────────────────────────────────────────
 * Every number obeys the real rules, because a demo that shows impossible data
 * teaches the wrong thing about the product:
 *   · capacity 36 pts/week (ADR-004), not 48
 *   · load = effort × priority weight × status weight (doc 06 §2), so the
 *     workload bars you see are computed, not typed in
 *   · one person is deliberately OVER capacity and one is near the limit —
 *     an all-green screen demonstrates nothing about a capacity engine
 *   · blocked tasks carry reasons and Other-project tasks carry descriptions,
 *     because the database refuses them otherwise (FR-043, BR-012)
 *   · dates are relative to today, so the board never looks stale
 *
 * It runs as the migration owner in ONE transaction, so a failure leaves no
 * half-seeded team behind.
 * ========================================================================= */

import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { hash as argonHash } from '@node-rs/argon2';

const DEMO_DOMAIN = 'cni-demo.com';
const DEMO_PASSWORD = 'Marigold-Harbour-92';

function redact(text) {
  return String(text).replace(/:\/\/([^:@\s]+):([^@\s]*)@/g, '://$1:••••••••@');
}

function readEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
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

/* Same parameters as lib/auth/hashing.ts. They were chosen by measurement
   (14ms / 99ms / 130ms tried) and a seeded hash that does not match the app's
   verifier is a login that fails for no visible reason. */
const ARGON = { algorithm: 2, memoryCost: 65536, timeCost: 3, parallelism: 1 };

/* ---------------------------------------------------------------------------
 * TOTP, for the privileged accounts
 * ---------------------------------------------------------------------------
 * FR-145 makes a second factor mandatory for Super Admin and Admin, and the
 * sign-in action enforces it: an Admin with no verified factor is sent to the
 * enrolment screen and cannot reach the application. Correct, and it means a
 * seeded Admin with no factor can never be signed in as.
 *
 * So the seed enrols a real TOTP factor and prints the secret. Two ways to use
 * it: scan/paste it into an authenticator app once, or read the current code off
 * the console output below (it is recomputed and printed on every seed run).
 *
 * Deliberately NOT solved by exempting the demo from MFA. A demo that skips the
 * security model demonstrates something the real system does not do.
 * ------------------------------------------------------------------------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input) {
  const clean = input.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | B32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 6238, matching lib/auth/totp.ts: SHA-1, 6 digits, 30-second period. */
function totpNow(secret, atMs = Date.now()) {
  const counter = Math.floor(atMs / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** 6).padStart(6, '0');
}

/* ---------------------------------------------------------------------------
 * The division — 1 Admin, 1 Coordinator, 5 Members
 * ------------------------------------------------------------------------- */
const PEOPLE = [
  { key: 'sana',    name: 'Sana Minhas',      role: 'admin',            title: 'Division Lead',         capacity: 36, maxTasks: 6 },
  { key: 'kashif',  name: 'Kashif Ahmed',     role: 'team_coordinator', title: 'Senior Video Editor',   capacity: 36, maxTasks: 5 },
  { key: 'yusra',   name: 'Yusra Khan',       role: 'member',           title: 'Ads Manager',           capacity: 36, maxTasks: 5 },
  { key: 'ayesha',  name: 'Ayesha Siddiqui',  role: 'member',           title: 'Graphic Designer',      capacity: 36, maxTasks: 5 },
  { key: 'danish',  name: 'Danish Raza',      role: 'member',           title: 'Content Writer',        capacity: 36, maxTasks: 5 },
  { key: 'emaan',   name: 'Emaan Tariq',      role: 'member',           title: 'Web Developer',         capacity: 30, maxTasks: 4 },
  { key: 'farhan',  name: 'Farhan Malik',     role: 'member',           title: 'Social Media Manager',  capacity: 36, maxTasks: 6 },
];

const SKILLS = [
  ['video-editing',    'Video Editing',      'Creative',  ['video','reel','edit','premiere','footage','cut']],
  ['motion-graphics',  'Motion Graphics',    'Creative',  ['motion','animation','after effects','title']],
  ['graphic-design',   'Graphic Design',     'Creative',  ['design','poster','banner','layout','print']],
  ['brand-identity',   'Brand Identity',     'Creative',  ['brand','logo','identity','guidelines']],
  ['photography',      'Photography',        'Creative',  ['photo','shoot','camera','retouch']],
  ['copywriting',      'Copywriting',        'Content',   ['copy','write','caption','headline','script']],
  ['content-strategy', 'Content Strategy',   'Content',   ['strategy','calendar','plan','pillar']],
  ['ads-management',   'Ads Management',     'Marketing', ['ads','meta','google','tiktok','campaign','budget']],
  ['seo',              'SEO',                'Marketing', ['seo','keyword','ranking','organic']],
  ['analytics',        'Analytics & Reporting','Marketing',['report','analytics','dashboard','metrics']],
  ['social-media',     'Social Media',       'Marketing', ['instagram','facebook','post','story','grid']],
  ['web-development',  'Web Development',    'Technical', ['website','build','deploy','html','css']],
  ['ui-design',        'UI Design',          'Technical', ['ui','interface','figma','prototype','wireframe']],
  ['email-marketing',  'Email Marketing',    'Marketing', ['email','newsletter','mailer','drip']],
  ['event-production', 'Event Production',   'Operations',['event','stand','venue','vendor','expo','stage']],
  ['client-liaison',   'Client Liaison',     'Operations',['client','meeting','brief','approval']],
  ['project-coordination','Project Coordination','Operations',['coordinate','schedule','timeline','plan']],
  ['ai-tooling',       'AI Tooling',         'Technical', ['ai','prompt','automation','generative']],
];

const USER_SKILLS = {
  sana:   [['project-coordination',5,true],['client-liaison',5,false],['content-strategy',4,false]],
  kashif: [['video-editing',5,true],['motion-graphics',4,false],['photography',3,false],['project-coordination',3,false]],
  yusra:  [['ads-management',5,true],['analytics',4,false],['email-marketing',3,false],['seo',3,false]],
  ayesha: [['graphic-design',5,true],['brand-identity',4,false],['ui-design',3,false]],
  danish: [['copywriting',5,true],['content-strategy',4,false],['seo',3,false]],
  emaan:  [['web-development',5,true],['ui-design',4,false],['ai-tooling',3,false]],
  farhan: [['social-media',5,true],['content-strategy',3,false],['event-production',3,false]],
};

const PROJECTS = [
  { key: 'expo',    name: 'Expo Karachi — Oct 2026',  type: 'event',          code: 'EVT', owner: 'sana',
    status: 'active', desc: 'CNI stand, showreel and on-site content for the October trade expo.',
    fields: { event_date: '+70d', venue: 'Karachi Expo Centre, Hall 3', expected_scale: 'large' } },
  { key: 'abc',     name: 'ABC Traders — Retainer',   type: 'client',         code: 'CLI', owner: 'sana',
    status: 'active', desc: 'Monthly retainer: paid social, creative production and reporting.',
    fields: { client_name: 'ABC Traders', contact_person: 'Bilal Sheikh', engagement_type: 'retainer',
              retainer_hours_per_month: 40, is_billable: true, priority_tier: 'A' } },
  { key: 'xyz',     name: 'XYZ Foods — Brand Refresh', type: 'client',        code: 'CLI', owner: 'kashif',
    status: 'active', desc: 'Packaging, identity refresh and launch campaign for the new range.',
    fields: { client_name: 'XYZ Foods', contact_person: 'Nadia Iqbal', engagement_type: 'project',
              is_billable: true, priority_tier: 'A' } },
  { key: 'website', name: 'CNI Website Refresh',       type: 'business',      code: 'BIZ', owner: 'emaan',
    status: 'active', desc: 'Rebuild the division site: new copy, case studies and a faster stack.',
    fields: { objective: 'Convert more inbound enquiries', area: 'Marketing' } },
  { key: 'promo',   name: 'CNI Self-Promotion',        type: 'self_promotion', code: 'PRM', owner: 'farhan',
    status: 'active', desc: 'Our own channels — showreels, behind-the-scenes and the YouTube slate.',
    fields: { channel: 'Instagram + YouTube', campaign_goal: 'Reach and credibility' } },
  { key: 'q4deck',  name: 'Q4 Capability Deck',        type: 'business',      code: 'BIZ', owner: 'sana',
    status: 'planning', desc: 'A single deck the whole team can pitch from.',
    fields: { objective: 'Consistent pitch material', area: 'Sales enablement' } },
  { key: 'misc',    name: 'Misc / Ad-hoc',             type: 'other',         code: 'OTH', owner: 'sana',
    status: 'active', permanent: true,
    desc: 'Favours, one-offs and anything without a home. Deliberately visible so it can be measured (doc 15 §6).',
    fields: {} },
];

/* Tasks. `due` is days from today; negative is overdue. Effort points follow
   doc 05 §5 (XS 1 · S 2 · M 4 · L 8 · XL 16) and are derived from the size, not
   typed twice. */
const POINTS = { XS: 1, S: 2, M: 4, L: 8, XL: 16 };

const TASKS = [
  /* ---- In progress ---- */
  { p:'expo',   t:'Edit the exhibition showreel — 30s vertical', a:'kashif', by:'sana', s:'in_progress', pr:'high',   e:'M',  due:0,  limit:240, spent:192, cl:[['Assemble selects',1],['First cut',1],['Colour pass',1],['Sound mix',0],['Export masters',0]], cm:[['sana','Client wants the vertical crop first — that is what goes on the stand screen.'],['kashif','Understood. First cut is ready, doing the colour pass now.']] },
  { p:'abc',    t:'Eid sale campaign — Meta + TikTok build',     a:'yusra',  by:'sana', s:'blocked',     pr:'urgent', e:'L',  due:2,  limit:480, spent:300, reason:'Waiting on final creative approval from the client.', cm:[['yusra','Audiences and budgets are staged. Blocked on the creative sign-off.'],['sana','Chased Bilal this morning — expecting it today.']] },
  { p:'website',t:'Rewrite the services page copy',              a:'danish', by:'sana', s:'in_progress', pr:'medium', e:'M',  due:4,  limit:240, spent:95,  cl:[['Outline',1],['Draft',0],['Internal review',0],['Final pass',0]] },
  { p:'xyz',    t:'Packaging mockups — round 2',                 a:'ayesha', by:'kashif',s:'in_progress',pr:'urgent', e:'L',  due:1,  limit:480, spent:210, cm:[['kashif','Round 1 feedback: bolder type, keep the green.']] },
  { p:'website',t:'Rebuild the case study template',             a:'emaan',  by:'emaan',s:'in_progress', pr:'high',   e:'L',  due:5,  limit:480, spent:140 },
  { p:'promo',  t:'Behind-the-scenes vlog — pilot episode',      a:'emaan',  by:'farhan',s:'in_progress',pr:'medium', e:'XL', due:9,  limit:960, spent:80 },

  /* ---- Blocked ---- */
  { p:'expo',   t:'Book the LED wall vendor',                    a:'farhan', by:'sana', s:'blocked',     pr:'high',   e:'S',  due:3,  limit:120, spent:45,  reason:'Budget sign-off pending with finance.' },

  /* ---- In review ---- */
  { p:'abc',    t:'ABC Traders — product launch video',          a:'kashif', by:'sana', s:'in_review',   pr:'high',   e:'L',  due:4,  limit:480, spent:550, cm:[['kashif','Submitted for review — runs 8 seconds over, tell me if that is a problem.']] },
  { p:'promo',  t:'Instagram grid redesign — 9 tiles',           a:'ayesha', by:'farhan',s:'in_review',  pr:'medium', e:'M',  due:7,  limit:240, spent:210 },
  { p:'abc',    t:'July performance report',                     a:'yusra',  by:'sana', s:'in_review',   pr:'medium', e:'S',  due:1,  limit:120, spent:110 },

  /* ---- Revisions ---- */
  { p:'promo',  t:'CNI YouTube channel — October slate',         a:'farhan', by:'sana', s:'revisions',   pr:'medium', e:'M',  due:7,  limit:240, spent:140, cm:[['sana','Titles are too long for mobile — trim to six words and resubmit.']] },
  { p:'xyz',    t:'Brand guidelines one-pager',                  a:'ayesha', by:'kashif',s:'revisions',  pr:'high',   e:'M',  due:3,  limit:240, spent:95 },

  /* ---- To do ---- */
  { p:'xyz',    t:'Monthly performance report — September',       a:'yusra',  by:'sana', s:'todo',        pr:'medium', e:'S',  due:-2, limit:120, spent:0 },
  { p:'expo',   t:'Export deliverables in three aspect ratios',   a:'kashif', by:'sana', s:'todo',        pr:'high',   e:'S',  due:3,  limit:120, spent:0 },
  { p:'expo',   t:'Stand signage — final print files',           a:'ayesha', by:'sana', s:'todo',        pr:'high',   e:'M',  due:6,  limit:240, spent:0 },
  { p:'abc',    t:'Refresh the ad creative library',             a:'yusra',  by:'yusra',s:'todo',        pr:'high',   e:'L',  due:5,  limit:480, spent:0 },
  { p:'abc',    t:'Landing page A/B test — headline variants',   a:'yusra',  by:'sana', s:'todo',        pr:'urgent', e:'M',  due:2,  limit:240, spent:0 },
  { p:'website',t:'Migrate the blog archive',                    a:'emaan',  by:'emaan',s:'todo',        pr:'medium', e:'L',  due:12, limit:480, spent:0 },
  { p:'danish-copy', t:'', skip:true },
  { p:'website',t:'Draft the three flagship case studies',       a:'danish', by:'sana', s:'todo',        pr:'high',   e:'L',  due:8,  limit:480, spent:0 },
  { p:'promo',  t:'Write captions for the October grid',         a:'danish', by:'farhan',s:'todo',       pr:'low',    e:'S',  due:10, limit:120, spent:0 },
  { p:'expo',   t:'On-site shot list and run sheet',             a:'farhan', by:'kashif',s:'todo',       pr:'medium', e:'S',  due:14, limit:120, spent:0 },
  { p:'xyz',    t:'Launch teaser — 15s cutdown',                 a:'kashif', by:'kashif',s:'todo',      pr:'medium', e:'S',  due:9,  limit:120, spent:0 },

  /* ---- Backlog ---- */
  { p:'q4deck', t:'Collect the numbers for the capability deck', a:'sana',   by:'sana', s:'backlog',     pr:'low',    e:'M',  due:null, limit:240, spent:0 },
  { p:'website',t:'Accessibility audit of the new build',        a:'emaan',  by:'sana', s:'backlog',     pr:'medium', e:'M',  due:null, limit:240, spent:0 },
  { p:'promo',  t:'Reel series — "how we work"',                 a:'kashif', by:'farhan',s:'backlog',    pr:'low',    e:'XL', due:null, limit:960, spent:0 },
  { p:'abc',    t:'Set up automated weekly reporting',           a:'yusra',  by:'yusra',s:'backlog',     pr:'low',    e:'M',  due:null, limit:240, spent:0 },

  /* ---- Other / ad-hoc — each needs a written explanation (BR-012) ---- */
  { p:'misc',   t:"Fix the audio on last year's wedding video",  a:'kashif', by:'kashif',s:'in_progress',pr:'low',   e:'S',  due:null, limit:300, spent:390,
    other:'Personal favour for a former client. No project, no billing — logged so the time is visible.' },
  { p:'misc',   t:'Reprint the old expo flyers',                 a:'farhan', by:'farhan',s:'cancelled',  pr:'low',   e:'XS', due:null, limit:60,  spent:0,
    other:'Someone asked in passing; the artwork is a year out of date.', reason:'Artwork is obsolete — superseded by the new stand signage.' },
  { p:'misc',   t:'Design a birthday card for the office',       a:'ayesha', by:'sana', s:'todo',        pr:'low',    e:'XS', due:1, limit:60, spent:0,
    other:'Internal morale, not client work. Twenty minutes.' },

  /* ---- Done — recent history, so reports and charts have something real ---- */
  { p:'expo',   t:'Stand graphics — first proofs',               a:'ayesha', by:'sana', s:'done',        pr:'high',   e:'M',  due:-3, limit:240, spent:225, done:-3 },
  { p:'abc',    t:'ABC Traders — August ad creatives',           a:'yusra',  by:'sana', s:'done',        pr:'medium', e:'L',  due:-4, limit:480, spent:460, done:-4 },
  { p:'website',t:'Set up the shared asset library',             a:'emaan',  by:'sana', s:'done',        pr:'low',    e:'S',  due:-6, limit:120, spent:110, done:-5 },
  { p:'promo',  t:'September grid — 9 tiles',                    a:'ayesha', by:'farhan',s:'done',       pr:'medium', e:'M',  due:-7, limit:240, spent:230, done:-7 },
  { p:'xyz',    t:'Client kickoff deck',                         a:'danish', by:'kashif',s:'done',       pr:'high',   e:'S',  due:-8, limit:120, spent:100, done:-8 },
  { p:'abc',    t:'Quarterly channel audit',                     a:'yusra',  by:'sana', s:'done',        pr:'medium', e:'M',  due:-9, limit:240, spent:250, done:-9 },
];

/* ---------------------------------------------------------------------------
 * Run
 * ------------------------------------------------------------------------- */
const wipe = process.argv.includes('--wipe');
const env = readEnvLocal();
if (!env.DATABASE_URL) {
  console.error('✗ DATABASE_URL is not set in .env.local');
  process.exit(1);
}

const sql = postgres(env.DATABASE_URL, {
  prepare: false, max: 1, idle_timeout: 5, connect_timeout: 20, onnotice: () => {},
});

try {
  if (wipe) {
    await sql.begin(async (tx) => {
      const emails = PEOPLE.map((p) => `${p.key}@${DEMO_DOMAIN}`);
      /* Order matters only for `users`, which has a DELETE-forbidding trigger.
         Everything else cascades from tasks and projects. */
      await tx`delete from public.tasks where created_by_id in (select id from public.users where email = any(${emails}))`;

      /* ⚠️ activity_log is deliberately NOT touched.
         It is append-only by trigger (migration 012), so deleting from it raises
         and — this is the part worth knowing — that abort poisons the whole
         transaction, so a `.catch()` around the statement does not save the wipe.
         The first version of this script had exactly that and failed here.

         Which is the correct outcome. "History is not editable by any role"
         (doc 19 §6) is not a rule the demo tooling gets an exemption from. The
         trail of what the demo team did stays; the actors it points at are
         deactivated below and their names still resolve. */
      await tx`delete from public.notifications where user_id in (select id from public.users where email = any(${emails}))`;
      await tx`delete from public.projects where created_by_id in (select id from public.users where email = any(${emails}))`;
      await tx`delete from public.user_skills where user_id in (select id from public.users where email = any(${emails}))`;
      await tx`delete from public.availability where user_id in (select id from public.users where email = any(${emails}))`;
      await tx`delete from public.mfa_factors where user_id in (select id from public.users where email = any(${emails}))`;
      await tx`delete from public.recovery_codes where user_id in (select id from public.users where email = any(${emails}))`;
      await tx`delete from public.auth_identities where user_id in (select id from public.users where email = any(${emails}))`;
      await tx`delete from public.sessions where user_id in (select id from public.users where email = any(${emails}))`;
      /* users cannot be deleted (BR-007) — deactivate instead, and the trigger
         is what makes that non-negotiable. Honest about it rather than fighting
         it: the demo team is retired, not erased. */
      await tx`update public.users set is_active = false, account_state = 'deactivated'
                where email = any(${emails})`;
    });
    console.log('\n✓ Demo data removed. The demo accounts are deactivated, not deleted — BR-028/BR-007 forbid deleting a user row.\n');
    await sql.end({ timeout: 5 });
    process.exit(0);
  }

  console.log('\nSeeding the demo division …');
  const passwordHash = await argonHash(DEMO_PASSWORD, ARGON);

  /* Declared outside the transaction so the summary at the end can print them.
     The secret is generated here and never read back from the database — this is
     the only moment it exists in plaintext, which is equally true of the real
     enrolment ceremony. */
  const totpSecrets = {};

  await sql.begin(async (tx) => {
    /* ── Only ACTIVE demo accounts count as "already seeded" ──────────────────
       A wipe deactivates the accounts rather than deleting them, because BR-007
       forbids deleting a user row and the trigger enforces it. So after a wipe
       the rows are still there, deactivated — and a check that counted those
       would make the seed unrunnable exactly once, permanently.

       Re-seeding therefore reactivates and refreshes the existing rows (the
       upsert below), which is the same thing a real reinstatement would do. */
    const existing = await tx`
      select count(*) as n from public.users
       where email like ${'%@' + DEMO_DOMAIN} and is_active
    `;
    if (Number(existing[0].n) > 0) {
      throw new Error(
        `The demo team is already active. Run "npm run seed:demo -- --wipe" first if you want to rebuild it.`,
      );
    }

    /* ---- People ---- */
    const ids = {};
    for (const person of PEOPLE) {
      const rows = await tx`
        insert into public.users
          (full_name, email, role, role_title, account_state, is_active,
           weekly_capacity_points, max_concurrent_tasks, timezone, theme)
        values (
          ${person.name}, ${person.key + '@' + DEMO_DOMAIN},
          ${person.role}::public.user_role, ${person.title}, 'active', true,
          ${person.capacity}, ${person.maxTasks}, 'Asia/Karachi', 'system'
        )
        on conflict (email) do update set
          full_name = excluded.full_name,
          role = excluded.role,
          role_title = excluded.role_title,
          account_state = 'active',
          is_active = true,
          weekly_capacity_points = excluded.weekly_capacity_points,
          max_concurrent_tasks = excluded.max_concurrent_tasks,
          locked_at = null
        returning id
      `;
      ids[person.key] = rows[0].id;

      await tx`
        insert into public.auth_identities
          (user_id, provider, password_hash, last_password_change_at)
        values (${ids[person.key]}, 'password', ${passwordHash}, now())
      `;

      /* FR-145: a second factor is mandatory for super_admin and admin, and the
         sign-in action enforces it. Without a verified factor the seeded Admin is
         redirected to enrolment on every attempt and can never reach the
         application — which is correct behaviour, and would make the Admin
         undemonstrable. Enrol a real one rather than exempting the demo: a demo
         that skips the security model shows something the product does not do. */
      if (person.role === 'admin' || person.role === 'super_admin') {
        totpSecrets[person.key] = base32Encode(randomBytes(20));
        await tx`
          insert into public.mfa_factors
            (user_id, type, secret_encrypted, friendly_name, is_primary, verified_at)
          values (
            ${ids[person.key]}, 'totp', ${totpSecrets[person.key]},
            'Demo authenticator', true, now()
          )
        `;
      }
    }
    console.log(`  ${PEOPLE.length} people`);

    /* ---- Skills ---- */
    const skillIds = {};
    for (const [slug, label, category, keywords] of SKILLS) {
      const rows = await tx`
        insert into public.skills (slug, label, category, keywords, is_active)
        values (${slug}, ${label}, ${category}, ${keywords}, true)
        on conflict (slug) do update set label = excluded.label
        returning id
      `;
      skillIds[slug] = rows[0].id;
    }
    for (const [personKey, list] of Object.entries(USER_SKILLS)) {
      for (const [slug, proficiency, isPrimary] of list) {
        await tx`
          insert into public.user_skills (user_id, skill_id, proficiency, is_primary)
          values (${ids[personKey]}, ${skillIds[slug]}, ${proficiency}, ${isPrimary})
          on conflict (user_id, skill_id) do nothing
        `;
      }
    }
    console.log(`  ${SKILLS.length} skills, mapped to the team`);

    /* ---- Projects ---- */
    const projectIds = {};
    for (const project of PROJECTS) {
      const fields = { ...project.fields };
      // Relative dates inside type_fields, resolved now so the demo never ages.
      for (const [k, v] of Object.entries(fields)) {
        if (typeof v === 'string' && /^[+-]\d+d$/.test(v)) {
          const days = Number(v.slice(0, -1));
          const d = new Date();
          d.setDate(d.getDate() + days);
          fields[k] = d.toISOString().slice(0, 10);
        }
      }
      const rows = await tx`
        insert into public.projects
          (name, type, code, description, status, owner_id, is_permanent, type_fields,
           created_by_id, start_date, target_end_date)
        values (
          ${project.name}, ${project.type}::public.project_type, ${project.code},
          ${project.desc}, ${project.status}::public.project_status,
          ${ids[project.owner]}, ${project.permanent ?? false},
          ${JSON.stringify(fields)}::jsonb, ${ids.sana},
          current_date - 30,
          ${project.type === 'event' ? sql`current_date + 70` : null}
        )
        returning id
      `;
      projectIds[project.key] = rows[0].id;
    }
    console.log(`  ${PROJECTS.length} projects`);

    /* ---- Tasks ---- */
    let taskCount = 0;
    for (const task of TASKS) {
      if (task.skip) continue;
      const projectId = projectIds[task.p];
      if (!projectId) throw new Error(`Unknown project key "${task.p}" for task "${task.t}"`);

      const refRows = await tx`select app.next_reference(${PROJECTS.find((p) => p.key === task.p).code}) as r`;

      const rows = await tx`
        insert into public.tasks (
          reference, title, project_id, other_description, assignee_id, created_by_id,
          status, priority, effort_size, effort_points, due_date, completed_at,
          blocked_reason, cancelled_reason, time_limit_minutes, time_spent_minutes,
          timer_state, created_at
        ) values (
          ${refRows[0].r}, ${task.t}, ${projectId}, ${task.other ?? null},
          ${ids[task.a]}, ${ids[task.by]},
          ${task.s}::public.task_status, ${task.pr}::public.task_priority,
          ${task.e}::public.effort_size, ${POINTS[task.e]},
          ${task.due === null || task.due === undefined ? null : sql`current_date + ${task.due}::integer`},
          ${task.s === 'done' ? sql`now() - make_interval(days => ${Math.abs(task.done ?? 1)}::integer)` : null},
          ${task.s === 'blocked' ? task.reason : null},
          ${task.s === 'cancelled' ? task.reason : null},
          ${task.limit ?? null}, ${task.spent ?? 0},
          ${task.s === 'in_progress' ? 'paused' : 'not_started'}::public.timer_state,
          now() - make_interval(days => ${Math.min(20, 3 + taskCount % 14)}::integer)
        )
        returning id
      `;
      const taskId = rows[0].id;
      taskCount += 1;

      for (const [text, done] of task.cl ?? []) {
        await tx`
          insert into public.checklist_items (task_id, text, is_done, sort_order)
          values (${taskId}, ${text}, ${done === 1}, ${(task.cl ?? []).findIndex((c) => c[0] === text)})
        `;
      }
      let commentOffset = 0;
      for (const [author, body] of task.cm ?? []) {
        commentOffset += 1;
        await tx`
          insert into public.comments (task_id, author_id, body, created_at)
          values (${taskId}, ${ids[author]}, ${body},
                  now() - make_interval(hours => ${8 - commentOffset}::integer))
        `;
      }

      /* A real time entry behind every logged minute, so the timer screens are
         not showing a number with no history under it. */
      if ((task.spent ?? 0) > 0) {
        await tx`
          insert into public.time_entries (task_id, user_id, started_at, ended_at, minutes, source)
          values (${taskId}, ${ids[task.a]},
                  now() - make_interval(mins => ${task.spent}::integer), now(), ${task.spent}, 'timer')
        `;
      }
    }
    console.log(`  ${taskCount} tasks across all eight statuses`);

    /* ---- One over-limit extension request, pending an Admin decision ---- */
    const overLimit = await tx`
      select id, assignee_id from public.tasks
       where time_spent_minutes > time_limit_minutes and not is_deleted
       order by time_spent_minutes - time_limit_minutes desc limit 1
    `;
    if (overLimit[0]) {
      await tx`
        insert into public.time_extension_requests
          (task_id, requested_by_id, requested_minutes, reason, status)
        values (${overLimit[0].id}, ${overLimit[0].assignee_id}, 120,
                'The client changed the brief after work had started; the original two hours no longer covers it.',
                'pending')
      `;
    }

    /* ---- Availability — one person part-week, so capacity maths is visible ---- */
    await tx`
      insert into public.availability (user_id, start_date, end_date, type, capacity_multiplier, note, approved_by_id)
      values (${ids.danish}, current_date + 2, current_date + 3, 'leave', 0,
              'Approved leave — two days', ${ids.sana})
    `;

    /* ---- Activity feed ---- */
    const recent = await tx`
      select t.id, t.reference, t.status, t.assignee_id
        from public.tasks t where not t.is_deleted
        order by t.updated_at desc limit 8
    `;
    let minutesAgo = 2;
    for (const row of recent) {
      const verb = {
        in_progress: 'started work on',
        blocked: 'moved to Blocked',
        in_review: 'submitted for review',
        revisions: 'requested revisions on',
        done: 'completed',
        todo: 'scheduled',
        backlog: 'moved to the backlog',
        cancelled: 'cancelled',
      }[row.status] ?? 'updated';

      await tx`
        insert into public.activity_log (actor_id, entity_type, entity_id, action, summary, created_at)
        values (${row.assignee_id}, 'task', ${row.id}, ${row.status},
                ${`${verb} ${row.reference}`},
                now() - make_interval(mins => ${minutesAgo}::integer))
      `;
      minutesAgo *= 2;
    }

    /* ---- Notifications for the Admin, so the bell is not empty ---- */
    const forAdmin = await tx`
      select t.id, t.reference, t.title from public.tasks t
       where t.status in ('in_review', 'blocked') and not t.is_deleted limit 4
    `;
    for (const row of forAdmin) {
      await tx`
        insert into public.notifications (user_id, kind, title, body, link_to, entity_id, created_at)
        values (${ids.sana}, 'review_requested', ${`${row.reference} needs your attention`},
                ${row.title}, ${`/tasks/${row.id}`}, ${row.id},
                now() - make_interval(mins => ${10 + Math.floor(Math.random() * 200)}::integer))
      `;
    }
  });

  const line = '─'.repeat(58);
  console.log(`\n\x1b[32m✓\x1b[0m Demo division seeded.\n`);
  console.log(line);
  console.log('  SIGN IN — every demo account uses the same password');
  console.log(line);
  for (const p of PEOPLE) {
    console.log(`  ${p.role.padEnd(17)} ${(p.key + '@' + DEMO_DOMAIN).padEnd(26)} ${p.name}`);
  }
  console.log(line);
  console.log(`  Password:  ${DEMO_PASSWORD}`);
  console.log(line);

  /* ---- The second factor, for the privileged accounts ---- */
  const privileged = Object.keys(totpSecrets);
  if (privileged.length > 0) {
    console.log('\n  TWO-FACTOR — mandatory for Admin and Super Admin (FR-145)');
    console.log(line);
    for (const key of privileged) {
      const secret = totpSecrets[key];
      console.log(`  ${key}@${DEMO_DOMAIN}`);
      console.log(`    secret:    ${secret}`);
      console.log(`    code now:  ${totpNow(secret)}   (changes every 30 seconds)`);
      console.log(
        `    otpauth://totp/CNI%20CRM:${key}@${DEMO_DOMAIN}?secret=${secret}&issuer=CNI%20CRM`,
      );
    }
    console.log(line);
    console.log('  Paste that secret into Google Authenticator, Authy or 1Password once.');
    console.log(line);
    console.log('\n  \x1b[33mNo authenticator to hand? Demo as kashif@cni-demo.com');
    console.log('  (Team Coordinator).\x1b[0m MFA is not mandatory for that role, and a');
    console.log('  Coordinator still sees the whole board, assigns work and approves');
    console.log('  reviews. Signing in as the Admin then demonstrates the MFA');
    console.log('  requirement itself, which is worth showing a CEO.');
  }
  console.log('\n  Demo as sana@cni-demo.com (Admin) — it is the richest view:');
  console.log('  the whole board, every person\'s workload, and it can assign work.');
  console.log('  Sign in as a member to show ADR-003 isolation: they see only their own.\n');
  console.log('  Undo with:  npm run seed:demo -- --wipe\n');

  await sql.end({ timeout: 5 });
  process.exit(0);
} catch (err) {
  console.error(`\n\x1b[31m✗\x1b[0m Seed failed — nothing was committed.`);
  console.error(`  ${redact(err?.message ?? err)}`);
  if (err?.detail) console.error(`  detail: ${redact(err.detail)}`);
  if (err?.hint) console.error(`  hint: ${redact(err.hint)}`);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
