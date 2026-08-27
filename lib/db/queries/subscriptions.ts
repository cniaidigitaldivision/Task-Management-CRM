import { withUser } from '@/lib/db/client';

/* ============================================================================
 * AI TOOLS — THE CATALOGUE, THE SEATS, AND (SEPARATELY) THE MONEY
 * ----------------------------------------------------------------------------
 * Migration 063 splits these across three tables so that a Member can read the
 * tool they hold without being able to read what it costs. This file keeps that
 * split visible: `mySubscriptions` does not join `subscription_costs` at all.
 *
 * ⚠️ That omission is not defence-in-depth, it is honesty. The policy already
 * makes the join return nothing for a Member — so writing the join would
 * produce a query whose result silently differs by who runs it, which is far
 * harder to reason about than one that never asks.
 *
 * No role checks here either. RLS is the boundary (ADR-003).
 * ========================================================================= */

export interface Tool {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly vendor: string | null;
  readonly token: string;
}

/** The catalogue. Readable by anybody signed in — it holds no money. */
export async function listTools(actorId: string): Promise<Tool[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, name, slug, vendor, token
      from public.subscriptions
     where is_active
     order by sort_order, name
  `);
  return (rows as Array<Record<string, unknown>>).map(toTool);
}

/* ── What a person holds ─────────────────────────────────────────────────── */

export interface MyTool {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly vendor: string | null;
  readonly token: string;
  /** `yyyy-mm-dd` — when they were given it. */
  readonly startedOn: string;
  readonly seatNote: string | null;
}

/**
 * The tools one person holds right now.
 *
 * Owner, 2026-08-26: *"each person can see which subscriptions they have, for
 * example Gemini, but the subscription cost is not compulsory to show them."*
 *
 * ⚠️ NO COST IS SELECTED. See the header — the policy would refuse it for a
 * Member anyway, and a query that returns different columns depending on who
 * asks is a query nobody can reason about.
 *
 * ⚠️ `userId` is a parameter rather than always the actor, because an Admin
 * looking at somebody's profile reads the same panel. The seat policy decides
 * whether that is allowed: a Member passing another id gets an empty array, not
 * an error, because there is no row they may select.
 */
export async function mySubscriptions(actorId: string, userId: string): Promise<MyTool[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select s.id, s.name, s.slug, s.vendor, s.token,
           st.started_on, st.seat_note
      from public.subscription_seats st
      join public.subscriptions s on s.id = st.subscription_id
     where st.user_id = ${userId}
       and st.ended_on is null
     order by st.started_on, s.name
  `);

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    vendor: (row.vendor as string | null) ?? null,
    token: row.token as string,
    startedOn: isoDate(row.started_on),
    seatNote: (row.seat_note as string | null) ?? null,
  }));
}

/* ── The Admin's board ───────────────────────────────────────────────────── */

export interface SeatHolder {
  readonly seatId: string;
  readonly userId: string;
  readonly fullName: string;
  readonly roleTitle: string | null;
  readonly avatarUrl: string | null;
  readonly startedOn: string;
}

export interface ToolBoardRow extends Tool {
  /** Null until somebody records what it costs. */
  readonly monthlyCostPkr: number | null;
  readonly currency: string;
  readonly billingCycle: 'monthly' | 'yearly';
  readonly seatsIncluded: number | null;
  readonly holders: readonly SeatHolder[];
  /** What this tool costs per month with the seats currently assigned. */
  readonly monthlySpend: number;
}

/**
 * Every tool, what it costs, and who holds it. Admin+ — a Coordinator gets the
 * catalogue with no costs and no holders, which is the correct answer for them.
 *
 * ⚠️ Two queries and a join in memory, rather than one query with an aggregate.
 * A `join` across seats would multiply the cost row by the number of holders,
 * and summing THAT is how a five-seat tool ends up costing five times its price
 * in a total. Keeping the shapes separate makes that mistake unavailable.
 */
export async function toolBoard(actorId: string): Promise<ToolBoardRow[]> {
  const [tools, costs, seats] = await Promise.all([
    listTools(actorId),
    withUser(actorId, (tx) => tx`
      select subscription_id, monthly_cost_pkr, currency, billing_cycle, seats_included
        from public.subscription_costs
    `),
    withUser(actorId, (tx) => tx`
      select st.id as seat_id, st.subscription_id, st.user_id, st.started_on,
             u.full_name, u.role_title, u.avatar_url
        from public.subscription_seats st
        join public.users u on u.id = st.user_id
       where st.ended_on is null
       order by u.full_name
    `),
  ]);

  const costBy = new Map<string, Record<string, unknown>>();
  for (const row of costs as Array<Record<string, unknown>>) {
    costBy.set(row.subscription_id as string, row);
  }

  const seatsBy = new Map<string, SeatHolder[]>();
  for (const row of seats as Array<Record<string, unknown>>) {
    const key = row.subscription_id as string;
    const list = seatsBy.get(key) ?? [];
    list.push({
      seatId: row.seat_id as string,
      userId: row.user_id as string,
      fullName: row.full_name as string,
      roleTitle: (row.role_title as string | null) ?? null,
      avatarUrl: (row.avatar_url as string | null) ?? null,
      startedOn: isoDate(row.started_on),
    });
    seatsBy.set(key, list);
  }

  return tools.map((tool) => {
    const cost = costBy.get(tool.id);
    const holders = seatsBy.get(tool.id) ?? [];

    /* ⚠️ `Number()` explicitly — `numeric` arrives as a string and a missing
       conversion makes every total concatenate instead of adding. */
    const monthlyCostPkr = cost ? Number(cost.monthly_cost_pkr ?? 0) : null;
    const billingCycle = (cost?.billing_cycle as 'monthly' | 'yearly') ?? 'monthly';
    const seatsIncluded =
      cost?.seats_included === null || cost?.seats_included === undefined
        ? null
        : Number(cost.seats_included);

    /* ⚠️ A yearly price is divided by twelve, never multiplied — the same rule
       `runMonth` applies, and the two must agree or the board and the ledger
       will show different figures for the same month. */
    const perMonth =
      monthlyCostPkr === null ? 0 : billingCycle === 'yearly' ? monthlyCostPkr / 12 : monthlyCostPkr;

    return {
      ...tool,
      monthlyCostPkr,
      currency: (cost?.currency as string) ?? 'PKR',
      billingCycle,
      seatsIncluded,
      holders,
      monthlySpend: seatsIncluded === null ? perMonth * holders.length : perMonth,
    };
  });
}

/* ── Writes — all Admin+ by policy ───────────────────────────────────────── */

export async function assignSeat(
  actorId: string,
  input: { subscriptionId: string; userId: string; startedOn?: string; seatNote?: string | null },
): Promise<void> {
  /* ⚠️ `on conflict do nothing` against the partial unique index
     `subscription_seats_one_active`. Assigning a tool somebody already holds is
     a no-op rather than an error — the intent ("they should have Claude") is
     already satisfied, and failing would make the button feel broken. */
  await withUser(actorId, (tx) => tx`
    insert into public.subscription_seats
      (subscription_id, user_id, started_on, seat_note, assigned_by_id)
    values (
      ${input.subscriptionId},
      ${input.userId},
      ${input.startedOn ?? new Date().toISOString().slice(0, 10)},
      ${input.seatNote ?? null},
      ${actorId}
    )
    on conflict do nothing
  `);
}

/**
 * End a seat.
 *
 * ⚠️ An UPDATE, never a DELETE. Deleting would rewrite history: a tool somebody
 * held for four months would vanish from those four months' spend and last
 * quarter's cost would silently drop. Migration 063's column comment says the
 * same.
 */
export async function endSeat(actorId: string, seatId: string, on?: string): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.subscription_seats
       set ended_on = ${on ?? new Date().toISOString().slice(0, 10)}
     where id = ${seatId} and ended_on is null
  `);
}

export async function setToolCost(
  actorId: string,
  input: {
    subscriptionId: string;
    monthlyCostPkr: number;
    currency?: string;
    billingCycle?: 'monthly' | 'yearly';
    seatsIncluded?: number | null;
    note?: string | null;
  },
): Promise<void> {
  /* An upsert: pricing a tool for the first time and changing its price later
     are the same intent, and two paths would be two places for validation to
     disagree. Same reasoning as `setSalary` in compensation.ts. */
  await withUser(actorId, (tx) => tx`
    insert into public.subscription_costs
      (subscription_id, monthly_cost_pkr, currency, billing_cycle, seats_included,
       note, updated_by_id)
    values (
      ${input.subscriptionId},
      ${input.monthlyCostPkr},
      ${input.currency ?? 'PKR'},
      ${input.billingCycle ?? 'monthly'},
      ${input.seatsIncluded ?? null},
      ${input.note ?? null},
      ${actorId}
    )
    on conflict (subscription_id) do update
       set monthly_cost_pkr = excluded.monthly_cost_pkr,
           currency         = excluded.currency,
           billing_cycle    = excluded.billing_cycle,
           seats_included   = excluded.seats_included,
           note             = excluded.note,
           updated_by_id    = excluded.updated_by_id
  `);
}

/** Add a tool the owner buys later, or rename one. */
export async function saveTool(
  actorId: string,
  input: { id?: string | null; name: string; slug: string; vendor?: string | null; token?: string },
): Promise<void> {
  /* ⚠️ Bound to a local first. Inside the closure, `input.id` widens back to
     `string | null | undefined` — narrowing does not survive into a callback,
     because nothing stops the property changing before it runs. */
  const id = input.id;
  if (id) {
    await withUser(actorId, (tx) => tx`
      update public.subscriptions
         set name = ${input.name}, vendor = ${input.vendor ?? null},
             token = ${input.token ?? 'accent-primary'}
       where id = ${id}
    `);
    return;
  }
  await withUser(actorId, (tx) => tx`
    insert into public.subscriptions (name, slug, vendor, token)
    values (${input.name}, ${input.slug}, ${input.vendor ?? null},
            ${input.token ?? 'accent-primary'})
    on conflict (slug) do nothing
  `);
}

function toTool(row: Record<string, unknown>): Tool {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    vendor: (row.vendor as string | null) ?? null,
    token: row.token as string,
  };
}

/**
 * A `date` column to `yyyy-mm-dd`.
 *
 * ⚠️ Not `.toISOString()` — a `date` arrives as a Date at LOCAL midnight, and in
 * Karachi (+05:00) converting that to UTC yields the previous day at 19:00, so
 * `.slice(0,10)` would return yesterday for every row.
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
