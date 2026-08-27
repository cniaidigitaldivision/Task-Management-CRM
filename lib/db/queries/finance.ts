import { withUser } from '@/lib/db/client';
import type {
  LedgerExpense,
  LedgerRevenue,
  MonthKey,
  PaymentMethod,
  RevenuePayment,
} from '@/lib/domain/finance';
import { monthStart } from '@/lib/domain/finance';

/* ============================================================================
 * THE LEDGER'S READS AND WRITES
 * ----------------------------------------------------------------------------
 * ── ⚠️ NO ROLE CHECK LIVES IN THIS FILE, AND THAT IS CORRECT ───────────────
 * Every function goes through `withUser`, and migration 064 gives `expenses`
 * four policies: Coordinator-and-above may INSERT, Admin-and-above may SELECT,
 * UPDATE and DELETE. So `listExpenses` called by a Coordinator returns an empty
 * array and `deleteExpense` called by one is refused by Postgres, without a
 * single `if` here.
 *
 * That is ADR-003: the database decides who sees what, so a component cannot
 * forget to ask. A redundant check here would be harmless today and dangerous
 * later, because it would LOOK like the boundary and then drift from it.
 *
 * ── ⚠️ EVERY `numeric` ARRIVES AS A STRING ─────────────────────────────────
 * `pg` will not silently narrow a numeric to a float, so `amount_pkr` comes
 * back as `'18400.00'`. Without an explicit `Number()` every total downstream
 * CONCATENATES instead of adding — and produces no error at all, just a
 * spectacularly wrong figure. Migration 062 hit this first; the rule is the
 * same everywhere money is read.
 * ========================================================================= */

export interface ExpenseCategory {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly kind: 'recurring' | 'one_off';
  readonly token: string;
  readonly icon: string;
  readonly isSystem: boolean;
  /**
   * True where rows may ONLY be written by the monthly run.
   *
   * ⚠️ Salaries. The owner's rule: a salary belongs to a person's pay record,
   * never to a free-text form. Forms filter on this rather than on the slug, so
   * marking another category the same way needs no code change.
   */
  readonly postedOnly: boolean;
}

/**
 * The categories, for the filing form's dropdown.
 *
 * ⚠️ Readable by ANYBODY signed in — migration 064 gives this table its own
 * open select policy. That is deliberate and load-bearing: a Coordinator who
 * cannot read `expenses` still has to choose a category when filing one.
 */
export async function listExpenseCategories(actorId: string): Promise<ExpenseCategory[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, name, slug, kind, token, icon, is_system, posted_only
      from public.expense_categories
     where is_active
     order by sort_order, name
  `);

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    kind: row.kind as 'recurring' | 'one_off',
    token: row.token as string,
    icon: row.icon as string,
    isSystem: row.is_system as boolean,
    postedOnly: Boolean(row.posted_only),
  }));
}

/** Everything spent between two dates, inclusive. Admin+ by policy. */
export async function listExpenses(
  actorId: string,
  from: string,
  to: string,
): Promise<LedgerExpense[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select e.id, e.title, e.amount_pkr, e.incurred_on, e.paid_on,
           e.office_team, e.vendor, e.source, e.subtype, e.subtype_other,
           /* ⚠️ A boolean, never the path — see LedgerExpense.hasReceipt. */
           (e.receipt_path is not null) as has_receipt,
           e.receipt_name,
           c.slug as category_slug, c.name as category_name, c.token as category_token,
           u.full_name as person_name,
           s.full_name as seat_holder_name
      from public.expenses e
      join public.expense_categories c on c.id = e.category_id
      left join public.users u on u.id = e.user_id
      left join public.users s on s.id = e.subscription_user_id
     where e.incurred_on >= ${from} and e.incurred_on <= ${to}
     order by e.incurred_on desc, e.amount_pkr desc
  `);

  return (rows as Array<Record<string, unknown>>).map(toExpense);
}

/** One expense, for the detail panel. Null when the reader may not see it. */
export async function getExpense(
  actorId: string,
  id: string,
): Promise<(LedgerExpense & { note: string | null; filedBy: string | null }) | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select e.id, e.title, e.amount_pkr, e.incurred_on, e.paid_on,
           e.office_team, e.vendor, e.source, e.subtype, e.subtype_other, e.note,
           (e.receipt_path is not null) as has_receipt, e.receipt_name,
           c.slug as category_slug, c.name as category_name, c.token as category_token,
           u.full_name as person_name,
           s.full_name as seat_holder_name,
           f.full_name as filed_by
      from public.expenses e
      join public.expense_categories c on c.id = e.category_id
      left join public.users u on u.id = e.user_id
      left join public.users s on s.id = e.subscription_user_id
      left join public.users f on f.id = e.created_by_id
     where e.id = ${id}
     limit 1
  `);

  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) return null;
  return {
    ...toExpense(row),
    note: (row.note as string | null) ?? null,
    filedBy: (row.filed_by as string | null) ?? null,
  };
}

/**
 * The storage key for a row's receipt.
 *
 * ⚠️ SEPARATE from `getExpense`, and it returns only the path. The path never
 * travels to a browser — this exists so the action can sign a link, and keeping
 * it out of the row shape means no component can accidentally serialise it.
 * Returns null when the reader may not see the row, because RLS matches nothing.
 */
export async function receiptPathFor(
  actorId: string,
  id: string,
): Promise<{ path: string; name: string | null } | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select receipt_path, receipt_name from public.expenses
     where id = ${id} and receipt_path is not null limit 1
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) return null;
  return { path: row.receipt_path as string, name: (row.receipt_name as string | null) ?? null };
}

/** Everything earned between two dates, inclusive. Admin+ by policy. */
export async function listRevenue(
  actorId: string,
  from: string,
  to: string,
): Promise<LedgerRevenue[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select r.id, r.kind, r.project_id, r.amount_pkr, r.amount_paid_pkr,
           r.earned_on, r.received_on, r.invoice_ref, r.status, r.status_note,
           coalesce(p.name, r.client_name) as source_name,
           /* ⚠️ Counted here rather than derived from a second query per row.
              The ledger shows 25 invoices at a time; a follow-up query each is
              25 round trips to render one table. */
           (select count(*) from public.revenue_payments rp where rp.revenue_id = r.id)::int
             as payment_count,
           (select max(rp.received_on) from public.revenue_payments rp where rp.revenue_id = r.id)
             as last_payment_on
      from public.revenue_entries r
      left join public.projects p on p.id = r.project_id
     where r.earned_on >= ${from} and r.earned_on <= ${to}
     order by r.earned_on desc, r.amount_pkr desc
  `);

  return (rows as Array<Record<string, unknown>>).map(toRevenue);
}

/* ---------------------------------------------------------------------------
 * Receipts against an invoice
 * ------------------------------------------------------------------------- */

/** Every instalment recorded against one invoice, oldest first. */
export async function listPayments(
  actorId: string,
  revenueId: string,
): Promise<RevenuePayment[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select p.id, p.revenue_id, p.amount_pkr, p.received_on, p.method, p.reference,
           p.note, p.proof_name, p.proof_mime, p.created_at,
           (p.proof_path is not null) as has_proof,
           u.full_name as recorded_by
      from public.revenue_payments p
      left join public.users u on u.id = p.created_by_id
     where p.revenue_id = ${revenueId}
     order by p.received_on, p.created_at
  `);
  return (rows as Array<Record<string, unknown>>).map(toPayment);
}

export interface NewPayment {
  readonly revenueId: string;
  readonly amountPkr: number;
  readonly receivedOn: string;
  readonly method: PaymentMethod;
  readonly reference?: string | null;
  readonly note?: string | null;
  readonly proofPath: string;
  readonly proofName: string;
  readonly proofMime: string;
  readonly proofSizeBytes: number;
}

/**
 * Record money arriving.
 *
 * ⚠️ NOTHING here touches the invoice. `amount_paid_pkr`, `status` and
 * `received_on` on the parent are maintained by `sync_revenue_settlement`
 * (migration 074) — the trigger is the only writer, so an insert that bypassed
 * it, or an application that "helpfully" also updated the parent, would be the
 * one thing able to put the two out of step.
 *
 * ⚠️ No `returning`. Migration 073's policy covers select as well as insert so
 * it would work — but `credentials.ts` records the trap it courts: under a
 * SPLIT policy a `returning` clause needs SELECT rights the writer may not
 * have, and the failure arrives as a misleading "violates row-level security".
 * Nothing here needs the row back.
 */
export async function recordPayment(actorId: string, input: NewPayment): Promise<void> {
  await withUser(actorId, (tx) => tx`
    insert into public.revenue_payments
      (revenue_id, amount_pkr, received_on, method, reference, note,
       proof_path, proof_name, proof_mime, proof_size_bytes, created_by_id)
    values (
      ${input.revenueId}, ${input.amountPkr}, ${input.receivedOn}, ${input.method},
      ${input.reference ?? null}, ${input.note ?? null},
      ${input.proofPath}, ${input.proofName}, ${input.proofMime}, ${input.proofSizeBytes},
      ${actorId}
    )
  `);
}

/**
 * Remove a receipt.
 *
 * ⚠️ Returns the storage key so the caller can delete the file too. A row
 * deleted without its object leaves an orphan in the bucket that nothing points
 * at and nobody can find — `documents.ts` records the same requirement.
 */
export async function deletePayment(
  actorId: string,
  id: string,
): Promise<{ proofPath: string | null } | null> {
  const rows = await withUser(actorId, (tx) => tx`
    delete from public.revenue_payments where id = ${id}
    returning proof_path
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) return null;
  return { proofPath: (row.proof_path as string | null) ?? null };
}

/** The storage key for one receipt's proof. Same reasoning as expense receipts. */
export async function paymentProofPathFor(
  actorId: string,
  id: string,
): Promise<{ path: string; name: string | null; mime: string | null } | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select proof_path, proof_name, proof_mime from public.revenue_payments
     where id = ${id} and proof_path is not null limit 1
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) return null;
  return {
    path: row.proof_path as string,
    name: (row.proof_name as string | null) ?? null,
    mime: (row.proof_mime as string | null) ?? null,
  };
}

/**
 * The storage key for an invoice's own proof.
 *
 * ⚠️ KEPT FOR HISTORY ONLY. Migration 073 moved evidence onto the payments,
 * because one column could not hold three instalments' worth. Rows written
 * before that still carry a `proof_path`, and this is what still opens them.
 * New evidence goes on the payment; do not write here.
 */
export async function proofPathFor(
  actorId: string,
  id: string,
): Promise<{ path: string; name: string | null } | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select proof_path, proof_name from public.revenue_entries
     where id = ${id} and proof_path is not null limit 1
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) return null;
  return { path: row.proof_path as string, name: (row.proof_name as string | null) ?? null };
}

export interface NewExpense {
  readonly categoryId: string;
  readonly title: string;
  readonly amountPkr: number;
  readonly incurredOn: string;
  readonly paidOn?: string | null;
  readonly vendor?: string | null;
  readonly officeTeam?: string | null;
  readonly projectId?: string | null;
  readonly note?: string | null;
  readonly subtype?: string | null;
  readonly subtypeOther?: string | null;
  /** For a tool expense: whose seat. */
  readonly subscriptionUserId?: string | null;
  readonly subscriptionId?: string | null;
  /** The receipt, already in the bucket. Required by the table for manual rows. */
  readonly receiptPath: string;
  readonly receiptName: string;
  readonly receiptMime: string;
  readonly receiptSizeBytes: number;
}

/**
 * File one expense.
 *
 * ── ⚠️⚠️ THERE IS NO `returning` CLAUSE, AND THERE MUST NEVER BE ONE ────────
 * Postgres requires SELECT rights on every column an `insert ... returning`
 * hands back. A Team Coordinator has INSERT on this table and no SELECT at all
 * — that asymmetry is the owner's instruction, expressed in migration 064. So
 * the moment this ends with `returning id`, a Coordinator's filing fails.
 *
 * It fails in the most misleading way available: the error reads
 *
 *     new row violates row-level security policy for table "expenses"
 *
 * which sends whoever debugs it straight to the `with check` predicate — and
 * that predicate is fine. The row was accepted. It is the READ BACK that was
 * refused. Verified against this database on 2026-08-26.
 *
 * Worse, every test run as an Admin passes, because an Admin has both rights.
 * This returns void, and `recordExpenseAction` reports "Recorded." rather than
 * echoing the row, so the write-only boundary is honoured end to end.
 */
export async function recordExpense(actorId: string, input: NewExpense): Promise<void> {
  await withUser(actorId, (tx) => tx`
    insert into public.expenses
      (category_id, title, amount_pkr, incurred_on, paid_on, vendor,
       office_team, project_id, note, subtype, subtype_other,
       subscription_user_id, subscription_id,
       receipt_path, receipt_name, receipt_mime, receipt_size_bytes,
       source, created_by_id)
    values (
      ${input.categoryId},
      ${input.title},
      ${input.amountPkr},
      ${input.incurredOn},
      ${input.paidOn ?? null},
      ${input.vendor ?? null},
      ${input.officeTeam ?? null},
      ${input.projectId ?? null},
      ${input.note ?? null},
      ${input.subtype ?? null},
      ${input.subtypeOther ?? null},
      ${input.subscriptionUserId ?? null},
      ${input.subscriptionId ?? null},
      ${input.receiptPath},
      ${input.receiptName},
      ${input.receiptMime},
      ${input.receiptSizeBytes},
      'manual',
      ${actorId}
    )
  `);
}

/* ── ⚠️ THERE IS NO `updateExpense`, AND THAT IS THE OWNER'S RULE ───────────
   Owner, 2026-08-26: *"If he accidentally enters a wrong record for that
   expense, the whole expense can be deleted but it cannot be updated [...] Then
   I have to add a new record for that expense. I will not change that record."*

   A filed expense is a claim backed by a receipt. Editing the amount while the
   receipt stays put would break the one thing that makes the row trustworthy,
   and would do it silently. Removing it and filing again leaves both the
   deletion and the new row in the audit log.

   `setExpensePaid` below is the single exception, and it is not an amendment:
   it records that the same claim has now been settled. */

/**
 * Remove one.
 *
 * ⚠️ Returns the storage key so the caller can delete the object too. A row
 * removed without its receipt leaves a file in the bucket nothing points at —
 * invisible, permanent, and still readable by anybody who can sign a link.
 */
export async function deleteExpense(
  actorId: string,
  id: string,
): Promise<{ receiptPath: string | null }> {
  /* ⚠️ `returning` IS safe here, unlike on the insert. It needs SELECT on the
     returned column, and DELETE is Admin-only — an Admin has both. The insert
     is the dangerous one because a Coordinator has INSERT and no SELECT; see
     the long note on `recordExpense`. */
  const rows = await withUser(actorId, (tx) => tx`
    delete from public.expenses where id = ${id}
    returning receipt_path
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  return { receiptPath: (row?.receipt_path as string | null) ?? null };
}

/** Mark one as settled, or un-settle it when `on` is null. */
export async function setExpensePaid(
  actorId: string,
  id: string,
  on: string | null,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.expenses set paid_on = ${on} where id = ${id}
  `);
}

export interface NewRevenue {
  readonly kind: 'retainer' | 'one_off' | 'add_on';
  readonly projectId?: string | null;
  readonly clientName?: string | null;
  readonly serviceId?: string | null;
  readonly amountPkr: number;
  readonly earnedOn: string;
  readonly receivedOn?: string | null;
  readonly invoiceRef?: string | null;
  readonly note?: string | null;
  /**
   * Where it starts.
   *
   * ⚠️ Only `pending` or `invoiced`. `received` requires proof on the same row
   * and the table refuses it — money arriving is a later, separate act.
   */
  readonly status?: 'pending' | 'invoiced';
}

export async function recordRevenue(actorId: string, input: NewRevenue): Promise<void> {
  await withUser(actorId, (tx) => tx`
    insert into public.revenue_entries
      (kind, project_id, client_name, service_id, amount_pkr,
       earned_on, received_on, invoice_ref, note, status, created_by_id)
    values (
      ${input.kind},
      ${input.projectId ?? null},
      ${input.clientName ?? null},
      ${input.serviceId ?? null},
      ${input.amountPkr},
      ${input.earnedOn},
      /* ⚠️ Always null at creation. The revenue_received_has_a_date constraint
         requires the date and the status to agree, and a new entry is never
         received. */
      null,
      ${input.invoiceRef ?? null},
      ${input.note ?? null},
      ${input.status ?? 'pending'},
      ${actorId}
    )
  `);
}

export async function updateRevenue(
  actorId: string,
  id: string,
  input: NewRevenue,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.revenue_entries
       set kind        = ${input.kind},
           project_id  = ${input.projectId ?? null},
           client_name = ${input.clientName ?? null},
           service_id  = ${input.serviceId ?? null},
           amount_pkr  = ${input.amountPkr},
           earned_on   = ${input.earnedOn},
           received_on = ${input.receivedOn ?? null},
           invoice_ref = ${input.invoiceRef ?? null},
           note        = ${input.note ?? null}
     where id = ${id}
  `);
}

export async function deleteRevenue(actorId: string, id: string): Promise<void> {
  await withUser(actorId, (tx) => tx`
    delete from public.revenue_entries where id = ${id}
  `);
}

/**
 * Move a piece of income to a new status.
 *
 * ── ⚠️ `received` DEMANDS PROOF, AND THE TABLE ENFORCES IT ─────────────────
 * Owner, 2026-08-26: *"when I say that its status changes to received, then I
 * have to give some check, some screenshot, or a receiving message."* Passing
 * `received` with no proof on file is refused by
 * `revenue_received_needs_proof`, not by an `if` here.
 *
 * ⚠️ `received_on` is kept in step with the status in the same statement,
 * because `revenue_received_has_a_date` requires the two to agree. Setting one
 * without the other is refused — which is the point: a received payment with no
 * date, or a date with a returned status, is a row nobody can reconcile.
 */
export async function setRevenueStatus(
  actorId: string,
  id: string,
  status: LedgerRevenue['status'],
  input: {
    on?: string | null;
    note?: string | null;
    proof?: {
      path: string;
      name: string;
      mime: string;
      sizeBytes: number;
    } | null;
  } = {},
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.revenue_entries
       set status      = ${status},
           received_on = ${status === 'received' ? (input.on ?? null) : null},
           status_note = ${input.note ?? null},
           proof_path       = coalesce(${input.proof?.path ?? null}, proof_path),
           proof_name       = coalesce(${input.proof?.name ?? null}, proof_name),
           proof_mime       = coalesce(${input.proof?.mime ?? null}, proof_mime),
           proof_size_bytes = coalesce(${input.proof?.sizeBytes ?? null}, proof_size_bytes)
     where id = ${id}
  `);
}

/* ── Posting a month ────────────────────────────────────────────────────────
   The two costs that are KNOWN rather than discovered. Rent, bills, equipment
   and everything unforeseeable stay manual — that is what the filing form is
   for, and guessing them would put invented figures in a ledger. */

export interface RunResult {
  readonly salariesPosted: number;
  readonly subscriptionsPosted: number;
}

/**
 * Post one month's payroll and tool costs.
 *
 * ── ⚠️ SAFE TO PRESS TWICE ─────────────────────────────────────────────────
 * `on conflict do nothing` against the partial unique index
 * `expenses_run_once`. Running August twice posts nothing the second time.
 *
 * ⚠️ The rate is read from `employee_compensation` AT THE MOMENT OF POSTING and
 * written into the row. That is the point of a ledger: a raise in October does
 * not reach back and make August more expensive. See migration 064's header.
 *
 * ⚠️ A yearly subscription is DIVIDED by twelve, never multiplied. Getting that
 * backwards overstates a month's tool spend by a factor of 144.
 */
export async function runMonth(actorId: string, month: MonthKey): Promise<RunResult> {
  const period = monthStart(month);

  return withUser(actorId, async (tx) => {
    /* ⚠️ Tagged templates throughout, never `tx.unsafe`. Every value below is
       a bound parameter — the month comes from a form and interpolating it into
       SQL text would be an injection hole in the one file that writes money. */
    const salaries = await tx`
      insert into public.expenses
        (category_id, title, amount_pkr, currency, incurred_on, user_id,
         office_team, source, period_month, created_by_id)
      select
        (select id from public.expense_categories where slug = 'salaries'),
        u.full_name || ' — salary',
        c.monthly_salary,
        c.currency,
        /* The last day of the month it covers, so a month's spend never lands
           in the next month's bucket. Adding a month and subtracting a day
           handles February and leap years without a table of month lengths. */
        (${period}::date + interval '1 month' - interval '1 day')::date,
        u.id,
        u.office_team,
        'payroll_run',
        ${period}::date,
        ${actorId}::uuid
        from public.employee_compensation c
        join public.users u on u.id = c.user_id
        /* ⚠️ Owners are not payroll — migration 067. Without this the run would
           quietly re-create the very rows that migration removed, and the next
           month's total would be wrong again. */
       where u.is_active and c.employment_type <> 'owner'
      on conflict do nothing
    `;

    const subscriptions = await tx`
      insert into public.expenses
        (category_id, title, amount_pkr, currency, incurred_on, subscription_id,
         source, period_month, created_by_id)
      select
        (select id from public.expense_categories where slug = 'ai_subscriptions'),
        s.name || ' — ' || seats.n || ' seat' || case when seats.n = 1 then '' else 's' end,
        /* ⚠️ A yearly price is DIVIDED by twelve, never multiplied. Getting this
           backwards overstates a month's tool spend by a factor of 144.
           A null seats_included means per-seat pricing, so the cost scales with
           holders; a number means a flat price covering that many. */
        case
          when k.billing_cycle = 'yearly' then
            case when k.seats_included is null
                 then round(k.monthly_cost_pkr / 12, 2) * seats.n
                 else round(k.monthly_cost_pkr / 12, 2) end
          else
            case when k.seats_included is null
                 then k.monthly_cost_pkr * seats.n
                 else k.monthly_cost_pkr end
        end,
        k.currency,
        (${period}::date + interval '1 month' - interval '1 day')::date,
        s.id,
        'subscription_run',
        ${period}::date,
        ${actorId}::uuid
        from public.subscriptions s
        join public.subscription_costs k on k.subscription_id = s.id
        join lateral (
          /* Seats live during the month: started on or before its last day, and
             not ended before its first. A seat given mid-month still counts —
             the division paid for it. */
          select count(*)::int as n
            from public.subscription_seats st
           where st.subscription_id = s.id
             and st.started_on <= (${period}::date + interval '1 month' - interval '1 day')::date
             and (st.ended_on is null or st.ended_on >= ${period}::date)
        ) seats on true
       where s.is_active and seats.n > 0
      on conflict do nothing
    `;

    return {
      salariesPosted: salaries.count ?? 0,
      subscriptionsPosted: subscriptions.count ?? 0,
    };
  });
}

/* ── The payroll month ───────────────────────────────────────────────────── */

export interface PayrollLineRow {
  readonly userId: string;
  readonly fullName: string;
  readonly roleTitle: string | null;
  readonly avatarUrl: string | null;
  readonly officeTeam: string;
  readonly employmentType: string;
  readonly monthlySalary: number;
  readonly currency: string;
  /** The posted ledger row for this month, once the month has been generated. */
  readonly expenseId: string | null;
  /** What that row actually says — a raise after posting does not rewrite it. */
  readonly postedAmount: number | null;
  readonly paidOn: string | null;
}

/**
 * One month of payroll, person by person.
 *
 * ── ⚠️ "PAID" IS THE LEDGER ROW'S `paid_on`, NOT A SECOND TABLE ────────────
 * Owner, 2026-08-26: *"whether we have paid all of them, whether we have not
 * paid, or to whom we have paid."*
 *
 * The posted expense row already IS the obligation — it is the cost of paying
 * that person that month. Whether the money left is exactly what `paid_on`
 * means everywhere else in this ledger. A separate `payroll_payments` table
 * would be a second record of the same fact, and the two would disagree the
 * first time somebody settled a row from the expenses screen instead.
 *
 * ⚠️ A LEFT JOIN from people to rows, not the reverse. Somebody with a salary
 * and no posted row must still appear — as "not generated yet", which is a
 * different answer from "not paid" and the one that tells you to press the
 * button.
 *
 * ⚠️ Owners are excluded (migration 067).
 */
export async function payrollMonth(actorId: string, month: MonthKey): Promise<PayrollLineRow[]> {
  const period = monthStart(month);

  const rows = await withUser(actorId, (tx) => tx`
    select c.user_id, c.monthly_salary, c.currency, c.employment_type,
           u.full_name, u.role_title, u.avatar_url, u.office_team,
           e.id as expense_id, e.amount_pkr as posted_amount, e.paid_on
      from public.employee_compensation c
      join public.users u on u.id = c.user_id
      left join public.expenses e
        on e.user_id = c.user_id
       and e.source = 'payroll_run'
       and e.period_month = ${period}::date
     where c.employment_type <> 'owner'
       and u.is_active
     order by c.monthly_salary desc, u.full_name
  `);

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    userId: row.user_id as string,
    fullName: row.full_name as string,
    roleTitle: (row.role_title as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    officeTeam: (row.office_team as string) ?? 'blue_area',
    employmentType: (row.employment_type as string) ?? 'full_time',
    monthlySalary: Number(row.monthly_salary ?? 0),
    currency: (row.currency as string) ?? 'PKR',
    expenseId: (row.expense_id as string | null) ?? null,
    postedAmount:
      row.posted_amount === null || row.posted_amount === undefined
        ? null
        : Number(row.posted_amount),
    paidOn: row.paid_on ? isoDate(row.paid_on) : null,
  }));
}

/**
 * Settle every unpaid salary row for a month at once.
 *
 * Owner: *"One click to pay all or I can select anyone to make them unpaid."*
 *
 * ⚠️ Only rows that are NOT already settled, so pressing it twice does not
 * rewrite the date on something paid last week — which would quietly move when
 * the division's money actually went out.
 */
export async function payAllSalaries(
  actorId: string,
  month: MonthKey,
  on: string,
): Promise<number> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.expenses
       set paid_on = ${on}
     where source = 'payroll_run'
       and period_month = ${monthStart(month)}::date
       and paid_on is null
  `);
  return (rows as unknown as { count?: number }).count ?? 0;
}

/** Undo one posted run, leaving anything typed by a person untouched. */
export async function unpostMonth(actorId: string, month: MonthKey): Promise<number> {
  const rows = await withUser(actorId, (tx) => tx`
    delete from public.expenses
     where source <> 'manual' and period_month = ${monthStart(month)}
  `);
  return (rows as unknown as { count?: number }).count ?? 0;
}

/** Which months already have posted rows — so the button can say so. */
export async function postedMonths(actorId: string): Promise<MonthKey[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select distinct period_month
      from public.expenses
     where source <> 'manual' and period_month is not null
     order by period_month desc
  `);
  return (rows as Array<Record<string, unknown>>).map((row) =>
    isoDate(row.period_month).slice(0, 7),
  );
}

/* ── The income form's project picker ───────────────────────────────────── */

export interface ProjectOption {
  readonly id: string;
  readonly name: string;
  /** The agreed monthly fee, or null. Offered as a PREFILL, never posted. */
  readonly monthlyFeePkr: number | null;
}

/**
 * Projects that can be attributed income, with their agreed fee.
 *
 * ⚠️ The fee is a CONVENIENCE, not a posting. Owner, 2026-08-26: income is
 * entered by hand, every line. This spares somebody remembering that GC Royal
 * Emporium is 120,000; it does not decide that the month earned it. A project
 * whose client paid nothing this month simply has no income row, and the
 * difference between "billed" and "was going to be billed" stays visible.
 *
 * ⚠️ Reads `monthly_fee_pkr` directly and does NOT go through `redactFinance`.
 * Correct here and nowhere else: this query is only ever called on a page branch
 * that has already established `finance.view`, and that permission is a superset
 * of `project.view_finance`. Calling it from anywhere else needs the redaction.
 *
 * ── ⚠️ THERE IS NO `deleted_at` FILTER, AND THAT IS NOT AN OVERSIGHT ────────
 * `lib/db/migrations/053_projects_soft_delete.sql` adds `deleted_at` and
 * `deleted_by_id` — and it has NOT been applied to this database. Verified
 * 2026-08-26: `information_schema.columns` has neither, and no query in
 * `lib/db/queries/projects.ts` references them, so soft delete is not live.
 *
 * Filtering on the column cost a 500 on this page and an error that named the
 * column but not the reason. If 053 is ever applied, add `deleted_at is null`
 * here and to every other project read at the same time.
 */
export async function listProjectsForPicker(actorId: string): Promise<ProjectOption[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, name, monthly_fee_pkr
      from public.projects
     where is_draft = false
     order by name
  `);

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    monthlyFeePkr:
      row.monthly_fee_pkr === null || row.monthly_fee_pkr === undefined
        ? null
        : Number(row.monthly_fee_pkr),
  }));
}

/* ── Shared mapping ─────────────────────────────────────────────────────── */

function toExpense(row: Record<string, unknown>): LedgerExpense {
  return {
    id: row.id as string,
    categorySlug: row.category_slug as string,
    categoryName: row.category_name as string,
    categoryToken: row.category_token as string,
    title: row.title as string,
    amountPkr: Number(row.amount_pkr ?? 0),
    incurredOn: isoDate(row.incurred_on),
    paidOn: row.paid_on ? isoDate(row.paid_on) : null,
    officeTeam: (row.office_team as string | null) ?? null,
    vendor: (row.vendor as string | null) ?? null,
    personName: (row.person_name as string | null) ?? null,
    source: row.source as LedgerExpense['source'],
    subtype: (row.subtype as string | null) ?? null,
    subtypeOther: (row.subtype_other as string | null) ?? null,
    seatHolderName: (row.seat_holder_name as string | null) ?? null,
    hasReceipt: Boolean(row.has_receipt),
    receiptName: (row.receipt_name as string | null) ?? null,
  };
}

function toRevenue(row: Record<string, unknown>): LedgerRevenue {
  return {
    id: row.id as string,
    kind: row.kind as LedgerRevenue['kind'],
    sourceName: (row.source_name as string | null) ?? 'Unattributed',
    projectId: (row.project_id as string | null) ?? null,
    /* ⚠️ `numeric` arrives from pg as a STRING. Without the explicit Number()
       every total downstream concatenates instead of adding — and produces no
       error, just a spectacularly wrong figure. */
    amountPkr: Number(row.amount_pkr ?? 0),
    paidPkr: Number(row.amount_paid_pkr ?? 0),
    paymentCount: Number(row.payment_count ?? 0),
    earnedOn: isoDate(row.earned_on),
    receivedOn: row.received_on ? isoDate(row.received_on) : null,
    lastPaymentOn: row.last_payment_on ? isoDate(row.last_payment_on) : null,
    invoiceRef: (row.invoice_ref as string | null) ?? null,
    status: row.status as LedgerRevenue['status'],
    statusNote: (row.status_note as string | null) ?? null,
  };
}

function toPayment(row: Record<string, unknown>): RevenuePayment {
  return {
    id: row.id as string,
    revenueId: row.revenue_id as string,
    amountPkr: Number(row.amount_pkr ?? 0),
    receivedOn: isoDate(row.received_on),
    method: row.method as PaymentMethod,
    reference: (row.reference as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    hasProof: Boolean(row.has_proof),
    proofName: (row.proof_name as string | null) ?? null,
    proofMime: (row.proof_mime as string | null) ?? null,
    recordedBy: (row.recorded_by as string | null) ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/**
 * A `date` column to `yyyy-mm-dd`.
 *
 * ⚠️ `.toISOString()` is NOT used. A `date` comes back from `pg` as a Date at
 * local midnight; in Karachi (+05:00) `toISOString()` converts that to the
 * previous day at 19:00 and `.slice(0,10)` then yields YESTERDAY. Every row on
 * the first of a month would file under the month before. The parts are read in
 * local time instead, which is the timezone they were constructed in.
 */
function isoDate(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

/* ---------------------------------------------------------------------------
 * A client's account
 * ------------------------------------------------------------------------- */

export interface ClientAccountRow {
  readonly projectId: string | null;
  readonly clientName: string | null;
  readonly name: string;
  readonly code: string | null;
  readonly type: string | null;
  readonly monthlyFeePkr: number | null;
  readonly invoiceCount: number;
  readonly billedPkr: number;
  readonly collectedPkr: number;
  readonly firstEarnedOn: string | null;
  readonly lastEarnedOn: string | null;
  readonly lastPaymentOn: string | null;
}

/**
 * Every client the division has billed, with the state of their account.
 *
 * Owner, 2026-08-27: *"For project income I have seen that it's not being
 * managed properly. When I click on some project, all of that project's details
 * will also be opened on a separate page."* This is the list that page is
 * reached from — one row per CLIENT rather than one per invoice, which is how a
 * receivables ledger is actually read.
 *
 * ── ⚠️ NOT LIMITED TO A PERIOD, AND THAT IS DELIBERATE ─────────────────────
 * An account balance is cumulative. Filtering it to "this month" would show a
 * client who still owes 300,000 from June as owing nothing — precisely the
 * figure somebody chasing payment must not be shown. The month-by-month detail
 * lives on the statement page.
 *
 * ── ⚠️ GROUPED BY PROJECT, WITH A FALLBACK TO THE TYPED NAME ──────────────
 * 064 allows income against a bare `client_name` for work that predates the
 * project record. Those have no id to group by, so they group by name and carry
 * a null `projectId` — which is what tells the screen to address the statement
 * by name instead.
 */
export async function listClientAccounts(actorId: string): Promise<ClientAccountRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select r.project_id,
           r.client_name,
           coalesce(p.name, r.client_name)     as name,
           p.code,
           p.type::text                        as type,
           p.monthly_fee_pkr,
           count(*)::int                       as invoice_count,
           coalesce(sum(r.amount_pkr), 0)      as billed_pkr,
           /* ⚠️ The maintained column, not a fresh join to the payments.
              Migration 074's trigger is the only writer, so this is the same
              number the invoice row shows — totalling it two different ways is
              two figures that can disagree on one screen. */
           coalesce(sum(r.amount_paid_pkr), 0) as collected_pkr,
           min(r.earned_on)                    as first_earned_on,
           max(r.earned_on)                    as last_earned_on,
           max(pay.last_paid)                  as last_payment_on
      from public.revenue_entries r
      left join public.projects p on p.id = r.project_id
      left join lateral (
        select max(rp.received_on) as last_paid
          from public.revenue_payments rp
         where rp.revenue_id = r.id
      ) pay on true
     group by r.project_id, r.client_name, p.name, p.code, p.type, p.monthly_fee_pkr
     /* Whoever owes the most, first — the order somebody chasing money reads in. */
     order by (coalesce(sum(r.amount_pkr), 0) - coalesce(sum(r.amount_paid_pkr), 0)) desc,
              coalesce(sum(r.amount_pkr), 0) desc
  `);

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    projectId: (row.project_id as string | null) ?? null,
    clientName: (row.client_name as string | null) ?? null,
    name: (row.name as string | null) ?? 'Unattributed',
    code: (row.code as string | null) ?? null,
    type: (row.type as string | null) ?? null,
    monthlyFeePkr: row.monthly_fee_pkr === null ? null : Number(row.monthly_fee_pkr),
    invoiceCount: Number(row.invoice_count ?? 0),
    billedPkr: Number(row.billed_pkr ?? 0),
    collectedPkr: Number(row.collected_pkr ?? 0),
    firstEarnedOn: row.first_earned_on ? isoDate(row.first_earned_on) : null,
    lastEarnedOn: row.last_earned_on ? isoDate(row.last_earned_on) : null,
    lastPaymentOn: row.last_payment_on ? isoDate(row.last_payment_on) : null,
  }));
}

/** Which client a statement is for: a project, or a name from before there was one. */
export interface ClientKey {
  readonly projectId: string | null;
  readonly clientName: string | null;
}

/**
 * One client's invoices, every one of them, newest first.
 *
 * ⚠️ Takes a project id OR a bare client name, because 064 permits both and a
 * statement that could only be produced for one of them would be missing
 * exactly the older history somebody is most likely to be chasing.
 */
export async function clientInvoices(
  actorId: string,
  key: ClientKey,
): Promise<LedgerRevenue[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select r.id, r.kind, r.project_id, r.amount_pkr, r.amount_paid_pkr,
           r.earned_on, r.received_on, r.invoice_ref, r.status, r.status_note,
           coalesce(p.name, r.client_name) as source_name,
           (select count(*) from public.revenue_payments rp where rp.revenue_id = r.id)::int
             as payment_count,
           (select max(rp.received_on) from public.revenue_payments rp
             where rp.revenue_id = r.id) as last_payment_on
      from public.revenue_entries r
      left join public.projects p on p.id = r.project_id
     where ${
       key.projectId !== null
         ? tx`r.project_id = ${key.projectId}`
         : tx`r.project_id is null and r.client_name = ${key.clientName}`
     }
     order by r.earned_on desc, r.amount_pkr desc
  `);
  return (rows as Array<Record<string, unknown>>).map(toRevenue);
}

/**
 * Every receipt against one client's invoices, newest first.
 *
 * ⚠️ ONE QUERY, NOT ONE PER INVOICE. A statement with a year of history is a
 * dozen invoices; fetching each one's payments separately is a dozen round
 * trips to draw one page. The caller groups them by `revenueId` in memory.
 */
export async function clientPayments(
  actorId: string,
  key: ClientKey,
): Promise<RevenuePayment[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select pay.id, pay.revenue_id, pay.amount_pkr, pay.received_on, pay.method,
           pay.reference, pay.note, pay.proof_name, pay.proof_mime, pay.created_at,
           (pay.proof_path is not null) as has_proof,
           u.full_name as recorded_by
      from public.revenue_payments pay
      join public.revenue_entries r on r.id = pay.revenue_id
      left join public.users u on u.id = pay.created_by_id
     where ${
       key.projectId !== null
         ? tx`r.project_id = ${key.projectId}`
         : tx`r.project_id is null and r.client_name = ${key.clientName}`
     }
     order by pay.received_on desc, pay.created_at desc
  `);
  return (rows as Array<Record<string, unknown>>).map(toPayment);
}

/** The name and headline terms of one project, for a statement's header. */
export interface ProjectHeaderRow {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly type: string | null;
  readonly monthlyFeePkr: number | null;
}

export async function projectHeader(
  actorId: string,
  projectId: string,
): Promise<ProjectHeaderRow | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, name, code, type::text as type, monthly_fee_pkr
      from public.projects where id = ${projectId} limit 1
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    code: (row.code as string | null) ?? null,
    type: (row.type as string | null) ?? null,
    monthlyFeePkr: row.monthly_fee_pkr === null ? null : Number(row.monthly_fee_pkr),
  };
}
