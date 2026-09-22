#!/usr/bin/env node
/* ============================================================================
 * THE CLIENTS PAGE'S SHOWCASE — the owner's two designs, filled with dummy data
 * ----------------------------------------------------------------------------
 *     node scripts/seed-clients-showcase.mjs            # build it (re-runnable)
 *     node scripts/seed-clients-showcase.mjs --remove   # take it all away
 *
 * Owner, 2026-09-22: *"Also add some dummy data for the client so I can view the
 * exact same layout, all the colors, status, and everything. Emails, numbers,
 * and everything could be visible. I have quotations and I have invoices."*
 *
 * ── ⚠️ ONLY EVER THE DEMO PROJECT ──────────────────────────────────────────
 * Every row sits on the project whose name ends `[demo]`; the script refuses to
 * run without it. Chitral Royal Homes is a client and its people are real — the
 * standing rule is that their data is never used for testing, so nothing here
 * reads, moves or counts a Chitral row.
 *
 * ── ⚠️ NOTHING CAN BE SENT TO THESE PEOPLE, BY CONSTRUCTION ───────────────
 * Booking an appointment or a booking queues an AUTOMATIC WhatsApp message
 * (`crm_appointment_booked`, `crm_booking_payment_received`), and a new lead is
 * greeted. Every one of those triggers stands down on `whatsapp_consent =
 * false`, so every lead here carries it — and the greeting is also quieted with
 * `app.crm_quiet_insert`. Follow-ups are `remind_me` calls, never `auto_send`.
 * Numbers are `+92 300 000 00NN`, in no allocated range (seed-desk-showcase's
 * rule); emails end in `.example`, a domain reserved never to deliver.
 *
 * ── ⚠️ DIFFERENT NAMES FROM THE DESIGN'S ──────────────────────────────────
 * The desk showcase already put "Faisal Rehman", "Ayesha Noor", "Kamran
 * Sheikh" and "Hina Shahzad" on the demo project as LEADS. The same names again
 * as clients would read as a duplicate-import bug on the Lead desk. So each
 * design row has its twin here — same status, same colour, same shape of data —
 * under another name.
 *
 * ── ⚠️ DATES ARE RELATIVE TO NOW ──────────────────────────────────────────
 * "Call overdue · 2 days" has to stay two days overdue whenever this is run.
 * ========================================================================= */

import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const remove = process.argv.includes('--remove');
const PREFIX = 'clientshow:';
const MARK = '[demo] Showcase client for the Clients page.';

function env() {
  const out = {};
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|(.*?))\s*$/);
    if (m && !(m[1] in out)) out[m[1]] = m[2] ?? m[3] ?? (m[4] || '').replace(/\s+#.*$/, '').trim();
  }
  return out;
}

const E = env();
const sql = postgres(E.DATABASE_URL, { prepare: false, ssl: 'require', max: 1, onnotice: () => {} });

const H = 3600_000;
const D = 24 * H;
const now = Date.now();
const ago = (days, hours = 0) => new Date(now - days * D - hours * H).toISOString();

/** A Karachi wall-clock time on a day relative to today (Karachi is UTC+5, no DST). */
function karachiAt(dayOffset, hour24, minute = 0) {
  const d = new Date(now + dayOffset * D);
  const ymd = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  return new Date(`${ymd}T${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:00`).toISOString();
}
const karachiDate = (dayOffset) => new Date(now + dayOffset * D).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

/* ── The twelve, one for every colour the two designs show ───────────────── */
const CLIENTS = [
  {
    // the design's Faisal Rehman: active, booked PKR 4.5M, follow-up tomorrow
    name: 'Arsalan Siddiqui', company: 'Siddiqui Estates', city: 'Islamabad', channel: 'whatsapp', owner: 'Sarah',
    email: 'arsalan@siddiqui-estates.example', status: 'active', source: 'referral', addedDaysAgo: 38, stage: 'negotiation',
    quotes: [
      { n: 'QT-7101', status: 'sent', amount: 4_500_000, prop: 0, sentDaysAgo: 12 },
      { n: 'QT-7102', status: 'approved', amount: 4_650_000, prop: 1 },
    ],
    booking: { amount: 4_500_000, quote: 0, daysAgo: 10 },
    invoices: [
      { what: 'Booking token — Plot A101', amount: 450_000, paid: 450_000, issuedDaysAgo: 10, dueIn: -3 },
      { what: 'First instalment — Plot A101', amount: 900_000, paid: 0, issuedDaysAgo: 2, dueIn: 12 },
    ],
    visits: [{ kind: 'site_visit', status: 'completed', at: ago(9), outcome: 'Walked the plot with his brother; liked the corner.' }],
    followUps: [{ title: 'Confirm the first instalment date', dueDay: 1, hour: 11, status: 'planned', purpose: 'payment_reminder' }],
    messages: [
      { dir: 'inbound', body: 'Received the payment plan, thank you.', at: ago(2, 3) },
      { dir: 'outbound', body: 'Sharing the instalment schedule for Plot A101.', at: ago(1, 2) },
    ],
  },
  {
    // the design's Ayesha Noor: prospect, quoted PKR 850K, send the quotation today
    name: 'Mahnoor Qazi', company: null, city: 'Lahore', channel: 'call', owner: 'Sarah',
    email: 'mahnoor.qazi@example.com', status: 'prospect', source: 'meta_lead_ad', addedDaysAgo: 6, stage: 'qualified',
    quotes: [{ n: 'QT-7103', status: 'approved', amount: 850_000, prop: null }],
    visits: [{ kind: 'office_visit', status: 'completed', at: ago(4), outcome: 'Came to the office with her husband; asked for the smaller plan.' }],
    next: { text: 'Send quotation', type: 'task', at: karachiAt(0, 18, 30) },
    messages: [{ dir: 'outbound', body: 'Thank you for visiting — the quotation follows today.', at: ago(3, 5) }],
  },
  {
    // the design's Kamran Sheikh: needs attention, call overdue two days, quoted PKR 2.1M
    name: 'Tariq Mehmood', company: 'AGC Construction', city: 'Karachi', channel: 'call', owner: 'Sarah',
    email: 'tariq@agc-construction.example', status: 'active', source: 'website', addedDaysAgo: 41, stage: 'negotiation',
    quotes: [
      { n: 'QT-7104', status: 'expired', amount: 1_950_000, prop: null },
      { n: 'QT-7105', status: 'sent', amount: 2_100_000, prop: null, sentDaysAgo: 6 },
    ],
    followUps: [
      { title: 'Share the revised price', dueDay: -14, hour: 12, status: 'done', purpose: 'quotation' },
      { title: 'Check he received the quotation', dueDay: -8, hour: 11, status: 'done', purpose: 'quotation' },
      { title: 'Ask about the site team', dueDay: -5, hour: 15, status: 'done', purpose: 'custom' },
    ],
    next: { text: 'Call', type: 'call', at: karachiAt(-2, 11, 0) },
    messages: [{ dir: 'outbound', body: 'Revised quotation QT-7105 attached.', at: ago(6, 1) }],
  },
  {
    // the design's Hina Shahzad: onboarding, meeting in three days, PKR 1.2M
    name: 'Hira Nadeem', company: 'Etemaad100 Group', city: 'Rawalpindi', channel: 'whatsapp', owner: 'Sahad',
    email: 'hira@etemaad100.example', status: 'onboarding', source: 'referral', addedDaysAgo: 12, stage: 'visit_scheduled',
    booking: { amount: 1_200_000, quote: null, daysAgo: 5 },
    visits: [{ kind: 'meeting', status: 'scheduled', at: karachiAt(3, 11, 0) }],
    next: { text: 'Meeting', type: 'meeting', at: karachiAt(3, 10, 59) },
    messages: [{ dir: 'outbound', body: 'Your onboarding meeting is confirmed for Thursday at 11.', at: ago(1, 4) }],
  },
  {
    // the design's Mohsin Ahmed: dormant, no activity for 45 days, PKR 650K
    name: 'Naveed Akhtar', company: 'Investo 21', city: 'Peshawar', channel: 'call', owner: 'Sarah',
    email: 'naveed@investo21.example', status: 'active', source: 'walk_in', addedDaysAgo: 70, stage: 'won',
    booking: { amount: 650_000, quote: null, daysAgo: 55 },
    invoices: [{ what: 'Full payment — service package', amount: 650_000, paid: 650_000, issuedDaysAgo: 52, dueIn: -45 }],
    messages: [{ dir: 'outbound', body: 'Thank you — the paid receipt is attached.', at: ago(45, 2) }],
  },
  {
    name: 'Hamza Yousuf', company: 'Yousuf Motors', city: 'Multan', channel: 'whatsapp', owner: 'Sahad',
    email: 'hamza@yousufmotors.example', status: 'active', source: 'google', addedDaysAgo: 47, stage: 'won',
    booking: { amount: 3_200_000, quote: null, daysAgo: 20 },
    invoices: [{ what: 'Second instalment', amount: 800_000, paid: 0, issuedDaysAgo: 3, dueIn: 12 }],
    visits: [{ kind: 'site_visit', status: 'scheduled', at: karachiAt(5, 15, 0) }],
    next: { text: 'Site visit', type: 'site_visit', at: karachiAt(5, 14, 59) },
    messages: [{ dir: 'outbound', body: 'See you at the site on Saturday at 3.', at: ago(2, 6) }],
  },
  {
    name: 'Zainab Ali', company: null, city: 'Faisalabad', channel: 'email', owner: 'Sarah',
    email: 'zainab.ali@example.com', status: 'prospect', source: 'instagram', addedDaysAgo: 3, stage: 'contacted',
    next: { text: 'Email', type: 'email', at: karachiAt(2, 12, 0) },
    messages: [{ dir: 'outbound', body: 'Brochure and price list sent by email.', at: ago(1, 7) }],
  },
  {
    name: 'Maryam Baig', company: 'Baig Textiles', city: 'Lahore', channel: 'whatsapp', owner: 'Sarah',
    email: 'maryam@baigtextiles.example', status: 'active', source: 'referral', addedDaysAgo: 75, stage: 'won',
    booking: { amount: 2_800_000, quote: null, daysAgo: 40 },
    invoices: [
      { what: 'Booking token', amount: 280_000, paid: 280_000, issuedDaysAgo: 40, dueIn: -30 },
      { what: 'First instalment', amount: 700_000, paid: 0, issuedDaysAgo: 20, dueIn: -5 },
    ],
    messages: [{ dir: 'outbound', body: 'A reminder that the first instalment was due on Wednesday.', at: ago(3, 3) }],
  },
  {
    name: 'Omar Farooq', company: 'Farooq & Sons', city: 'Islamabad', channel: 'call', owner: 'Sahad',
    email: 'omar@farooqandsons.example', status: 'onboarding', source: 'linkedin', addedDaysAgo: 9, stage: 'won',
    booking: { amount: 950_000, quote: null, daysAgo: 4 },
    invoices: [{ what: 'Setup fee', amount: 190_000, paid: 0, issuedDaysAgo: 1, dueIn: 20 }],
    next: { text: 'Call', type: 'call', at: karachiAt(0, 18, 0) },
    messages: [{ dir: 'outbound', body: 'Welcome aboard — your onboarding call is this evening.', at: ago(0, 5) }],
  },
  {
    name: 'Fatima Zaidi', company: 'Zaidi Consultants', city: 'Karachi', channel: 'email', owner: 'Sarah',
    email: 'fatima@zaidiconsultants.example', status: 'active', source: 'website', addedDaysAgo: 52, stage: 'won',
    booking: { amount: 1_750_000, quote: null, daysAgo: 30 },
    invoices: [
      { what: 'First half', amount: 875_000, paid: 875_000, issuedDaysAgo: 30, dueIn: -20 },
      { what: 'Second half', amount: 875_000, paid: 875_000, issuedDaysAgo: 14, dueIn: -4 },
    ],
    followUps: [{ title: 'Quarterly check-in', dueDay: 10, hour: 12, status: 'planned', purpose: 'custom' }],
    messages: [{ dir: 'outbound', body: 'Both invoices are marked paid — thank you.', at: ago(6, 2) }],
  },
  {
    name: 'Saad Javed', company: null, city: 'Rawalpindi', channel: 'whatsapp', owner: 'Sahad',
    email: 'saad.javed@example.com', status: 'prospect', source: 'whatsapp', addedDaysAgo: 2, stage: 'contacted',
    messages: [
      { dir: 'outbound', body: 'Sharing the corner plot details.', at: ago(1, 2) },
      { dir: 'inbound', body: 'Is the corner plot still available?', at: ago(0, 3) },
    ],
  },
  {
    name: 'Ali Raza', company: 'Raza Builders', city: 'Peshawar', channel: 'call', owner: 'Sarah',
    email: 'ali@razabuilders.example', status: 'dormant', source: 'walk_in', addedDaysAgo: 95, stage: 'contacted',
    archivedDaysAgo: 10,
    messages: [{ dir: 'outbound', body: 'Closing this for now — we are here when you are ready.', at: ago(60) }],
  },
];

async function clear(tx, project) {
  const leads = await tx`
    select id, client_id from public.crm_leads
     where project_id = ${project.id} and external_id like ${PREFIX + '%'}`;
  const clientIds = [...new Set(leads.map((l) => l.client_id).filter(Boolean))];
  if (leads.length) {
    const ids = leads.map((l) => l.id);
    /* Everything else cascades from the lead; messages and the log are deleted
       first because they are the two a session could never remove. */
    await tx`delete from public.crm_lead_messages where lead_id = any(${ids}::uuid[])`;
    await tx`delete from public.crm_lead_activity where lead_id = any(${ids}::uuid[])`;
    await tx`delete from public.crm_leads where id = any(${ids}::uuid[])`;
  }
  /* ⚠️ Only clients that carry this script's mark AND have no lead left. */
  const gone = await tx`
    delete from public.crm_clients c
     where (c.id = any(${clientIds}::uuid[]) or c.notes = ${MARK})
       and c.notes = ${MARK}
       and not exists (select 1 from public.crm_leads l where l.client_id = c.id)
    returning c.id`;
  return { leads: leads.length, clients: gone.length };
}

const run = async () => {
  const [project] = await sql`select id, name from public.projects where name like '%[demo]' limit 1`;
  if (!project) {
    console.error('No demo project found. Refusing to write client rows anywhere else.');
    process.exit(1);
  }

  if (remove) {
    const r = await sql.begin((tx) => clear(tx, project));
    console.log(`Removed ${r.clients} showcase client(s) and ${r.leads} lead(s) from ${project.name}.`);
    await sql.end();
    return;
  }

  const people = await sql`
    select u.id, u.full_name, u.department_role::text as dept_role
      from public.users u join public.departments d on d.id = u.department_id
     where d.key = 'sales' and u.is_active`;
  const owner = (name) => people.find((p) => p.full_name === name) ?? people.find((p) => p.dept_role !== 'manager');
  const manager = people.find((p) => p.dept_role === 'manager');
  const [admin] = await sql`
    select id from public.users where is_active and role in ('admin', 'super_admin') order by created_at limit 1`;
  if (!owner('Sarah') || !manager || !admin) {
    console.error('Need a salesperson, a sales manager and an admin. Refusing.');
    process.exit(1);
  }
  const props = await sql`
    select id from public.crm_properties where project_id = ${project.id} order by code limit 2`;
  const [form] = await sql`select id from public.crm_lead_forms where project_id = ${project.id} limit 1`;

  console.log(`project : ${project.name}`);
  console.log(`owners  : ${people.map((p) => p.full_name).join(', ')}\n`);

  await sql.begin(async (tx) => {
    /* The admin acts, so the Finance guards accept a paid invoice; the greeting
       trigger is told to stand down as well as seeing consent = false. */
    await tx`select set_config('app.user_id', ${admin.id}, true), set_config('app.crm_quiet_insert', 'on', true)`;
    const cleared = await clear(tx, project);
    if (cleared.leads) console.log(`cleared ${cleared.clients} previous showcase client(s)\n`);

    for (const [i, c] of CLIENTS.entries()) {
      const who = owner(c.owner);
      const phone = `+9230000000${String(41 + i).padStart(2, '0')}`;
      const added = ago(c.addedDaysAgo);
      const slug = c.name.toLowerCase().replace(/[^a-z]+/g, '-');

      const [client] = await tx`
        insert into public.crm_clients
          (full_name, phone_e164, email, city, notes, first_lead_at, converted_at, converted_by_id,
           created_at, company, source, owner_id, preferred_channel, status, archived_at, created_by_id)
        values (${c.name}, ${phone}, ${c.email}, ${c.city}, ${MARK}, ${added}, ${added}, ${who.id},
                ${added}, ${c.company}, ${c.source}::public.crm_lead_source, ${who.id}, ${c.channel}, ${c.status},
                ${c.archivedDaysAgo ? ago(c.archivedDaysAgo) : null}, ${who.id})
        returning id, ref_no`;

      const [lead] = await tx`
        insert into public.crm_leads
          (project_id, form_id, owner_id, client_id, source, external_id, full_name, phone, phone_e164, email, city,
           stage, submitted_at, imported_at, first_contacted_at, created_by_id, is_test_data,
           whatsapp_consent, preferred_channel, budget_band, authority, purpose, timeline, answers)
        values (${project.id}, ${form?.id ?? null}, ${who.id}, ${client.id}, 'manual', ${PREFIX + slug},
                ${c.name}, ${phone}, ${phone}, ${c.email}, ${c.city},
                'contacted', ${added}, ${added}, ${added}, ${who.id}, true,
                false, ${c.channel === 'call' ? 'call' : c.channel}::public.crm_followup_channel,
                '2m_to_4m', 'sole_decider', 'investment', '1_to_3_months', ${sql.json({ 'Added on': 'Clients showcase' })})
        returning id`;

      const quoteIds = [];
      for (const q of c.quotes ?? []) {
        const approved = q.status === 'approved' || q.status === 'sent' || q.status === 'expired';
        const [row] = await tx`
          insert into public.crm_quotations
            (lead_id, property_id, project_id, number, base_price, net_amount, valid_until, status,
             prepared_by_id, approved_by_id, approved_at, sent_at, is_test_data)
          values (${lead.id}, ${q.prop === null || q.prop === undefined ? null : (props[q.prop]?.id ?? null)}, ${project.id},
                  ${q.n}, ${q.amount}, ${q.amount}, ${karachiDate(q.status === 'expired' ? -3 : 21)},
                  ${q.status}::public.crm_quotation_status, ${who.id},
                  ${approved ? manager.id : null}, ${approved ? ago((q.sentDaysAgo ?? 3) + 1) : null},
                  ${q.status === 'sent' || q.status === 'expired' ? ago(q.sentDaysAgo ?? 14) : null}, true)
          returning id`;
        quoteIds.push(row.id);
      }

      let bookingId = null;
      if (c.booking) {
        /* ⚠️ No property on the booking: `crm_booking_holds_property` would mark
           a demo plot reserved, and the catalogue is demo data other pages use. */
        const [b] = await tx`
          insert into public.crm_bookings
            (lead_id, project_id, quotation_id, status, amount, requested_at, verification_requested_at, created_by_id, is_test_data)
          values (${lead.id}, ${project.id}, ${c.booking.quote === null ? null : quoteIds[c.booking.quote]},
                  'pending_verification', ${c.booking.amount}, ${ago(c.booking.daysAgo)}, ${ago(c.booking.daysAgo)}, ${who.id}, true)
          returning id`;
        bookingId = b.id;
      }

      for (const inv of c.invoices ?? []) {
        await tx`
          insert into public.crm_invoices
            (lead_id, project_id, booking_id, description, amount, paid_amount, issued_at, due_at, created_by_id, is_test_data)
          values (${lead.id}, ${project.id}, ${bookingId}, ${inv.what}, ${inv.amount}, ${inv.paid},
                  ${karachiDate(-inv.issuedDaysAgo)}, ${karachiDate(inv.dueIn)}, ${who.id}, true)`;
      }

      for (const v of c.visits ?? []) {
        const done = v.status === 'completed';
        await tx`
          insert into public.crm_appointments
            (lead_id, project_id, kind, status, scheduled_at, duration_minutes, location, owner_id,
             outcome, outcome_at, client_interested, created_by_id, is_test_data)
          values (${lead.id}, ${project.id}, ${v.kind}::public.crm_appointment_kind, ${v.status}::public.crm_appointment_status,
                  ${v.at}, 60, ${v.kind === 'site_visit' ? 'Project site' : 'Islamabad office'}, ${who.id},
                  ${done ? v.outcome : null}, ${done ? v.at : null}, ${done ? true : null}, ${who.id}, true)`;
      }

      for (const f of c.followUps ?? []) {
        const due = karachiAt(f.dueDay, f.hour);
        await tx`
          insert into public.crm_follow_ups
            (lead_id, purpose, channel, mode, status, title, due_at, done_at, done_by_id, assigned_to_id, created_by_id)
          values (${lead.id}, ${f.purpose}::public.crm_followup_purpose, 'call', 'remind_me', ${f.status}::public.crm_followup_status,
                  ${f.title}, ${due}, ${f.status === 'done' ? due : null}, ${f.status === 'done' ? who.id : null}, ${who.id}, ${who.id})`;
      }

      for (const [k, m] of (c.messages ?? []).entries()) {
        await tx`
          insert into public.crm_lead_messages (lead_id, wa_message_id, direction, kind, body, occurred_at, status, sent_by_id)
          values (${lead.id}, ${`${PREFIX}${lead.id}:${k}`}, ${m.dir}::public.crm_message_direction, 'text', ${m.body}, ${m.at},
                  ${m.dir === 'outbound' ? 'read' : null}::public.crm_message_status, ${m.dir === 'outbound' ? who.id : null})`;
      }

      /* Last, so no trigger above overwrites it: the stage and what is owed next. */
      await tx`
        update public.crm_leads
           set stage = ${c.stage}::public.crm_stage,
               next_action = ${c.next?.text ?? null},
               next_action_type = ${c.next?.type ?? null}::public.crm_next_action_kind,
               next_action_at = ${c.next?.at ?? null},
               whatsapp_consent = false
         where id = ${lead.id}`;

      console.log(`  CLI-${String(client.ref_no).padStart(5, '0')}  ${c.name.padEnd(17)} ${c.status.padEnd(11)} ${who.full_name}`);
    }
  });

  /* ⚠️ PROVE THE SAFETY CLAIM, DO NOT ASSERT IT. */
  const [unsafe] = await sql`
    select count(*)::int as n from public.crm_follow_ups f join public.crm_leads l on l.id = f.lead_id
     where l.external_id like ${PREFIX + '%'} and f.mode = 'auto_send' and f.status in ('planned', 'due')`;
  const [consent] = await sql`
    select count(*) filter (where whatsapp_consent is distinct from false)::int as n
      from public.crm_leads where external_id like ${PREFIX + '%'}`;
  console.log(`\n${CLIENTS.length} showcase clients on ${project.name}.`);
  console.log(`automatic messages queued for them: ${unsafe.n}   leads without consent=false: ${consent.n}`);
  if (unsafe.n || consent.n) {
    console.error('⚠️ Something could be sent to a showcase number — run with --remove and investigate.');
    process.exitCode = 1;
  }
  await sql.end();
};

run().catch(async (e) => {
  console.error(e.message, e.detail ?? '', e.where ?? '');
  await sql.end();
  process.exit(1);
});
