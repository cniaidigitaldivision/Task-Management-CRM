import { withUser } from '@/lib/db/client';

/* ============================================================================
 * PAY
 * ----------------------------------------------------------------------------
 * Reads and writes for `public.employee_compensation`.
 *
 * ── ⚠️ THERE IS NO ROLE CHECK IN THIS FILE, AND THAT IS CORRECT ────────────
 * Every function goes through `withUser`, and the table's own policy is
 * `app.acting_at_least('admin')` for both read and write. So a Coordinator
 * calling `listCompensation` gets an empty array and a Coordinator calling
 * `setSalary` gets a refusal from Postgres — without a single `if` here.
 *
 * That is ADR-003's rule: the database decides who sees what, so a component
 * cannot forget to ask. Adding a redundant check here would be harmless today
 * and dangerous later, because it would look like the boundary and drift.
 * ========================================================================= */

export type EmploymentType = 'full_time' | 'probation' | 'intern' | 'contract' | 'owner';

export const EMPLOYMENT_META: Readonly<
  Record<EmploymentType, { label: string; token: string; onPayroll: boolean }>
> = {
  full_time: { label: 'Full time', token: 'status-done', onPayroll: true },
  probation: { label: 'Probation', token: 'load-warning', onPayroll: true },
  intern: { label: 'Intern', token: 'status-todo', onPayroll: true },
  contract: { label: 'Contract', token: 'status-review', onPayroll: true },
  /* ⚠️ Profit share, not a salary. Migration 067 — excluded from every payroll
     figure, and from the monthly run. */
  owner: { label: 'Owner', token: 'accent-gold', onPayroll: false },
};

export interface CompensationRow {
  readonly userId: string;
  readonly monthlySalary: number;
  readonly currency: string;
  readonly note: string | null;
  readonly updatedAt: string;
  readonly employmentType: EmploymentType;
  /** When their pay is next due to be revisited, or null. */
  readonly reviewDueOn: string | null;
}

/** Everyone with a salary on file, joined to who they are. */
export interface PaidPerson extends CompensationRow {
  readonly fullName: string;
  readonly roleTitle: string | null;
  readonly role: string;
  readonly officeTeam: string;
  readonly isActive: boolean;
  readonly avatarUrl: string | null;
}

/**
 * The whole payroll, for the finance page.
 *
 * ⚠️ `monthly_salary` arrives from `pg` as a STRING, because a `numeric` cannot
 * be represented exactly as a JavaScript number and the driver refuses to lose
 * precision silently. `Number()` here is deliberate and safe — a monthly salary
 * is nowhere near 2^53 — but the conversion has to be explicit, or arithmetic
 * downstream would concatenate strings instead of adding them.
 */
export async function listPayroll(actorId: string): Promise<PaidPerson[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select c.user_id, c.monthly_salary, c.currency, c.note, c.updated_at,
           c.employment_type, c.review_due_on,
           u.full_name, u.role, u.role_title, u.office_team, u.is_active, u.avatar_url
      from public.employee_compensation c
      join public.users u on u.id = c.user_id
     order by u.is_active desc, c.monthly_salary desc
  `);

  return (rows as Array<Record<string, unknown>>).map(toPaidPerson);
}

/**
 * The people the monthly run will actually pay.
 *
 * ⚠️ Owners are excluded — migration 067. Every payroll TOTAL on the finance
 * screen comes through here rather than through `listPayroll`, so that the
 * owner's profit share can never be added into a salary bill by a caller that
 * forgot to filter.
 */
export async function listSalaried(actorId: string): Promise<PaidPerson[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select c.user_id, c.monthly_salary, c.currency, c.note, c.updated_at,
           c.employment_type, c.review_due_on,
           u.full_name, u.role, u.role_title, u.office_team, u.is_active, u.avatar_url
      from public.employee_compensation c
      join public.users u on u.id = c.user_id
     where c.employment_type <> 'owner' and u.is_active
     order by c.monthly_salary desc
  `);

  return (rows as Array<Record<string, unknown>>).map(toPaidPerson);
}

function toPaidPerson(row: Record<string, unknown>): PaidPerson {
  return {
    userId: row.user_id as string,
    monthlySalary: Number(row.monthly_salary ?? 0),
    currency: (row.currency as string) ?? 'PKR',
    note: (row.note as string | null) ?? null,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    employmentType: (row.employment_type as EmploymentType) ?? 'full_time',
    reviewDueOn: row.review_due_on ? isoDate(row.review_due_on) : null,
    fullName: row.full_name as string,
    role: row.role as string,
    roleTitle: (row.role_title as string | null) ?? null,
    officeTeam: (row.office_team as string) ?? 'blue_area',
    isActive: row.is_active as boolean,
    avatarUrl: (row.avatar_url as string | null) ?? null,
  };
}

/**
 * A `date` column to `yyyy-mm-dd`.
 *
 * ⚠️ Not `.toISOString()` — a `date` arrives as a Date at LOCAL midnight, and
 * converting that to UTC in Karachi (+05:00) yields the previous day at 19:00,
 * so a slice would return yesterday.
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

/**
 * Set (or change) what somebody is paid.
 *
 * ⚠️ An upsert, not an insert. Pay is set at invite time and changed later, and
 * those are the same intent — a separate "update" path would mean two call
 * sites that can disagree about validation.
 */
export async function setSalary(
  actorId: string,
  input: {
    userId: string;
    monthlySalary: number;
    currency?: string;
    note?: string | null;
    employmentType?: EmploymentType;
    reviewDueOn?: string | null;
    /** Why it changed. Kept on the history row, not on the current figure. */
    reason?: string | null;
    /** The month the new figure applies from. Defaults to this month. */
    effectiveFrom?: string;
  },
): Promise<void> {
  await withUser(actorId, async (tx) => {
    /* ── ⚠️ THE OLD FIGURE IS READ BEFORE IT IS OVERWRITTEN ────────────────
       `employee_compensation` holds one number per person, so the upsert below
       destroys the previous one. Reading it first is the only chance to record
       what it was — and "what was she on before April, and who changed it?" is
       a question somebody will ask during a disagreement about pay. */
    const before = await tx`
      select monthly_salary, employment_type
        from public.employee_compensation where user_id = ${input.userId}
    `;
    const prior = (before as Array<Record<string, unknown>>)[0];

    const type = input.employmentType ?? (prior?.employment_type as EmploymentType) ?? 'full_time';

    await tx`
      insert into public.employee_compensation
        (user_id, monthly_salary, currency, note, employment_type, review_due_on, updated_by_id)
      values (
        ${input.userId},
        ${input.monthlySalary},
        ${input.currency ?? 'PKR'},
        ${input.note ?? null},
        ${type},
        ${input.reviewDueOn ?? null},
        ${actorId}
      )
      on conflict (user_id) do update
         set monthly_salary  = excluded.monthly_salary,
             currency        = excluded.currency,
             note            = excluded.note,
             employment_type = excluded.employment_type,
             review_due_on   = excluded.review_due_on,
             updated_by_id   = excluded.updated_by_id
    `;

    /* ⚠️ Only when something actually MOVED. Re-saving the same figure with a
       different note is not a pay change, and a history full of no-op rows is
       a history nobody reads. */
    const previousSalary = prior ? Number(prior.monthly_salary) : null;
    const previousType = (prior?.employment_type as EmploymentType | undefined) ?? null;

    if (previousSalary !== input.monthlySalary || previousType !== type) {
      await tx`
        insert into public.salary_history
          (user_id, previous_salary, new_salary, currency,
           previous_type, new_type, effective_from, reason, changed_by_id)
        values (
          ${input.userId},
          ${previousSalary},
          ${input.monthlySalary},
          ${input.currency ?? 'PKR'},
          ${previousType},
          ${type},
          ${input.effectiveFrom ?? null}::date,
          ${input.reason ?? null},
          ${actorId}
        )
      `;
    }
  });
}

export interface SalaryChange {
  readonly id: string;
  readonly previousSalary: number | null;
  readonly newSalary: number;
  readonly currency: string;
  readonly previousType: EmploymentType | null;
  readonly newType: EmploymentType;
  readonly effectiveFrom: string;
  readonly reason: string | null;
  readonly changedBy: string | null;
}

/** Every change to one person's pay, newest first. */
export async function salaryHistory(actorId: string, userId: string): Promise<SalaryChange[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select h.id, h.previous_salary, h.new_salary, h.currency,
           h.previous_type, h.new_type, h.effective_from, h.reason,
           u.full_name as changed_by
      from public.salary_history h
      left join public.users u on u.id = h.changed_by_id
     where h.user_id = ${userId}
     order by h.effective_from desc, h.created_at desc
  `);

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    previousSalary:
      row.previous_salary === null || row.previous_salary === undefined
        ? null
        : Number(row.previous_salary),
    newSalary: Number(row.new_salary ?? 0),
    currency: (row.currency as string) ?? 'PKR',
    previousType: (row.previous_type as EmploymentType | null) ?? null,
    newType: row.new_type as EmploymentType,
    effectiveFrom: isoDate(row.effective_from),
    reason: (row.reason as string | null) ?? null,
    changedBy: (row.changed_by as string | null) ?? null,
  }));
}

export interface ReviewDue {
  readonly userId: string;
  readonly fullName: string;
  readonly employmentType: EmploymentType;
  readonly reviewDueOn: string;
  readonly monthlySalary: number;
  /** Negative when it is already past. */
  readonly daysAway: number;
}

/**
 * Whose pay is due to be revisited.
 *
 * Owner, 2026-08-26: *"give me a notification: when a new employee is added or
 * 3 months are completed, you have to enter a new salary for this employee. His
 * internship is completed."*
 *
 * ⚠️ Includes reviews already OVERDUE, and does not quietly drop them after a
 * grace period. A probation that ended two months ago and was never actioned is
 * the case this exists to surface — expiring the reminder would hide exactly the
 * one that matters most.
 */
export async function reviewsDue(actorId: string, withinDays = 30): Promise<ReviewDue[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select c.user_id, c.employment_type, c.review_due_on, c.monthly_salary,
           u.full_name,
           (c.review_due_on - current_date)::int as days_away
      from public.employee_compensation c
      join public.users u on u.id = c.user_id
     where c.review_due_on is not null
       and c.employment_type <> 'owner'
       and u.is_active
       /* ⚠️ The ::int cast is load-bearing. A bound parameter arrives untyped,
          so current_date + $1 matches both date+integer and date+interval, and
          Postgres refuses with "operator is not unique: date + unknown" rather
          than guessing. Cost a 500 on the finance page. */
       and c.review_due_on <= current_date + ${withinDays}::int
     order by c.review_due_on
  `);

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    userId: row.user_id as string,
    fullName: row.full_name as string,
    employmentType: row.employment_type as EmploymentType,
    reviewDueOn: isoDate(row.review_due_on),
    monthlySalary: Number(row.monthly_salary ?? 0),
    daysAway: Number(row.days_away ?? 0),
  }));
}

/** One person's pay, or null when none is on file (or the reader may not see it). */
export async function getSalary(
  actorId: string,
  userId: string,
): Promise<CompensationRow | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select user_id, monthly_salary, currency, note, updated_at,
           employment_type, review_due_on
      from public.employee_compensation
     where user_id = ${userId}
     limit 1
  `);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    userId: row.user_id as string,
    monthlySalary: Number(row.monthly_salary ?? 0),
    currency: (row.currency as string) ?? 'PKR',
    note: (row.note as string | null) ?? null,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    employmentType: (row.employment_type as EmploymentType) ?? 'full_time',
    reviewDueOn: row.review_due_on ? isoDate(row.review_due_on) : null,
  };
}
