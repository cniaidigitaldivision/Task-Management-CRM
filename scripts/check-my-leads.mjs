/* ============================================================================
 * IS "MY LEADS" ACTUALLY MINE?
 * ----------------------------------------------------------------------------
 * Run: node scripts/check-my-leads.mjs
 *
 * ⚠️ THIS EXISTS BECAUSE AN ADMIN SESSION CANNOT FIND THIS CLASS OF BUG. Six
 * migrations in this codebase — 105, 121, 125, 129, 130, 140 — are one bug that
 * reached the owner because every check was made from an account that sees
 * everything. This runs the page's own query under each real person's session
 * and prints what they would get.
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
    await tx`select set_config('role', 'cni_app', true)`;
    await tx`select set_config('app.user_id', ${id}, true)`;
    return fn(tx);
  });

const people = await sql`
  select u.id, u.full_name, u.role, u.department_role::text as dept_role, d.key as dept
    from public.users u left join public.departments d on d.id = u.department_id
   where u.is_active and (d.key = 'sales' or u.role in ('admin','super_admin'))
   order by d.key nulls last, u.full_name`;

let failures = 0;
const rows = [];

for (const p of people) {
  const r = await as(p.id, async (tx) => {
    /* The page's own counts. */
    const [c] = await tx`
      select count(*) as assigned,
             count(*) filter (
               where l.next_action_at is not null
                 and (l.next_action_at at time zone 'Asia/Karachi')::date
                     < (now() at time zone 'Asia/Karachi')::date) as overdue,
             count(*) filter (
               where (select m.direction from public.crm_lead_messages m
                       where m.lead_id = l.id
                       order by m.occurred_at desc, m.id desc limit 1) = 'inbound') as waiting
        from public.crm_leads l
       where l.owner_id = app.current_user_id()
         and l.stage not in ('won','lost')`;

    /* ⚠️ THE LEAK CHECK. Everything this session can read at all, owned by
       somebody else. For a salesperson it must be zero — that is RLS. For a
       manager it will not be, and the page's `mine` clause is what keeps their
       own list personal. */
    const [x] = await tx`
      select count(*) as n from public.crm_leads l
       where l.owner_id is not null and l.owner_id <> app.current_user_id()`;

    return { ...c, others: x.n };
  });

  /* ⚠️ `department_role`, NOT `users.role`. The sales MANAGER is a `member` in
     `users.role` — ADR-012 keeps them one deliberately, because promoting them
     to team_coordinator would hand them Finance. So "is this a plain
     salesperson" is a department question, and reading the app rank instead
     flags the manager as a leak when they are working exactly as designed:
     `crm_manages_project` lets them read the team, and the page's own `mine`
     clause is what keeps THEIR list personal. */
  const salesperson =
    p.dept === 'sales' &&
    p.dept_role !== 'manager' &&
    !['admin', 'super_admin'].includes(p.role);
  const leaks = salesperson && Number(r.others) > 0;
  if (leaks) failures += 1;

  rows.push({
    who: p.full_name,
    role: salesperson ? 'salesperson' : p.role,
    'my leads': Number(r.assigned),
    overdue: Number(r.overdue),
    'waiting on me': Number(r.waiting),
    "others' leads readable": Number(r.others),
    verdict: leaks
      ? '❌ LEAK'
      : salesperson
        ? '✅ own only'
        : '— sees the team by design; the page still shows only their own',
  });
}

console.table(rows);

/* ⚠️ AND THE TWO SALESPEOPLE MUST DIFFER. If Sarah and Sahad see the same set,
   the owner clause is not doing anything and the page only LOOKS personal. */
const sales = rows.filter((r) => r.role === 'salesperson');
if (sales.length >= 2) {
  const same = sales.every((r) => r['my leads'] === sales[0]['my leads']);
  if (same && sales[0]['my leads'] > 0) {
    console.log('\n⚠️  Every salesperson sees the same count — check the owner clause.');
    failures += 1;
  } else {
    console.log('\n✅ Salespeople see different sets, which is the point of the page.');
  }
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
