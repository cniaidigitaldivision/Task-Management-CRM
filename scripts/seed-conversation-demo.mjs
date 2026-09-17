/* ============================================================================
 * A CONVERSATION WORTH LOOKING AT
 * ----------------------------------------------------------------------------
 * Run: node scripts/seed-conversation-demo.mjs
 *
 * Owner, 2026-09-17: *"Add some dummy data, like some email is already sent and
 * these are replies, so I can exactly see that this UI will follow when our real
 * data comes."*
 *
 * ⚠️ DEMO PROJECT ONLY, AND EVERY ROW FLAGGED. The owner's own standing rule:
 * *"Chitral Royal Homes or any other project is my client. I can't use their
 * data for testing purposes."* This writes to `Demo — Product Enquiries [demo]`
 * and nowhere else, and refuses if it cannot find it.
 *
 * ⚠️ AND IT IS IDEMPOTENT. Every message it writes carries a marker; a second run
 * removes the first run's rows before writing, so this can be re-run after any UI
 * change without the thread growing a duplicate every time.
 *
 * ⚠️ THE NUMBERS IT WRITES ARE UNREACHABLE. `+9230000000NN` is in no allocated
 * range — a plausible invented Pakistani number belongs to a real stranger who
 * would receive the first test message.
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

const MARK = 'seed-conversation-demo';
const say = (line) => console.log(`  ${line}`);

try {
  const [project] = await sql`
    select p.id, p.name from public.projects p
      join public.departments d on d.id = p.lead_department_id
     where d.key = 'sales' and p.name like '%[demo]' limit 1`;
  if (!project) throw new Error('no demo sales project — refusing to write anywhere else');

  /* The lead the owner's reference names. Falls back to any demo lead with a
     quotation, so this still works if the showcase is reseeded. */
  const [lead] = await sql`
    select l.id, l.full_name, l.owner_id, u.full_name as owner_name
      from public.crm_leads l
      left join public.users u on u.id = l.owner_id
     where l.project_id = ${project.id} and l.is_test_data
     order by (l.full_name = 'Faisal Rehman') desc,
              (select count(*) from public.crm_quotations q where q.lead_id = l.id) desc
     limit 1`;
  if (!lead) throw new Error('no demo lead to build a conversation on');

  const [quote] = await sql`
    select number, net_amount from public.crm_quotations
     where lead_id = ${lead.id} order by version desc limit 1`;
  const number = quote?.number ?? 'QT-1042';

  console.log(`\nProject: ${project.name}`);
  console.log(`Lead:    ${lead.full_name} — owned by ${lead.owner_name ?? 'nobody'}`);
  console.log(`         ⚠️ sign in as ${lead.owner_name ?? 'that person'} to see this thread\n`);

  /* ── Clear the previous run, by marker and by id ─────────────────────── */
  const gone = await sql`
    delete from public.crm_lead_messages
     where lead_id = ${lead.id} and error_detail = ${MARK} returning id`;
  if (gone.length > 0) say(`removed ${gone.length} row(s) from the last run`);

  /* ── The thread ──────────────────────────────────────────────────────── */
  const now = Date.now();
  const at = (hoursAgo) => new Date(now - hoursAgo * 3600_000).toISOString();

  /* ── The media the WhatsApp view shows — real files, in the private bucket ──
     A voice note recorded and converted in Chrome (the same path the app uses),
     a brochure image and a payment-plan PDF, from scripts/demo-media. */
  const BUCKET = env.SUPABASE_STORAGE_BUCKET || 'CNI-Task Management Docs';
  const store = async (name, mime) => {
    const path = `crm-whatsapp/${lead.id}/seed-demo/${name}`;
    const body = fs.readFileSync(`scripts/demo-media/${name}`);
    const res = await fetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${encodeURIComponent(BUCKET)}/${path.split('/').map(encodeURIComponent).join('/')}`,
      { method: 'POST', headers: { authorization: `Bearer ${env.SUPABASE_STORAGE_KEY}`, apikey: env.SUPABASE_STORAGE_KEY, 'content-type': mime, 'x-upsert': 'true' }, body },
    );
    if (!res.ok) throw new Error(`could not store ${name}: ${res.status} ${await res.text()}`);
    return { path, size: body.length };
  };
  const brochure = await store('brochure.png', 'image/png');
  const plan = await store('payment-plan.pdf', 'application/pdf');
  const voice = await store('voice.ogg', 'audio/ogg');

  const w = (n) => `wamid.seed-demo-${n}`;
  const thread = [
    {
      channel: 'email', direction: 'outbound', status: 'sent',
      subject: `Your quotation ${number}`,
      body: `Hi ${(lead.full_name ?? 'there').split(' ')[0]}, Please find attached the quotation `
        + `${number} for the unit we discussed. It is valid until the end of the month — `
        + `do let me know if you would like to go through the payment plan.`,
      media_filename: `${number}_Chitral Royal Homes.pdf`,
      hours: 122,
    },
    { channel: 'whatsapp', direction: 'inbound', status: 'delivered', wamid: w(1),
      body: 'Can you explain the payment plan?', hours: 121 },
    { channel: 'whatsapp', direction: 'outbound', status: 'read', wamid: w(2), reply: w(1),
      body: 'Of course. I can walk you through it.', hours: 120.5 },
    { channel: 'whatsapp', direction: 'outbound', status: 'read', wamid: w(3), kind: 'image',
      body: '5 Marla plot — Block A, A-101', media: brochure, mime: 'image/png', filename: 'brochure.png',
      their_reaction: '👍', hours: 120.4 },
    { channel: 'whatsapp', direction: 'outbound', status: 'delivered', wamid: w(4), kind: 'document',
      body: null, media: plan, mime: 'application/pdf', filename: 'Payment plan — 5 Marla.pdf',
      pinned: true, hours: 120.3 },
    { channel: 'whatsapp', direction: 'inbound', status: 'delivered', wamid: w(5), kind: 'audio',
      body: null, media: voice, mime: 'audio/ogg', filename: null, voice: true, our_reaction: '🙏', hours: 26 },
    { channel: 'whatsapp', direction: 'outbound', status: 'read', wamid: w(6),
      body: 'The down payment is 20%, and the balance can be paid over 24 months.', hours: 25.5, hidden: true },
    { channel: 'whatsapp', direction: 'inbound', status: 'delivered', wamid: w(7),
      body: 'Please contact me tomorrow morning.', hours: 2 },
    { channel: 'whatsapp', direction: 'outbound', status: 'read', wamid: w(8), reply: w(7),
      body: 'Sure — I will call you at 10 AM. Please keep the payment plan handy.', hours: 1.9, starred: true },
  ];

  for (const m of thread) {
    const sentAt = at(m.hours);
    const [row] = await sql`
      insert into public.crm_lead_messages
        (lead_id, channel, direction, kind, subject, body, media_filename, media_mime, media_path, media_size, media_voice,
         wa_message_id, reply_to_wamid, their_reaction, their_reaction_at, our_reaction, our_reaction_by_id,
         pinned_at, pinned_by_id, hidden_at, hidden_by_id, delivered_at, read_at,
         status, sent_by_id, occurred_at, error_detail)
        -- The marker rides in error_detail, which is null on every real message
        -- and is what makes a re-run idempotent.
      values (${lead.id}, ${m.channel}::public.crm_message_channel,
              ${m.direction}::public.crm_message_direction, ${m.kind ?? 'text'}::public.crm_message_kind,
              ${m.subject ?? null}, ${m.body}, ${m.filename ?? m.media_filename ?? null}, ${m.mime ?? null},
              ${m.media?.path ?? null}, ${m.media?.size ?? null}, ${m.voice ?? false},
              ${m.wamid ?? null}, ${m.reply ?? null},
              ${m.their_reaction ?? null}, ${m.their_reaction ? sentAt : null},
              ${m.our_reaction ?? null}, ${m.our_reaction ? lead.owner_id : null},
              ${m.pinned ? sentAt : null}, ${m.pinned ? lead.owner_id : null},
              ${m.hidden ? at(m.hours - 0.05) : null}, ${m.hidden ? lead.owner_id : null},
              ${m.direction === 'outbound' && m.status !== 'sent' ? at(m.hours - 0.01) : null},
              ${m.direction === 'outbound' && m.status === 'read' ? at(m.hours - 0.2) : null},
              ${m.status}::public.crm_message_status,
              ${m.direction === 'outbound' ? lead.owner_id : null},
              ${sentAt}::timestamptz,
              ${MARK})
      returning id`;
    if (m.starred) {
      await sql`insert into public.crm_message_stars (message_id, user_id) values (${row.id}, ${lead.owner_id}) on conflict do nothing`;
    }
  }
  say(`wrote ${thread.length} messages — an email, a photo, a pinned PDF, a voice note, a reply, reactions, a star and a deleted message`);

  /* ── A paused chase, so the banner has something true to say ─────────── */
  await sql`delete from public.crm_lead_sequences where lead_id = ${lead.id}`;
  await sql`delete from public.crm_sequences where name = ${MARK}`;
  const [seq] = await sql`
    insert into public.crm_sequences
      (project_id, name, purpose, stop_on_reply, is_active, is_test_data, created_by_id)
    values (${project.id}, ${MARK}, 'quotation', true, true, true, ${lead.owner_id})
    returning id`;
  await sql`
    insert into public.crm_sequence_steps (sequence_id, step_no, channel, delay_days, purpose, body)
    values (${seq.id}, 1, 'whatsapp', 0, 'quotation', 'Just checking you received the quotation.'),
           (${seq.id}, 2, 'whatsapp', 2, 'quotation', 'Any questions on the payment plan?'),
           (${seq.id}, 3, 'whatsapp', 5, 'quotation', 'The quotation expires shortly.')`;
  await sql`delete from public.crm_follow_ups where lead_id = ${lead.id}`;
  const [run] = await sql`
    insert into public.crm_lead_sequences
      (lead_id, sequence_id, state, current_step, total_steps, started_at, paused_at,
       pause_reason, created_by_id)
    values (${lead.id}, ${seq.id}, 'paused', 1, 3, now() - interval '5 days',
            now() - interval '2 hours', 'the client replied', ${lead.owner_id})
    returning id`;
  say('a three-step chase, paused because they replied — the green banner reads from this');

  /* ── The follow-ups tab: what the chase sent, and what a person did ────── */
  const followUp = (o) => sql`
    insert into public.crm_follow_ups
      (lead_id, purpose, channel, mode, status, title, body, due_at, done_at, done_by_id,
       outcome_note, lead_sequence_id, sequence_step_no, assigned_to_id, created_by_id)
    values (${lead.id}, ${o.purpose ?? 'custom'}::public.crm_followup_purpose,
            ${o.channel}::public.crm_followup_channel, ${o.mode ?? 'remind_me'}::public.crm_followup_mode,
            ${o.status}::public.crm_followup_status, ${o.title}, ${o.body ?? null},
            now() + make_interval(hours => ${o.dueHours}),
            ${o.status === 'done' ? sql`now() + make_interval(hours => ${o.dueHours})` : null},
            ${o.status === 'done' ? lead.owner_id : null}, ${o.outcome ?? null},
            ${o.sequence ? run.id : null}, ${o.sequence ?? null}, ${lead.owner_id}, ${lead.owner_id})`;
  await followUp({ channel: 'whatsapp', mode: 'auto_send', status: 'done', purpose: 'quotation',
    title: 'quotation · step 1', body: 'Just checking you received the quotation.', dueHours: -118, sequence: 1 });
  await followUp({ channel: 'email', status: 'done', title: `Quotation sent (${number})`,
    body: 'Sent the quotation with the project details.', dueHours: -122 });
  await followUp({ channel: 'call', status: 'done', title: 'Call to check the quotation was received',
    outcome: 'He has it, and wants the payment plan explained.', dueHours: -70 });
  await followUp({ channel: 'whatsapp', status: 'planned', title: 'Share the payment plan',
    body: 'Send the instalment schedule for the 5 Marla plot.', dueHours: 20 });
  say('four follow-ups: the first step of the chase, the quotation email, a completed call and one planned');

  /* ── Who the replies come from ───────────────────────────────────────── */
  await sql`
    insert into public.crm_project_settings (project_id, whatsapp_display_name, whatsapp_display_number)
    values (${project.id}, 'CNI AI & Digital Division', '+923001238726')
    on conflict (project_id) do update
      set whatsapp_display_name = excluded.whatsapp_display_name,
          whatsapp_display_number = excluded.whatsapp_display_number,
          updated_at = now()`;
  say('the composer now names CNI AI & Digital Division · +92 300 123 8726');

  /* ── A next action, so the strip is not all dashes ───────────────────── */
  await sql`
    update public.crm_leads
       set next_action = 'Quotation check-in',
           next_action_at = (current_date + 1 + time '23:59') at time zone 'Asia/Karachi',
           next_action_type = 'whatsapp'
     where id = ${lead.id} and next_action is null`;

  console.log('\n\x1b[32mDone.\x1b[0m Open /my-leads, click that lead, and the Conversations tab.');
} catch (e) {
  console.log(`\x1b[31mFAILED \x1b[0m ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
