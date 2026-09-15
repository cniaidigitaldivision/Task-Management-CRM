/* ============================================================================
 * CAN SARAH ACTUALLY RECORD AN OUTCOME?
 * ----------------------------------------------------------------------------
 * Run: node scripts/check-outcome-write.mjs
 *
 * ⚠️ THIS EXISTS BECAUSE A DEFINER HID A MISSING GRANT FOR THREE MIGRATIONS.
 * `scripts/check-add-lead.mjs` runs as a real salesperson and passes — but
 * everything it exercises goes through `app.crm_create_lead`, which is SECURITY
 * DEFINER and therefore runs with the FUNCTION OWNER's privileges. A definer
 * masks a column grant completely.
 *
 * `recordOutcomeAction` has no definer. It runs as `cni_app` and meets 116's
 * column grant head-on — and had been failing with "permission denied for table
 * crm_leads" since migration 155 added columns it writes.
 *
 * ⚠️ SO THIS SENDS THE STATEMENT THE APPLICATION SENDS, under a real session,
 * with no function in between. Asking `information_schema` would confirm a grant
 * exists and prove nothing about whether the actual UPDATE is allowed to run.
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

const as = (id, fn) =>
  sql.begin(async (tx) => {
    await tx`select set_config('role','cni_app',true), set_config('app.user_id',${id},true)`;
    return fn(tx);
  });

let failures = 0;
const say = (ok, line) => {
  if (!ok) failures += 1;
  console.log(`${ok ? '\x1b[32m  ok \x1b[0m' : '\x1b[31mFAIL \x1b[0m'} ${line}`);
};

let lead = null;
let before = null;

try {
  const [row] = await sql`
    select l.id, l.owner_id, u.full_name as owner, l.full_name,
           l.stage, l.lost_reason, l.last_outcome, l.last_outcome_at,
           l.last_outcome_by_id, l.next_action, l.next_action_type,
           l.next_action_at, l.closed_at
      from public.crm_leads l
      join public.projects p on p.id = l.project_id
      join public.users u on u.id = l.owner_id
     where p.name like '%[demo]' and l.stage not in ('won','lost')
     limit 1`;

  if (!row) { console.log('No open demo lead with an owner.'); process.exit(0); }
  lead = row;
  before = row;
  console.log(`\nRecording an outcome on ${row.full_name}, as ${row.owner}\n`);

  // 1 · The write the form performs, verbatim, with no definer.
  let err = null;
  try {
    await as(row.owner_id, (tx) => tx`
      update public.crm_leads
         set stage = 'qualified'::public.crm_stage,
             lost_reason = null,
             last_outcome = 'interested'::public.crm_outcome,
             last_outcome_at = now(),
             last_outcome_by_id = ${row.owner_id}::uuid,
             next_action = 'check-outcome-write.mjs',
             next_action_type = 'call'::public.crm_next_action_kind,
             next_action_at = now() + interval '1 day'
       where id = ${row.id}`);
  } catch (e) { err = e.message; }
  say(err === null, err ? `the outcome write was refused: ${err}` : 'the outcome write succeeds as the lead owner');

  const [after] = await sql`
    select stage::text, last_outcome::text, next_action_type::text, closed_at
      from public.crm_leads where id = ${row.id}`;
  say(after.last_outcome === 'interested', `last_outcome is recorded (${after.last_outcome})`);
  say(after.next_action_type === 'call', `next_action_type is recorded (${after.next_action_type})`);

  // 2 · ⚠️ CLOSING STAMPS closed_at WITHOUT THE APPLICATION WRITING IT.
  await as(row.owner_id, (tx) => tx`
    update public.crm_leads
       set stage = 'lost'::public.crm_stage, lost_reason = 'no_answer'::public.crm_lost_reason
     where id = ${row.id}`);
  const [closed] = await sql`select closed_at from public.crm_leads where id = ${row.id}`;
  say(closed.closed_at !== null, 'closing stamps closed_at — the trigger does it, not the app');

  // 3 · ⚠️ AND WHAT 116 PROTECTED IS STILL PROTECTED. A grant written too wide
  //     would pass every check above and quietly let a salesperson rewrite what
  //     a stranger typed into Meta's form.
  for (const col of ['full_name', 'phone', 'email', 'submitted_at', 'project_id']) {
    let refused = false;
    try {
      await as(row.owner_id, (tx) =>
        tx.unsafe(`update public.crm_leads set ${col} = null where id = $1`, [row.id]));
    } catch (e) { refused = /permission denied/i.test(e.message); }
    say(refused, `${col} is still refused`);
  }
} finally {
  if (lead && before) {
    await sql`
      update public.crm_leads
         set stage = ${before.stage}, lost_reason = ${before.lost_reason},
             last_outcome = ${before.last_outcome}, last_outcome_at = ${before.last_outcome_at},
             last_outcome_by_id = ${before.last_outcome_by_id},
             next_action = ${before.next_action}, next_action_type = ${before.next_action_type},
             next_action_at = ${before.next_action_at}, closed_at = ${before.closed_at}
       where id = ${lead.id}`;
  }
  await sql.end({ timeout: 5 });
}

console.log(failures === 0
  ? '\n\x1b[32mAll checks passed.\x1b[0m\n'
  : `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`);
process.exit(failures === 0 ? 0 : 1);
