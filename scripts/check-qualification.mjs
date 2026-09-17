/* Does the gate work through the APPLICATION's own statements, as a real
   salesperson? The migration proved the trigger; this proves the path the
   server action actually takes, including the column grant. */
import fs from 'node:fs';
import postgres from 'postgres';
const raw = fs.readFileSync('.env.local', 'utf8');
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|(.*?))\s*$/);
  if (m) env[m[1]] = m[2] ?? m[3] ?? (m[4] || '').replace(/\s+#.*$/, '').trim();
}
const sql = postgres(env.DATABASE_URL, { prepare: false, ssl: 'require', connect_timeout: 20 });
const as = (id, fn) => sql.begin(async (tx) => {
  await tx`select set_config('role','cni_app',true), set_config('app.user_id',${id},true)`;
  return fn(tx);
});
let fail = 0;
const say = (ok, l) => { if (!ok) fail++; console.log(`${ok ? '\x1b[32m  ok \x1b[0m' : '\x1b[31mFAIL \x1b[0m'} ${l}`); };

try {
  const [lead] = await sql`
    select l.id, l.full_name, u.full_name as owner, l.stage::text, l.owner_id
      from crm_leads l join users u on u.id = l.owner_id
     where l.is_test_data and l.stage::text = 'contacted' limit 1`;
  if (!lead) throw new Error('no contacted demo lead to test with');
  console.log(`\n${lead.full_name}, owned by ${lead.owner}, at ${lead.stage}\n`);

  const before = await sql`select budget_band, authority, purpose, timeline, temperature::text, stage::text from crm_leads where id = ${lead.id}`;

  // 1 · the gate refuses
  let refused = false;
  try { await as(lead.owner_id, (tx) => tx`update crm_leads set stage='qualified' where id=${lead.id}`); }
  catch (e) { refused = e.code === 'CRM08'; if (refused) console.log(`      detail: ${e.detail}`); }
  say(refused, 'the stage dropdown is refused with CRM08, and the error NAMES what is missing');

  // 2 · the salesperson can write the answers (the 166 lesson)
  await as(lead.owner_id, (tx) => tx`
    update crm_leads set budget_band='4m_to_6m', authority='shares_decision',
           purpose='build_to_live', timeline='1_to_3_months', payment_mode='instalments',
           location_preference='Block A', qualification_note='Near the park.',
           temperature='warm'
     where id=${lead.id}`);
  const [after] = await sql`select budget_band::text, timeline::text, temperature::text from crm_leads where id=${lead.id}`;
  say(after.budget_band === '4m_to_6m' && after.timeline === '1_to_3_months',
      'a salesperson can write all four answers — the column grant is real');

  // 3 · now the gate opens
  await as(lead.owner_id, (tx) => tx`update crm_leads set stage='qualified' where id=${lead.id}`);
  const [q] = await sql`select stage::text, qualified_at, qualified_by_id from crm_leads where id=${lead.id}`;
  say(q.stage === 'qualified', 'and the same statement now succeeds');
  say(q.qualified_at !== null && String(q.qualified_by_id) === String(lead.owner_id),
      'qualified_at and qualified_by are stamped by the trigger, not the app');

  // 4 · a colleague still cannot touch it
  /* A PEER, NOT THE MANAGER. `department_role = 'manager'` is meant to reach the
     whole department's leads — picking the first colleague in the table found the
     manager and reported their correct access as a failure. The boundary that
     matters is one salesperson against another. */
  const [peer] = await sql`
    select id, full_name from users where id <> ${lead.owner_id}
      and department_id = (select department_id from users where id = ${lead.owner_id})
      and department_role = 'member' and is_active limit 1`;
  if (!peer) throw new Error('no peer salesperson — the boundary cannot be proved');
  const rows = await as(peer.id, (tx) => tx`update crm_leads set budget_band='over_10m' where id=${lead.id} returning id`);
  say(rows.length === 0, `${peer.full_name}, a peer, cannot rewrite a colleague's qualification`);

  /* ⚠️ AND THE MANAGER CAN, which is not a leak — it is the owner's own rule
     that a sales manager sees every lead and may move one between salespeople.
     Asserted so that if it ever stops being true, it is noticed here. */
  const [mgr] = await sql`
    select id, full_name from users
     where department_id = (select department_id from users where id = ${lead.owner_id})
       and department_role = 'manager' and is_active limit 1`;
  if (mgr) {
    const m = await as(mgr.id, (tx) => tx`update crm_leads set qualification_note='seen by manager' where id=${lead.id} returning id`);
    say(m.length === 1, `${mgr.full_name}, the manager, still can — by design`);
  }

  // restore
  await sql`update crm_leads set stage=${before[0].stage}::crm_stage,
      budget_band=${before[0].budget_band}, authority=${before[0].authority},
      purpose=${before[0].purpose}, timeline=${before[0].timeline},
      temperature=${before[0].temperature}::crm_temperature,
      payment_mode=null, location_preference=null, qualification_note=null,
      qualified_at=null, qualified_by_id=null where id=${lead.id}`;
  console.log('\n      (lead restored to how it was)');
} catch (e) { fail++; console.log(`\x1b[31mFAIL \x1b[0m ${e.message}`); }
finally { await sql.end(); }
console.log(fail === 0 ? '\n\x1b[32mAll good.\x1b[0m' : `\n\x1b[31m${fail} failed.\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
