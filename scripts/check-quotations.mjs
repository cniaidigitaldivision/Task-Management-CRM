/* ============================================================================
 * CAN A SALESPERSON QUOTE, AND CAN THEY APPROVE THEIR OWN DISCOUNT?
 * ----------------------------------------------------------------------------
 * Run: node scripts/check-quotations.mjs
 *
 * ⚠️ THE SECOND QUESTION IS THE ONE THAT MATTERS. A discount is money the
 * division does not receive, and the rule that somebody else has to authorise it
 * is the only thing standing between a target and a price.
 *
 * ⚠️ AND IT IS ENFORCED AT TWO LAYERS, which is why these checks assert the
 * ROW'S FINAL STATE rather than an error code. RLS (42501) stops a salesperson
 * setting `approved` at all; the CHECK constraint (23514) would stop it even if
 * the policy let it through. A test written against one code fails the day the
 * other does the work — the first version of this script did exactly that and
 * reported a passing rule as broken.
 *
 * Everything runs as a real person, and cleans up on every path.
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

const MARK = 'QT-CHECK-';
const as = (id, fn) =>
  sql.begin(async (tx) => {
    await tx`select set_config('role','cni_app',true), set_config('app.user_id',${id},true)`;
    return fn(tx);
  });

let fail = 0;
const say = (ok, line) => {
  if (!ok) fail += 1;
  console.log(`${ok ? '\x1b[32m  ok \x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${line}`);
};
const clean = () => sql`delete from public.crm_quotations where number like ${MARK + '%'}`;

try {
  await clean();

  const [lead] = await sql`
    select l.id, l.full_name, l.owner_id, u.full_name as owner
      from public.crm_leads l
      join public.users u on u.id = l.owner_id
      join public.projects p on p.id = l.project_id
     where p.name like '%[demo]' and l.owner_id is not null limit 1`;
  const [mgr] = await sql`
    select id, full_name from public.users
     where department_role = 'manager' and is_active and id <> ${lead.owner_id} limit 1`;

  console.log(`\nQuoting on ${lead.full_name}, prepared by ${lead.owner}\n`);

  // 1 · A salesperson can raise one on their own lead.
  const raised = await as(lead.owner_id, (tx) => tx`
    insert into public.crm_quotations
      (lead_id, project_id, number, version, base_price, premium_charges,
       requested_discount, approved_discount, net_amount, status, prepared_by_id, is_test_data)
    select l.id, l.project_id, ${MARK + '1'}, 1, 4500000, 200000,
           300000, 0, 4400000, 'pending_approval', l.owner_id, l.is_test_data
      from public.crm_leads l where l.id = ${lead.id}
    returning id`);
  say(raised.length === 1, `${lead.owner} raised a quotation asking for a discount`);
  const qid = raised[0]?.id;

  if (qid) {
    /* ⚠️ THESE TWO ASSERT THE ROW'S FINAL STATE, NOT AN ERROR CODE, and the
       first version of this script got it wrong for exactly that reason. It
       accepted only 23514 (a CHECK violation) and reported a failure when the
       write was in fact refused with 42501 — RLS, which stops a salesperson
       setting `approved` at all, before the constraint is ever reached.

       The rule is "a salesperson cannot approve their own discount". WHICH layer
       refuses is an implementation detail and there are two of them; a test
       coupled to one would fail the day the other did the work. What must be
       true is that the row did not end up self-approved. */
    const selfApprove = async (setApprover) => {
      try {
        await as(lead.owner_id, (tx) =>
          setApprover
            ? tx`update public.crm_quotations
                    set status = 'approved', approved_by_id = ${lead.owner_id}::uuid, approved_at = now()
                  where id = ${qid}`
            : tx`update public.crm_quotations set status = 'approved' where id = ${qid}`);
      } catch {
        /* Refused loudly. Either way the row is what decides. */
      }
      const [row] = await sql`
        select status::text, approved_by_id from public.crm_quotations where id = ${qid}`;
      return row;
    };

    const a = await selfApprove(true);
    say(
      a.status !== 'approved' && a.approved_by_id === null,
      `${lead.owner} cannot approve their OWN discount — still ${a.status} (the whole point)`,
    );

    const b = await selfApprove(false);
    say(
      b.status !== 'approved',
      'and cannot be approved by nobody — "who authorised this?" stays answerable',
    );

    // 4 · A manager can, and the approved figure may differ from the request.
    if (mgr) {
      const ok = await as(mgr.id, (tx) => tx`
        update public.crm_quotations
           set status = 'approved', approved_discount = 150000, net_amount = 4550000,
               approved_by_id = ${mgr.id}::uuid, approved_at = now(),
               approval_note = 'Half of what was asked.'
         where id = ${qid} returning id, net_amount`);
      say(ok.length === 1, `${mgr.full_name} approved a SMALLER discount than was asked for`);
      say(
        Number(ok[0]?.net_amount) === 4_550_000,
        `and the net is what was authorised, not what was requested (${Number(ok[0]?.net_amount).toLocaleString('en-PK')})`,
      );
    }

    // 5 · ⚠️ A DISCOUNT LARGER THAN THE PRICE IS IMPOSSIBLE.
    let sane = false;
    try {
      await as(mgr?.id ?? lead.owner_id, (tx) => tx`
        update public.crm_quotations
           set approved_discount = 99000000 where id = ${qid}`);
    } catch (e) {
      sane = e.code === '23514';
    }
    say(sane, 'a discount larger than the price is refused — no client is ever quoted a negative');
  }

  // 6 · A colleague on another lead cannot see it.
  const [other] = await sql`
    select id, full_name from public.users
     where id <> ${lead.owner_id} and department_role = 'member' and is_active limit 1`;
  if (other) {
    const seen = await as(other.id, (tx) => tx`
      select count(*)::int n from public.crm_quotations where number like ${MARK + '%'}`);
    say(seen[0].n === 0, `${other.full_name} cannot see a quotation on somebody else's lead`);
  }
} finally {
  await clean();
  await sql.end({ timeout: 5 });
}

console.log(fail === 0
  ? '\n\x1b[32mAll checks passed.\x1b[0m\n'
  : `\n\x1b[31m${fail} check(s) failed.\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
