import { type Actor, can } from '@/lib/domain/permissions';

/* ============================================================================
 * WHO MAY ASK THE ASSISTANT
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26: *"This facility will only be provided to upper levels,
 * like this super admin, admin, or team coordinator [...] Later on maybe I can
 * have a radio button for each member, in the name of each member, that I can
 * switch on and off at my choice."*
 *
 * Two sources, and the order between them is the whole content of this file:
 *
 *   1. a row in `public.assistant_access` for this person   → it wins
 *   2. otherwise the role default, `assistant.use`          → Coordinator and above
 *
 * ── ⚠️ WHY THE ROW WINS EVEN WHEN IT SAYS `deny` ───────────────────────────
 * The tempting shape is "role default OR an allow row", i.e. grants may only
 * ADD. That gives the owner half a switch: they could turn a Member on and
 * could not turn a Coordinator off, so the radio button they asked for would
 * be disabled for three of the five people on the screen with no explanation.
 *
 * Letting the row win in both directions costs nothing — no row is still the
 * common case — and makes the control mean the same thing on every line.
 *
 * ── ⚠️ PURE, AND THAT IS WHY IT LIVES HERE ─────────────────────────────────
 * No database, no session, no clock. It takes the actor and the row that was
 * already fetched. The page, the floating launcher and the ask action all call
 * this one function, so three places cannot drift into three different answers
 * about whether somebody may use the feature — which is exactly how a launcher
 * ends up rendering for someone the server then refuses.
 * ========================================================================= */

export type AssistantEffect = 'allow' | 'deny';

/** One person's override, or null when nobody has set one. */
export interface AssistantAccessRow {
  readonly userId: string;
  readonly effect: AssistantEffect;
  readonly grantedByName: string | null;
  readonly grantedAt: string;
  readonly note: string | null;
}

/** Why somebody may or may not use it — so the screen can say, not just show. */
export type AccessReason =
  /** No row; their role allows it. */
  | 'by_role'
  /** No row; their role does not allow it. */
  | 'role_denied'
  /** An Admin switched this person on. */
  | 'granted'
  /** An Admin switched this person off. */
  | 'excluded';

export interface AssistantAccess {
  readonly allowed: boolean;
  readonly reason: AccessReason;
}

/**
 * The composed answer.
 *
 * ⚠️ `row` is the override for THIS actor. Passing somebody else's row would
 * silently answer the wrong question, so callers fetch it by the actor's own id
 * — see `assistantAccessFor` in lib/db/queries/assistant.ts, which takes only
 * an actorId and cannot be pointed at another person.
 */
export function resolveAssistantAccess(
  actor: Actor,
  row: AssistantAccessRow | null,
): AssistantAccess {
  if (row) {
    return row.effect === 'allow'
      ? { allowed: true, reason: 'granted' }
      : { allowed: false, reason: 'excluded' };
  }

  return can(actor, 'assistant.use')
    ? { allowed: true, reason: 'by_role' }
    : { allowed: false, reason: 'role_denied' };
}

/** Convenience for the many call sites that only need the boolean. */
export function mayUseAssistant(actor: Actor, row: AssistantAccessRow | null): boolean {
  return resolveAssistantAccess(actor, row).allowed;
}

/**
 * What flipping the switch on the access screen should WRITE.
 *
 * ── ⚠️ THREE STATES, ONE TWO-POSITION CONTROL ──────────────────────────────
 * A person is on, off, or "whatever their rank says", and a switch can only
 * point two ways. The resolution is that the third state is not something an
 * Admin sets — it is something the switch MAINTAINS:
 *
 *   · flipping somebody AWAY from what their rank says writes an override
 *   · flipping them BACK to what their rank says removes it
 *
 * So a row exists only while it carries information. Turn a Coordinator off and
 * on again and you end where you started, with no row — where the obvious
 * implementation ("on writes allow, off writes deny") would leave an `allow`
 * row asserting that an Admin decided something nobody decided. That row then
 * outlives the rank it was shadowing: promote a Member who was switched on, and
 * a stale `allow` is indistinguishable from a deliberate grant.
 *
 * ⚠️ `roleAllows` is what the person's RANK ALONE would say — `resolveAssistantAccess`
 * with a null row. Passing their EFFECTIVE access instead makes this a no-op,
 * because the target and the current state would always agree.
 *
 * Pure, and separate from the component, because this is the rule most likely
 * to be got subtly wrong and the one whose mistakes are invisible on screen —
 * both versions look identical until somebody reads the table.
 */
export function nextAccessEffect(
  currentlyAllowed: boolean,
  roleAllows: boolean,
): AssistantEffect | 'reset' {
  /* Where the flip is heading. */
  const wanted = !currentlyAllowed;

  /* Rank already says that, so the row has nothing left to say. */
  if (wanted === roleAllows) return 'reset';

  return wanted ? 'allow' : 'deny';
}

/**
 * A sentence for the access screen.
 *
 * ⚠️ Distinguishes "on by rank" from "switched on by name", because those need
 * different controls: the first is revoked by EXCLUDING the person, the second
 * by removing their row. A screen that showed both as a plain tick would offer
 * a control that does nothing on half the rows — the trap
 * `credential-access-dialog.tsx` documents at length.
 */
export function describeAccess(access: AssistantAccess): string {
  switch (access.reason) {
    case 'by_role':
      return 'Included by rank';
    case 'role_denied':
      return 'Not included';
    case 'granted':
      return 'Switched on by name';
    case 'excluded':
      return 'Switched off by name';
  }
}
