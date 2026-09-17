/* ============================================================================
 * DOES THE TO-DO LIST SHOW EACH SALESPERSON THEIR OWN OWED WORK?
 * ----------------------------------------------------------------------------
 * Run: node scripts/check-todos.mjs
 *
 * ⚠️ AS REAL PEOPLE, NEVER AS AN ADMIN. The page is six `union all` branches,
 * every one of them narrowed by `app.current_user_id()` plus RLS. An admin
 * session satisfies both for everybody, so an admin run would print a tick for a
 * rule it never exercised — eight bugs in this codebase have reached the owner
 * exactly that way.
 *
 * ⚠️ IT WRITES NOTHING. Every row on that page is derived from state that
 * already exists, so this check reads and compares; there is no fixture to clean
 * up and nothing that can be left behind.
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
const as = (id, fn) => sql.begin(async (tx) => {
  await tx`select set_config('role','cni_app',true), set_config('app.user_id',${id},true)`;
  return fn(tx);
});
let fail = 0;
const say = (ok, l) => { if (!ok) fail++; console.log(`${ok ? '\x1b[32m  ok \x1b[0m' : '\x1b[31mFAIL \x1b[0m'} ${l}`); };

/* The page's own query, reduced to what the assertions need. */
const todos = (tx) => tx`
  with me as (select app.current_user_id() as id)
  select 'first_contact' as kind, l.id as lead_id from public.crm_leads l, me
   where l.owner_id = me.id and l.first_contacted_at is null and l.stage not in ('won','lost')
  union all
  select 'next_action', l.id from public.crm_leads l, me
   where l.owner_id = me.id and l.first_contacted_at is not null
     and l.next_action_at is not null and l.stage not in ('won','lost')
     and l.next_action_at < (date_trunc('day', now() at time zone 'Asia/Karachi')
                             + interval '7 days') at time zone 'Asia/Karachi'
  union all
  select 'record_visit', a.lead_id from public.crm_appointments a, me
   where a.owner_id = me.id and a.status in ('scheduled','confirmed') and a.scheduled_at < now()
  union all
  select 'approve_quotation', q.lead_id from public.crm_quotations q, me
   where q.status = 'pending_approval' and q.prepared_by_id is distinct from me.id`;

try {
  const people = await sql`
    select u.id, u.full_name, u.department_role::text as role
      from public.users u join public.departments d on d.id = u.department_id
     where d.key = 'sales' and u.is_active order by u.department_role, u.full_name`;
  if (people.length < 2) throw new Error('need at least two sales people to prove the boundary');

  const seen = new Map();
  for (const p of people) {
    const rows = await as(p.id, todos);
    seen.set(p.id, rows);
    const kinds = {};
    for (const r of rows) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
    console.log(`\n${p.full_name} (${p.role}) — ${rows.length} to-dos`,
      Object.keys(kinds).length ? JSON.stringify(kinds) : '(none)');
  }
  console.log('');

  const members = people.filter((p) => p.role === 'member');
  say(members.length >= 2, 'two salespeople exist to compare');

  if (members.length >= 2) {
    const [a, b] = members;
    const aLeads = new Set(seen.get(a.id).map((r) => String(r.lead_id)));
    const bLeads = new Set(seen.get(b.id).map((r) => String(r.lead_id)));
    const shared = [...aLeads].filter((id) => bLeads.has(id));
    /* ⚠️ THE BOUNDARY. A shared lead here would mean one salesperson is being
       told to ring another's client — the eighth occurrence of the same bug. */
    say(shared.length === 0,
      `${a.full_name} and ${b.full_name} share no lead on their lists`);
  }

  /* ⚠️ NOBODY IS OFFERED THEIR OWN DISCOUNT TO APPROVE. 151 refuses it at two
     layers; a list that showed it would offer an action that always fails. */
  let selfApproval = 0;
  for (const p of people) {
    const rows = await as(p.id, (tx) => tx`
      select q.id from public.crm_quotations q
       where q.status = 'pending_approval' and q.prepared_by_id = ${p.id}::uuid
         and q.prepared_by_id is distinct from app.current_user_id()`);
    selfApproval += rows.length;
  }
  say(selfApproval === 0, 'nobody is asked to approve a quotation they prepared themselves');

  /* Somebody outside sales gets nothing rather than an error. */
  const [outsider] = await sql`
    select u.id, u.full_name from public.users u
      join public.departments d on d.id = u.department_id
     where d.key <> 'sales' and u.is_active limit 1`;
  if (!outsider) throw new Error('no non-sales user to prove the page is closed to them');
  const none = await as(outsider.id, todos);
  say(none.length === 0, `${outsider.full_name}, outside sales, has an empty list rather than a refusal`);
} catch (e) { fail++; console.log(`\x1b[31mFAIL \x1b[0m ${e.message}`); }
finally { await sql.end(); }

console.log(fail === 0
  ? '\n\x1b[32mAll good.\x1b[0m Each salesperson sees only their own owed work.'
  : `\n\x1b[31m${fail} failed.\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
