import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { STEP_UP_ACTIONS } from '../permissions';

/* ============================================================================
 * EVERY SERVER ACTION THAT PERFORMS A 🔒 ACTION MUST ASK FOR RE-AUTHENTICATION
 * ----------------------------------------------------------------------------
 * ── ⚠️ WHAT THIS EXISTS TO CATCH ─────────────────────────────────────────────
 * `STEP_UP_ACTIONS` listed `user.change_role` and `user.promote_to_admin` from
 * the day it was written, and `app/actions/team.ts` never checked freshness —
 * it imported `requireUser` and nothing else. Credentials, settings, the profile
 * email and task purging all did it correctly, so the omission looked like the
 * others from a distance and every test passed.
 *
 * The consequence was not theoretical: a session taken over at an unlocked
 * laptop could appoint an Admin without producing a password or a second factor,
 * which is precisely what FR-149 exists to prevent.
 *
 * ── WHY A SOURCE-TEXT TEST, WHICH IS NORMALLY A BAD IDEA ─────────────────────
 * Because the bug is an ABSENCE. There is no call to intercept, no return value
 * to assert on and no behaviour to observe — the action simply did the work. A
 * behavioural test would have to drive a real session through a real cookie to
 * prove a negative, and would still only cover the one action somebody thought
 * to write it for.
 *
 * Reading the source catches the whole class instead: add a new action that
 * performs a 🔒 permission and forget the ceremony, and this fails naming the
 * file. It is deliberately coarse — it proves the check is PRESENT, not that it
 * guards the right branch. That is worth having anyway, because every instance
 * of this bug so far has been a missing import rather than a misplaced one.
 * ========================================================================= */

const ACTIONS_DIR = join(process.cwd(), 'app', 'actions');

/** The freshness check, however it is spelled at the call site. */
const ASKS_FOR_STEP_UP = /stepUpIsFresh|stepUpRequired/;

function actionFiles(): string[] {
  return readdirSync(ACTIONS_DIR).filter((name) => name.endsWith('.ts'));
}

describe('step-up wiring across app/actions', () => {
  it('has action files to check at all', () => {
    /* A guard on the guard: if the directory moves, the loop below would pass
       vacuously and the protection would be gone without a failure. */
    expect(actionFiles().length).toBeGreaterThan(5);
  });

  for (const file of actionFiles()) {
    const source = readFileSync(join(ACTIONS_DIR, file), 'utf8');

    /* Which 🔒 actions does this file actually perform? Matched as a quoted
       string, so a mention inside a comment does not count. */
    const performed = STEP_UP_ACTIONS.filter((action) => source.includes(`'${action}'`));

    if (performed.length === 0) continue;

    it(`${file} re-authenticates before ${performed.join(', ')}`, () => {
      expect(
        ASKS_FOR_STEP_UP.test(source),
        `${file} performs ${performed.join(', ')} — all of which are in STEP_UP_ACTIONS — ` +
          'but never checks step-up freshness. See FR-149 and the note on changeRoleAction.',
      ).toBe(true);
    });
  }
});
