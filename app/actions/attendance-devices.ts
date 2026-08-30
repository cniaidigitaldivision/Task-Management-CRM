'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { audit } from '@/lib/db/queries/audit';
import { withUser } from '@/lib/db/client';
import * as D from '@/lib/db/queries/attendance-devices';
import { checkEmployeeNo, toAttendanceMode } from '@/lib/domain/attendance-device';
import { can } from '@/lib/domain/permissions';

/* ============================================================================
 * MAPPING PEOPLE TO TERMINALS — owner request 2026-08-30
 * ----------------------------------------------------------------------------
 * *"I want in dashboard this feature… only in admin and superadmin."*
 *
 * Everything here is `attendance.manage_devices` — Admin and Super Admin, one
 * rung narrower than `attendance.view_all`. Migration 079 narrows the tables to
 * match, so a Coordinator is refused by the database as well as by the screen.
 * ========================================================================= */

export interface DeviceResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly message?: string;
}

const fail = (error: string): DeviceResult => ({ ok: false, error });

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

/**
 * Link an employee number on the terminal to a Taskly account.
 *
 * ⚠️ AND THEN REPLAY WHAT ALREADY ARRIVED. Somebody scans in the morning and is
 * mapped at lunchtime; without the replay their arrival is simply missing and
 * they read as absent on a day they were present. That is only possible because
 * unmatched scans are kept rather than dropped — see migration 078.
 */
export async function mapPersonAction(
  _prev: DeviceResult,
  form: FormData,
): Promise<DeviceResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'attendance.manage_devices')) {
    return fail('Only an Admin can enrol somebody on an attendance terminal.');
  }

  const userId = str(form, 'userId');
  const employeeNo = str(form, 'employeeNo');
  if (!userId) return fail('No person was named.');

  /* Empty means "unmap". Anything else has to look like something the terminal
     could actually send — see `checkEmployeeNo` on why this is narrow. */
  if (employeeNo) {
    const shape = checkEmployeeNo(employeeNo);
    if (!shape.ok) return fail(shape.message);
  }

  try {
    await D.mapPerson(user.id, userId, employeeNo || null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Only an Admin/i.test(message)) {
      return fail('Only an Admin can enrol somebody on an attendance terminal.');
    }
    console.error('[attendance-devices] mapping failed', message);
    return fail('That could not be saved.');
  }

  let applied = 0;
  let skipped = 0;
  if (employeeNo) {
    try {
      const replay = await D.applyStoredScans(user.id, employeeNo);
      applied = replay.applied;
      skipped = replay.skipped;
    } catch (error) {
      /* ⚠️ NOT fatal, and the mapping stands. The link is the thing that was
         asked for; the replay is a bonus that recovers scans from before it.
         Failing the whole action here would leave somebody re-doing a mapping
         that had actually worked. */
      console.error('[attendance-devices] replay failed', error);
    }
  }

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'attendance',
      entityId: userId,
      action: employeeNo ? 'attendance.device_mapped' : 'attendance.device_unmapped',
      after: { employeeNo: employeeNo || null, scansApplied: applied },
    }),
  ).catch(() => console.error('[attendance-devices] audit write failed'));

  revalidatePath('/attendance');

  if (!employeeNo) {
    return { ok: true, message: 'Unlinked from the terminal. Their scans will no longer count.' };
  }

  return {
    ok: true,
    message:
      applied > 0
        ? `Linked to ${employeeNo}. ${applied} scan${applied === 1 ? '' : 's'} already received ${applied === 1 ? 'was' : 'were'} applied to their attendance.`
        : `Linked to ${employeeNo}. Their next scan will be recorded.${
            skipped > 0 ? ` ${skipped} older scan${skipped === 1 ? '' : 's'} ${skipped === 1 ? 'was' : 'were'} too old to apply.` : ''
          }`,
  };
}

/**
 * Whether somebody may use the Taskly button, or must scan at a terminal.
 *
 * The owner's rule: *"if I want to set that, definitely as admin I will set that
 * or as super admin. No one else has the authority to change it."* Enforced by
 * trigger in migration 078 as well as here.
 */
export async function setAttendanceModeAction(
  _prev: DeviceResult,
  form: FormData,
): Promise<DeviceResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'attendance.manage_devices')) {
    return fail('Only an Admin can change how somebody records attendance.');
  }

  const userId = str(form, 'userId');
  const mode = toAttendanceMode(str(form, 'mode'));
  if (!userId || !mode) return fail('Choose how this person records attendance.');

  try {
    await D.setAttendanceMode(user.id, userId, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Only an Admin/i.test(message)) {
      return fail('Only an Admin can change how somebody records attendance.');
    }
    console.error('[attendance-devices] mode change failed', message);
    return fail('That could not be saved.');
  }

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'attendance',
      entityId: userId,
      action: 'attendance.mode_changed',
      after: { mode },
    }),
  ).catch(() => console.error('[attendance-devices] audit write failed'));

  revalidatePath('/attendance');

  return {
    ok: true,
    message:
      mode === 'terminal_only'
        ? 'They now record attendance at the terminal only. The button in Taskly will be refused.'
        : 'They can now use either the terminal or the button in Taskly.',
  };
}
