'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { auditAlone } from '@/lib/db/queries/audit';
import * as S from '@/lib/db/queries/subscriptions';
import { can } from '@/lib/domain/permissions';

/* ============================================================================
 * AI TOOLS — ASSIGNING SEATS AND PRICING THEM
 * ----------------------------------------------------------------------------
 * Every action here is Admin and above. A Member reads their own seats through
 * the page, never through an action — reading needs no write path.
 *
 * ⚠️ Pricing is audited. What a tool costs feeds the ledger's subscription run,
 * so changing it changes what future months record; that is the kind of quiet,
 * consequential edit an audit log exists for.
 * ========================================================================= */

export type SubscriptionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

function refresh(): void {
  revalidatePath('/finance');
  revalidatePath('/team');
}

function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export async function assignSeatAction(form: FormData): Promise<SubscriptionResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'subscription.manage')) {
    return { ok: false, error: 'Only an Admin can assign a tool.' };
  }

  const subscriptionId = str(form, 'subscriptionId');
  const userId = str(form, 'userId');
  if (subscriptionId === '' || userId === '') {
    return { ok: false, error: 'Choose a tool and a person.' };
  }

  const startedOn = str(form, 'startedOn');
  await S.assignSeat(user.id, {
    subscriptionId,
    userId,
    startedOn: /^\d{4}-\d{2}-\d{2}$/.test(startedOn) ? startedOn : undefined,
    seatNote: str(form, 'seatNote') || null,
  });

  await auditAlone(user, {
    entityType: 'finance',
    entityId: userId,
    action: 'subscription.seat_assigned',
    after: { subscriptionId, userId },
  });

  refresh();
  return { ok: true, message: 'Assigned.' };
}

/**
 * End a seat.
 *
 * ⚠️ The wording is deliberate: "ended", never "removed". The row survives so
 * that the months somebody actually held the tool keep costing what they cost —
 * see `endSeat` and migration 063.
 */
export async function endSeatAction(seatId: string): Promise<SubscriptionResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'subscription.manage')) {
    return { ok: false, error: 'Only an Admin can take a tool back.' };
  }
  if (seatId === '') return { ok: false, error: 'Nothing to end.' };

  await S.endSeat(user.id, seatId);

  await auditAlone(user, {
    entityType: 'finance',
    entityId: seatId,
    action: 'subscription.seat_ended',
  });

  refresh();
  return { ok: true, message: 'Ended. Past months keep their cost.' };
}

export async function setToolCostAction(form: FormData): Promise<SubscriptionResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'subscription.manage')) {
    return { ok: false, error: 'Only an Admin can price a tool.' };
  }

  const subscriptionId = str(form, 'subscriptionId');
  if (subscriptionId === '') return { ok: false, error: 'Choose a tool.' };

  /* Commas stripped before parsing — "2,500" is not a mistake. */
  const raw = str(form, 'monthlyCostPkr').replace(/[,\s]/g, '');
  const monthlyCostPkr = Number(raw);
  if (raw === '' || !Number.isFinite(monthlyCostPkr) || monthlyCostPkr < 0) {
    return { ok: false, error: 'Enter the cost as a number.' };
  }

  const cycle = str(form, 'billingCycle');
  const billingCycle = cycle === 'yearly' ? 'yearly' : 'monthly';

  const seatsRaw = str(form, 'seatsIncluded');
  const seatsIncluded = seatsRaw === '' ? null : Number(seatsRaw);
  if (seatsIncluded !== null && (!Number.isInteger(seatsIncluded) || seatsIncluded < 1)) {
    return { ok: false, error: 'Seats included must be a whole number, or blank for per-seat.' };
  }

  await S.setToolCost(user.id, {
    subscriptionId,
    monthlyCostPkr: Math.round(monthlyCostPkr * 100) / 100,
    billingCycle,
    seatsIncluded,
    note: str(form, 'note') || null,
  });

  await auditAlone(user, {
    entityType: 'finance',
    entityId: subscriptionId,
    action: 'subscription.cost_set',
    after: { monthlyCostPkr, billingCycle, seatsIncluded },
  });

  refresh();
  return { ok: true, message: 'Saved.' };
}

export async function saveToolAction(form: FormData): Promise<SubscriptionResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'subscription.manage')) {
    return { ok: false, error: 'Only an Admin can add a tool.' };
  }

  const name = str(form, 'name');
  if (name === '') return { ok: false, error: 'Give the tool a name.' };

  const id = str(form, 'id') || null;

  /* The slug is derived rather than asked for — it is an identifier nobody
     should have to think about, and one typed by hand is one that can collide
     with a shape the check constraint refuses. */
  const slug =
    str(form, 'slug') ||
    name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  if (slug === '') return { ok: false, error: 'That name has no letters or digits in it.' };

  await S.saveTool(user.id, {
    id,
    name,
    slug,
    vendor: str(form, 'vendor') || null,
    token: str(form, 'token') || 'accent-primary',
  });

  await auditAlone(user, {
    entityType: 'finance',
    entityId: id,
    action: id ? 'subscription.tool_edited' : 'subscription.tool_added',
    after: { name, slug },
  });

  refresh();
  return { ok: true, message: id ? 'Updated.' : 'Added.' };
}
