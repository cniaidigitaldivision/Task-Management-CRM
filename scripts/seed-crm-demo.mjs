#!/usr/bin/env node
/* ============================================================================
 * CNI CRM — THE DEMO LEAD DESK, FOR PROVING THE SYSTEM ON OUR OWN DATA
 * ----------------------------------------------------------------------------
 *     node scripts/seed-crm-demo.mjs            # build it
 *     node scripts/seed-crm-demo.mjs --remove   # take it all away again
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Owner, 2026-09-12: *"I can't test everything on the live leads... Chitral
 * Royal Homes or any other project is my client. I can't use their data for
 * testing purposes. I will use my own."*
 *
 * Chitral's 623 leads are real people who gave a developer their phone number.
 * Moving one through the stages to see what a report does spends a client's
 * goodwill on our debugging. So the whole desk is exercised here instead, on
 * enquiries about OUR products, and Chitral's importer runs untouched throughout.
 *
 * ── ⚠️ THE DATA IS DESIGNED, NOT RANDOM — THAT IS THE WHOLE POINT ───────────
 * `seed-demo-workload.mjs` learned this the hard way and its note is worth
 * repeating: dummy data whose purpose is to show differences must not let an
 * artefact of the generator look like a finding.
 *
 * Here the question being asked is *"does the sales team panel notice who is
 * performing?"* — so the answer is written down FIRST, in PROFILES below, and
 * then checked against the screen. If the strong performer does not read as the
 * strong performer, the panel is wrong, and you found that out on invented data
 * rather than on somebody's appraisal.
 *
 * ── ⚠️ SIXTEEN OF THE EIGHTEEN CANNOT BE MESSAGED, BY CONSTRUCTION ──────────
 * `(demo — no number)` normalises to NULL, and both `lead-desk.tsx` and
 * `lead-record.tsx` draw the `tel:` and `wa.me` buttons ONLY when `phoneE164`
 * exists. So those leads have no reachable link at all — not by a mis-click, not
 * by a bulk action. Only the two carrying the owner's OWN confirmed number can
 * reach a handset, and a plausible-looking invented Pakistani number would
 * belong to a real stranger.
 *
 * ── ⚠️ IT WRITES THROUGH THE REAL PERMISSION PATH, AS REAL PEOPLE ───────────
 * Every statement runs inside `asUser()` — `role = cni_app` plus `app.user_id` —
 * exactly as the application does. RLS, the column grants and the guard triggers
 * are all live. So the Admin creates and hands out, and each salesperson logs
 * their own calls. That is slower than a superuser INSERT and it is the point:
 * seeding this way also PROVES the permission model, and a seeder that bypasses
 * RLS would happily create a state the app itself could never reach.
 *
 * ── ⚠️ `source = 'manual'`, NOT 'demo' ──────────────────────────────────────
 * `crm_lead_source` is an ENUM — meta_lead_ad, whatsapp, website, manual — so
 * there is no 'demo' value and adding one would be a permanent schema change for
 * a temporary fixture. `manual` is honest (a person put these here) and the
 * `demo:` prefix on `external_id` makes them unmistakable. The unique key is
 * `(source, external_id)`, so a Meta import can never collide with one of these
 * in either direction.
 *
 * ── REMOVAL IS COMPLETE ─────────────────────────────────────────────────────
 * `crm_lead_activity` and `crm_lead_notes` are append-only and refuse DELETE at
 * every rank including Admin — but both cascade from `crm_leads`, and a
 * referential action is not subject to the policy. So deleting the leads takes
 * the timeline with it, which is the only way this fixture could ever be undone.
 * ========================================================================= */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

const remove = process.argv.includes('--remove');

/* ── Identity ──────────────────────────────────────────────────────────────
   Marked in three independent ways so `--remove` cannot miss any of it, and so
   a human reading the database sees at a glance that none of it is real. */
const MARK = '[demo]';
const EXT_PREFIX = 'demo:';
const SOURCE = 'manual';
const PROJECT_NAME = `Demo — Product Enquiries ${MARK}`;
const PROJECT_CODE = 'DMO';  /* exactly three uppercase letters — projects_code_format */

/* ⚠️ The owner's OWN second handset, confirmed 2026-09-12. The only number in
   this file that can receive anything. Everything else is the placeholder. */
const OWNER_TEST_NUMBER = '03121531511';
const NO_NUMBER = '(demo — no number)';

function readEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    console.error('✗ .env.local not found. Run this from the project root.');
    process.exit(1);
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    /* ⚠️ A quoted value wins, and only then is a trailing #comment stripped.
       A naive split on '#' mangles `META_APP_SECRET="…"  # not committed` and
       reports a perfectly good credential as wrong. That cost an evening. */
    let v = m[2];
    const quoted = v.match(/^(['"])([\s\S]*?)\1/);
    v = quoted ? quoted[2] : v.split('#')[0].trim();
    out[m[1]] = v;
  }
  return out;
}

const env = readEnvLocal();
if (!env.DATABASE_URL) {
  console.error('✗ DATABASE_URL is not set in .env.local');
  process.exit(1);
}

/* ── THE DESIGNED ANSWER ────────────────────────────────────────────────────
   `replyMinutes` is how long after the enquiry arrived that the salesperson
   first made contact. It is the single number the sales team panel ranks people
   on, so it is the number chosen most deliberately here.

   ⚠️ `null` means never contacted — NOT zero. A lead nobody rang must leave
   `first_contacted_at` NULL so the panel reads "No calls yet" rather than
   flattering somebody with an instant response they never gave. */
const PROFILES = {
  strong: {
    who: 'Sale Tester',
    story: 'answers within the hour, works them, closes',
    replyMinutes: [14, 22, 31, 19, 26, 41],
    /* index-aligned with the six leads handed to them */
    outcomes: ['won', 'won', 'lost', 'qualified', 'follow_up', 'contacted'],
  },
  weak: {
    who: 'Sale 2 tester',
    story: 'answers after days, lets three go quiet, closes nothing',
    replyMinutes: [2880, 4320, 3600, null, null, null],
    outcomes: ['contacted', 'follow_up', 'contacted', 'new', 'new', 'new'],
  },
};

/* ── THE ENQUIRIES ──────────────────────────────────────────────────────────
   About OUR products, in a B2B shape — a company, a team size, a system they
   already run. Chitral's leads ask about plots and villas; an ERP enquiry that
   asked the same questions would prove nothing about whether this desk can hold
   a software sale. `daysAgo` spreads them so the ageing report has a curve, and
   so the untouched ones cross the five-day neglect threshold. */
const ENQUIRIES = [
  // — ERP —
  { name: 'Bilal Ahmed Qureshi',  company: 'Qureshi Textiles',        form: 'erp',    size: '40–60 staff',  need: 'Stock and production tracking across two units', city: 'Faisalabad', daysAgo: 19 },
  { name: 'Sana Iqbal',           company: 'Iqbal Foods',             form: 'erp',    size: '15–25 staff',  need: 'Inventory and invoicing, currently on paper',     city: 'Lahore',     daysAgo: 17 },
  { name: 'Usman Tariq',          company: 'Tariq Auto Parts',        form: 'erp',    size: '10–15 staff',  need: 'Replacing an old Tally setup',                    city: 'Karachi',    daysAgo: 15 },
  { name: 'Hina Shahzad',         company: 'Shahzad Pharma',          form: 'erp',    size: '60+ staff',    need: 'Batch tracking and expiry management',            city: 'Islamabad',  daysAgo: 12 },
  { name: 'Adnan Bashir',         company: 'Bashir Construction',     form: 'erp',    size: '25–40 staff',  need: 'Site costing and payroll in one place',           city: 'Rawalpindi', daysAgo: 9 },
  { name: 'Zara Malik',           company: 'Malik Distributors',      form: 'erp',    size: '15–25 staff',  need: 'Order to delivery tracking',                      city: 'Multan',     daysAgo: 6 },

  // — CRM —
  { name: 'Faisal Rehman',        company: 'Rehman Estates',          form: 'crm',    size: '8–12 agents',  need: 'Leads from Facebook going missing',               city: 'Islamabad',  daysAgo: 18 },
  { name: 'Ayesha Noor',          company: 'Noor Properties',         form: 'crm',    size: '5–8 agents',   need: 'Follow-ups forgotten, no record of calls',         city: 'Lahore',     daysAgo: 16 },
  { name: 'Kamran Sheikh',        company: 'Sheikh Marketing',        form: 'crm',    size: '12–20 staff',  need: 'Wants to see which campaign actually converts',    city: 'Karachi',    daysAgo: 13 },
  { name: 'Nadia Aslam',          company: 'Aslam Travel',            form: 'crm',    size: '6–10 staff',   need: 'Enquiries arrive on WhatsApp and get lost',        city: 'Peshawar',   daysAgo: 11 },
  { name: 'Junaid Farooq',        company: 'Farooq Motors',           form: 'crm',    size: '20–30 staff',  need: 'No idea which salesperson is performing',          city: 'Gujranwala', daysAgo: 8 },
  { name: 'Sadia Hussain',        company: 'Hussain Interiors',       form: 'crm',    size: '5–8 staff',    need: 'Quotations sent and then never chased',            city: 'Lahore',     daysAgo: 4 },

  // — Taskly —
  { name: 'Imran Yousaf',         company: 'Yousaf Media',            form: 'taskly', size: '10–15 staff',  need: 'Team tasks live in WhatsApp groups',               city: 'Islamabad',  daysAgo: 20 },
  { name: 'Rabia Khan',           company: 'Khan Digital',            form: 'taskly', size: '6–10 staff',   need: 'Content calendar and approvals',                   city: 'Karachi',    daysAgo: 14 },
  { name: 'Shahid Mehmood',       company: 'Mehmood Associates',      form: 'taskly', size: '25–40 staff',  need: 'Attendance and workload in one system',            city: 'Lahore',     daysAgo: 10 },
  { name: 'Kiran Javed',          company: 'Javed Consulting',        form: 'taskly', size: '8–12 staff',   need: 'Client reporting takes two days a month',          city: 'Islamabad',  daysAgo: 7 },
  { name: 'Tahir Abbas',          company: 'Abbas Logistics',         form: 'taskly', size: '30–50 staff',  need: 'Nobody knows who is over capacity',                city: 'Karachi',    daysAgo: 5 },
  { name: 'Mehwish Anwar',        company: 'Anwar Fabrics',           form: 'taskly', size: '15–25 staff',  need: 'Wants approvals with a trail',                     city: 'Faisalabad', daysAgo: 3 },
];

const FORMS = {
  erp:    { name: `ERP enquiry ${MARK}`,    id: `${EXT_PREFIX}form-erp` },
  crm:    { name: `CRM enquiry ${MARK}`,    id: `${EXT_PREFIX}form-crm` },
  taskly: { name: `Taskly enquiry ${MARK}`, id: `${EXT_PREFIX}form-taskly` },
};

const sql = postgres(env.DATABASE_URL, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 30,
  /* ⚠️ `DATABASE_URL` points at the TRANSACTION pooler (`pgbouncer=true`), which
     hands a different backend to each transaction and so cannot keep a prepared
     statement alive between them. Left on, this fails intermittently with
     `prepared statement "…" does not exist` — intermittently, because it only
     bites once the pooler reuses the name. */
  prepare: false,
  onnotice: () => {},
});

/** Run a callback as `cni_app` acting as `userId` — the application's own path. */
async function asUser(userId, fn) {
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'cni_app', true),
                    set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
}

/** Redact anything that might carry the database password. */
function redact(text) {
  return String(text).replace(/:\/\/([^:@\s]+):(.*)@([^@\s/]+)/g, '://$1:••••••••@$3');
}

const iso = (daysAgo, addMinutes = 0) =>
  new Date(Date.now() - daysAgo * 864e5 + addMinutes * 6e4).toISOString();

try {
  /* ── Who we act as ──────────────────────────────────────────────────────── */
  const people = await sql`
    select u.id, u.full_name, u.role, u.department_role, d.key as dept
      from public.users u
      left join public.departments d on d.id = u.department_id
     where u.is_active
       and (u.role in ('admin', 'super_admin') or d.key = 'sales')`;

  const admin = people.find((p) => p.role === 'admin' || p.role === 'super_admin');
  const strong = people.find((p) => p.full_name === PROFILES.strong.who);
  const weak = people.find((p) => p.full_name === PROFILES.weak.who);
  const manager = people.find((p) => p.dept === 'sales' && p.department_role === 'manager');

  if (!admin) throw new Error('No active Admin to act as.');
  for (const [label, who] of [['strong', strong], ['weak', weak], ['manager', manager]]) {
    if (!who) throw new Error(`Cannot find the ${label} tester. Expected "${PROFILES[label]?.who ?? 'a sales manager'}" in the Sales department.`);
  }

  /* ══ REMOVE ═══════════════════════════════════════════════════════════════ */
  if (remove) {
    const gone = await asUser(admin.id, async (tx) => {
      /* Leads first: activity and notes cascade from them, which is the only
         way past their append-only DELETE policies. */
      const leads = await tx`
        delete from public.crm_leads
         where source = ${SOURCE} and external_id like ${EXT_PREFIX + '%'}
        returning id, client_id`;

      /* ⚠️ `crm_clients` HAS NO `project_id` — a client belongs to the division,
         not a project, because one person may enquire about several (Q16). So
         they are identified by the leads that just went, and removed only if
         nothing else still points at them. A real client must never be
         collateral of a demo teardown. */
      const ids = leads.map((l) => l.client_id).filter(Boolean);
      const clients = ids.length
        ? await tx`
            delete from public.crm_clients c
             where c.id in ${tx(ids)}
               and not exists (select 1 from public.crm_leads l where l.client_id = c.id)
            returning id`
        : [];

      const forms = await tx`
        delete from public.crm_lead_forms
         where meta_form_id like ${EXT_PREFIX + '%'}
        returning id`;

      /* ⚠️ THE PROJECT IS ARCHIVED, NOT DELETED — because `projects` HAS NO
         DELETE POLICY AT ALL. With RLS on and nothing permitting DELETE, the
         statement affects zero rows and reports success, which is how the first
         run of this script left an orphan behind. Archiving is the mechanism
         this application actually has, so it is the one used, and the count
         below says "archived" rather than pretending otherwise. */
      const projects = await tx`
        update public.projects set status = 'archived'
         where name = ${PROJECT_NAME} and status <> 'archived'
        returning id`;

      return { leads: leads.length, clients: clients.length, forms: forms.length, projects: projects.length };
    });

    console.log('\n✓ Removed the demo desk.');
    console.log(`  leads     ${gone.leads}  (timeline and notes cascaded with them)`);
    console.log(`  clients   ${gone.clients}`);
    console.log(`  forms     ${gone.forms}`);
    console.log(`  project   ${gone.projects} archived — projects cannot be deleted in this system`);
    console.log('\nChitral is untouched, as always.\n');
    await sql.end();
    process.exit(0);
  }

  /* ══ BUILD ════════════════════════════════════════════════════════════════ */
  const existing = await sql`
    select count(*)::int as n from public.crm_leads
     where source = ${SOURCE} and external_id like ${EXT_PREFIX + '%'}`;
  if (existing[0].n > 0) {
    console.error(`✗ ${existing[0].n} demo leads already exist. Run --remove first.`);
    await sql.end();
    process.exit(1);
  }

  const salesDept = await sql`select id from public.departments where key = 'sales'`;
  if (!salesDept.length) throw new Error('No Sales department.');

  /* ── 1 · The project ────────────────────────────────────────────────────────
     ⚠️ ROUTED TO SALES, AND THAT IS THE WHOLE REASON IT EXISTS. The AI & Digital
     projects route their leads to Kashif's department; the three testers are in
     Sales, and `crm_leads_select` needs the reader to be IN the project's
     department. Assigning a Sales tester a lead on an AI & Digital project would
     show them nothing — correctly. Rather than re-route a real project and
     reverse the owner's 10 September decision, the fixture brings its own. */
  /* ⚠️ REUSED IF IT IS ALREADY THERE. Because the project can only ever be
     archived, a second run would otherwise stack up identical rows in the
     dropdown — which is exactly what happened the first time. */
  const [project] = await asUser(admin.id, async (tx) => {
    const found = await tx`
      select id, name from public.projects where name = ${PROJECT_NAME} limit 1`;
    if (found.length) {
      await tx`update public.projects set status = 'active' where id = ${found[0].id}`;
      return found;
    }
    return tx`
      insert into public.projects (name, code, type, status, owner_id, created_by_id, lead_department_id, is_draft)
      values (${PROJECT_NAME}, ${PROJECT_CODE}, 'self_promotion', 'active',
              ${admin.id}, ${admin.id}, ${salesDept[0].id}, false)
      returning id, name`;
  });

  /* ── 2 · The forms ──────────────────────────────────────────────────────────
     Three, because all three real campaigns run on ONE page and migration 127
     made the FORM the thing that decides a lead's project. Mirroring that here
     means the "Came from" column and the form filter are exercised by the same
     mechanism production uses. */
  const formIds = {};
  await asUser(admin.id, async (tx) => {
    for (const [key, f] of Object.entries(FORMS)) {
      const [row] = await tx`
        insert into public.crm_lead_forms (meta_form_id, name, page_id, project_id)
        values (${f.id}, ${f.name}, ${EXT_PREFIX + 'page'}, ${project.id})
        returning id`;
      formIds[key] = row.id;
    }
  });

  /* ── 3 · The leads ───────────────────────────────────────────────────────── */
  const created = [];
  await asUser(admin.id, async (tx) => {
    for (const [i, e] of ENQUIRIES.entries()) {
      /* Two, and only two, can reach a handset. Both go to the strong tester so
         the live WhatsApp test runs against the account that is actually
         working its leads. */
      const live = i === 0 || i === 6;
      const phone = live ? OWNER_TEST_NUMBER : NO_NUMBER;
      /* ⚠️ `phone_e164` MUST BE WRITTEN HERE. Nothing in the database derives
         it — `lib/domain/phone.ts` normalises in TypeScript and the importer
         writes both columns. A raw INSERT that sets only `phone` leaves
         `phone_e164` NULL, and because both screens gate the call and WhatsApp
         buttons on it, EVERY lead comes out unreachable — including the two
         that are supposed to be reachable. Caught by counting them afterwards,
         which is the only way this would ever have shown up. */
      const phoneE164 = live ? '+923121531511' : null;

      const [row] = await tx`
        insert into public.crm_leads
          (project_id, form_id, source, external_id, full_name, phone, phone_e164, city, answers,
           stage, submitted_at, created_by_id)
        values
          (${project.id}, ${formIds[e.form]}, ${SOURCE}, ${EXT_PREFIX + String(i + 1).padStart(3, '0')},
           ${e.name}, ${phone}, ${phoneE164}, ${e.city},
           ${sql.json({
             company: e.company,
             which_product_are_you_interested_in: e.form.toUpperCase(),
             how_many_people_use_it: e.size,
             what_are_you_trying_to_solve: e.need,
             city: e.city,
           })},
           'new', ${iso(e.daysAgo)}, ${admin.id})
        returning id, full_name, phone_e164`;
      created.push({ ...row, live, daysAgo: e.daysAgo });
    }
  });

  /* ── 4 · Handing them out ───────────────────────────────────────────────────
     As the Admin, because `crm_guard_reassign` refuses an owner change from
     anybody who does not manage the project. The manager tester could do it too;
     the Admin is used so the manager's own "last given a lead" figure stays
     clean. Six each, six left for you to share out by hand. */
  const strongLeads = created.slice(0, 6);
  const weakLeads = created.slice(6, 12);

  await asUser(admin.id, async (tx) => {
    for (const l of strongLeads) await tx`update public.crm_leads set owner_id = ${strong.id} where id = ${l.id}`;
    for (const l of weakLeads) await tx`update public.crm_leads set owner_id = ${weak.id} where id = ${l.id}`;
  });

  /* ── 5 · Working them, as the people themselves ─────────────────────────────
     ⚠️ EACH SALESPERSON LOGS THEIR OWN CALLS. `crm_lead_activity_insert` requires
     `actor_id` to be the acting session, and only allows the five contact kinds —
     so this cannot be faked from the Admin account, and nor should it be: the
     response time being measured is theirs. */
  async function work(person, leads, profile) {
    await asUser(person.id, async (tx) => {
      for (const [i, lead] of leads.entries()) {
        const mins = profile.replyMinutes[i];
        const outcome = profile.outcomes[i];

        /* Never contacted: no activity at all, so `first_contacted_at` stays
           NULL and the lead ages into the neglect alert. */
        if (mins !== null) {
          await tx`
            insert into public.crm_lead_activity (lead_id, actor_id, kind, occurred_at, detail)
            values (${lead.id}, ${person.id}, ${mins > 1440 ? 'call_no_answer' : 'call_connected'},
                    ${iso(leads[i].daysAgo, mins)}, ${sql.json({ note: 'Demo call' })})`;
        }

        /* ⚠️ STAGE AND REASON IN ONE STATEMENT. `crm_leads_lost_needs_reason`
           is checked per row per statement, so setting the stage first and the
           reason second fails on the first of the two — exactly as it should,
           and exactly as a caller who forgot the reason would fail. */
        if (outcome === 'lost') {
          await tx`
            update public.crm_leads
               set stage = 'lost', lost_reason = 'budget_too_low'
             where id = ${lead.id}`;
        } else if (outcome !== 'new') {
          await tx`update public.crm_leads set stage = ${outcome} where id = ${lead.id}`;
        }
        /* Something owed, on the ones still in play — so the due strip and the
           morning reminder have material. */
        if (['qualified', 'follow_up', 'contacted'].includes(outcome)) {
          await tx`
            update public.crm_leads
               set next_action = ${'Send proposal'}, next_action_at = ${iso(-(i % 3))}
             where id = ${lead.id}`;
        }
        if (outcome === 'won' || outcome === 'qualified') {
          await tx`update public.crm_leads set temperature = 'hot' where id = ${lead.id}`;
        }
      }
    });
  }

  await work(strong, strongLeads, PROFILES.strong);
  await work(weak, weakLeads, PROFILES.weak);

  /* ── 6 · What was actually made ─────────────────────────────────────────── */
  const summary = await sql`
    select u.full_name,
           count(*)::int as held,
           count(*) filter (where l.first_contacted_at is not null)::int as contacted,
           count(*) filter (where l.stage = 'won')::int as won,
           round(avg(extract(epoch from (l.first_contacted_at - l.submitted_at)) / 60.0)
                 filter (where l.first_contacted_at is not null))::int as avg_reply_mins
      from public.crm_leads l
      join public.users u on u.id = l.owner_id
     where l.source = ${SOURCE} and l.external_id like ${EXT_PREFIX + '%'}
     group by u.full_name order by u.full_name`;

  const clients = await sql`
    select count(distinct l.client_id)::int as n
      from public.crm_leads l
     where l.source = ${SOURCE} and l.external_id like ${EXT_PREFIX + '%'}
       and l.client_id is not null`;

  console.log(`\n✓ Built "${project.name}"\n`);
  console.log(`  ${created.length} leads · 3 forms · routed to Sales`);
  console.log(`  ${created.filter((c) => c.live).length} carry a reachable number; ${created.filter((c) => !c.live).length} cannot be messaged at all`);
  console.log(`  ${clients[0].n} client(s) created by winning\n`);
  console.log('  THE DESIGNED ANSWER — check the sales team panel says this:\n');
  console.log('    person              held  contacted  won  avg reply');
  for (const r of summary) {
    console.log(
      `    ${r.full_name.padEnd(20)}${String(r.held).padEnd(6)}${String(r.contacted).padEnd(11)}${String(r.won).padEnd(5)}${r.avg_reply_mins === null ? 'no calls yet' : r.avg_reply_mins + ' min'}`,
    );
  }
  console.log(`\n  6 leads left unassigned — share them out to watch the rota decide.`);
  console.log(`\nRemove everything again:  node scripts/seed-crm-demo.mjs --remove\n`);

  await sql.end();
} catch (error) {
  console.error('\n✗ Seeding failed.');
  console.error(redact(error?.message ?? error));
  if (error?.detail) console.error(redact(error.detail));
  await sql.end({ timeout: 5 });
  process.exit(1);
}
