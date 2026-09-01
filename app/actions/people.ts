'use server';

import { revalidatePath } from 'next/cache';

import { requireUser, stepUpIsFresh } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import { record } from '@/lib/db/queries/feed';
import {
  addAvailability,
  changeOwnEmail,
  getPerson,
  removeUserSkill,
  setOwnAvatar,
  setTheme,
  setSalary,
  setUserSkill,
  updateCapacity,
  updateOwnProfile,
} from '@/lib/db/queries/people';
import {
  AVAILABILITY_TYPES,
  ROLE_LABEL,
  THEMES,
  type AvailabilityType,
  type Theme,
} from '@/lib/domain/constants';
import { sameEmail, validateEmailAddress } from '@/lib/domain/email-address';
import { checkEmployeeNo } from '@/lib/domain/attendance-device';
import { can } from '@/lib/domain/permissions';
import { notifyEmailChanged } from '@/lib/email/notify';
import {
  AVATAR_MAX_BYTES,
  avatarPathFromUrl,
  removeAvatar,
  uploadAvatar,
} from '@/lib/storage/bucket';
import { nowMs } from '@/lib/now';
import { appUrl } from '@/lib/app-url';

/* ============================================================================
 * PEOPLE ACTIONS — LAYER 3
 * ----------------------------------------------------------------------------
 * ── WHY NONE OF THESE CREATE AN ACCOUNT ──────────────────────────────────────
 * Provisioning a person is a *credential* operation, not a profile edit: it
 * needs an invitation token, a 48-hour expiry, an activation ceremony and an
 * email that actually arrives (FR-141 to FR-144, doc 16 §3). That is Step 5.2,
 * and doing half of it here — creating a row somebody cannot sign in to — would
 * be worse than not doing it, because the account would look real.
 *
 * So these actions edit people who already exist: capacity, concurrency limit,
 * job title, skills, leave, and the person's own profile and theme.
 *
 * ── THE SUPER ADMIN IS UNTOUCHABLE, AND NOT BECAUSE OF THIS FILE ──────────────
 * Migration 005's trigger refuses any foreign write to a `super_admin` row.
 * These actions do not need to check for it and deliberately do not pretend to:
 * the guarantee is in the database, where it holds even when the application is
 * wrong (BR-027, FR-140).
 * ========================================================================= */

export interface PeopleActionResult {
  readonly ok: boolean;
  readonly error?: string;
  /** The caller must re-authenticate before this will be accepted (FR-149). */
  readonly stepUpRequired?: boolean;
  /** Said on success where the outcome is worth spelling out. */
  readonly note?: string;
}

const fail = (error: string): PeopleActionResult => ({ ok: false, error });

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function num(form: FormData, key: string): number | undefined {
  const raw = str(form, key);
  if (raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/* ==========================================================================
 * Capacity, concurrency and job title — Admin+ (doc 03 §3.1)
 * ========================================================================== */

export async function updateCapacityAction(
  _prev: PeopleActionResult,
  form: FormData,
): Promise<PeopleActionResult> {
  const user = await requireUser();
  const userId = str(form, 'userId');

  const target = await getPerson(user.id, userId);
  if (!target) return fail('That person is no longer available.');

  if (
    !can({ role: user.role, id: user.id }, 'user.set_capacity_and_skills', {
      ownerId: target.id,
      ownerRole: target.role,
    })
  ) {
    return fail('Only an Admin can change capacity and skills (doc 03 §3.1).');
  }

  const capacity = num(form, 'weeklyCapacityPoints');
  const maxTasks = num(form, 'maxConcurrentTasks');

  /* ADR-004 is the reason for the upper bound. 48 is the *attendance* week;
     capacity is 36 because breaks, briefs, calls, context switching and render
     waits take roughly a quarter of it. Allowing 48 here would leave every
     threshold permanently silent, which is the most common way a workload
     system fails — it looks configured and warns about nothing. */
  if (capacity !== undefined && (capacity < 1 || capacity > 48)) {
    return fail(
      'Weekly capacity has to be between 1 and 48 points. 36 is the default — 48 attendance hours are not 48 productive hours (ADR-004).',
    );
  }
  if (maxTasks !== undefined && (maxTasks < 1 || maxTasks > 20)) {
    return fail('The concurrent-task limit has to be between 1 and 20.');
  }

  /* ── ⚠️ WHAT AN ADMIN MAY EDIT THAT A COORDINATOR MAY NOT ─────────────────
     Owner, 2026-09-01, asked for every field in one dialog and chose to keep
     salary Admin-only. Office, terminal number and attendance mode belong on
     the same side of that line: each has a database trigger refusing anybody
     below Admin (060, 078), so a Coordinator submitting them would meet a raw
     Postgres error instead of a sentence.

     ⚠️ AND THE FIELDS ARE SKIPPED, NOT REJECTED. A Coordinator's dialog does
     not render them, so a well-behaved form never posts them — but a stale tab
     or a hand-built request might. Ignoring what they may not set lets their
     legitimate edits go through, where refusing the whole submission would lose
     the name change they actually made. */
  const isAdmin = can({ role: user.role, id: user.id }, 'attendance.manage_devices');

  const fullName = str(form, 'fullName');
  if (fullName && fullName.trim().length < 2) {
    return fail('A name needs at least two characters.');
  }

  const salaryRaw = str(form, 'monthlySalary');
  let salary: number | null | undefined;
  if (isAdmin && form.has('monthlySalary')) {
    if (salaryRaw === '') {
      salary = null;
    } else {
      const parsed = Number(salaryRaw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return fail('A salary has to be a number of rupees, or left empty.');
      }
      salary = parsed;
    }
  }

  const employeeNo = str(form, 'devicePersonNo');
  if (isAdmin && employeeNo) {
    const shape = checkEmployeeNo(employeeNo);
    if (!shape.ok) return fail(shape.message);
  }

  try {
    await updateCapacity(user.id, userId, {
      weeklyCapacityPoints: capacity,
      maxConcurrentTasks: maxTasks,
      roleTitle: str(form, 'roleTitle') || null,
      ...(fullName ? { fullName } : {}),
      ...(form.has('phone') ? { phone: str(form, 'phone') || null } : {}),
      ...(isAdmin && form.has('officeTeam')
        ? { officeTeam: str(form, 'officeTeam') === 'wah' ? ('wah' as const) : ('blue_area' as const) }
        : {}),
      ...(isAdmin && form.has('devicePersonNo')
        ? { devicePersonNo: employeeNo || null }
        : {}),
      ...(isAdmin && form.has('attendanceMode')
        ? {
            attendanceMode:
              str(form, 'attendanceMode') === 'terminal_only'
                ? ('terminal_only' as const)
                : ('either' as const),
          }
        : {}),
    });

    if (salary !== undefined) {
      await setSalary(user.id, userId, salary);
    }

    await withUser(user.id, async (tx) => {
      await audit(tx, user, {
        entityType: 'user',
        entityId: userId,
        action: 'user.capacity_changed',
        before: {
          weeklyCapacityPoints: target.weeklyCapacityPoints,
          maxConcurrentTasks: target.maxConcurrentTasks,
        },
        after: {
          weeklyCapacityPoints: capacity ?? target.weeklyCapacityPoints,
          maxConcurrentTasks: maxTasks ?? target.maxConcurrentTasks,
        },
      });
      await record(tx, user.id, {
        entityType: 'user',
        entityId: userId,
        action: 'capacity_changed',
        summary: `updated ${target.fullName}'s capacity`,
        before: {
          weeklyCapacityPoints: target.weeklyCapacityPoints,
          maxConcurrentTasks: target.maxConcurrentTasks,
          roleTitle: target.roleTitle,
        },
        after: {
          weeklyCapacityPoints: capacity ?? target.weeklyCapacityPoints,
          maxConcurrentTasks: maxTasks ?? target.maxConcurrentTasks,
          roleTitle: str(form, 'roleTitle') || null,
        },
      });
    });

    revalidatePath('/team');
    revalidatePath('/workload');
    revalidatePath('/dashboard');
    return { ok: true };
  } catch {
    /* The most likely cause is the migration-005 trigger refusing a write to the
       Super Admin row. Say what happened rather than leaking the SQL. */
    return fail(
      `That change was refused. The Super Admin row cannot be altered by anyone else (BR-027), and an ${ROLE_LABEL[user.role]} can only manage people below them.`,
    );
  }
}

/* ==========================================================================
 * Skills — FR-012
 * ========================================================================== */

export async function setSkillAction(
  userId: string,
  skillId: string,
  proficiency: number,
  isPrimary = false,
): Promise<PeopleActionResult> {
  const user = await requireUser();
  const target = await getPerson(user.id, userId);
  if (!target) return fail('That person is no longer available.');

  if (
    !can({ role: user.role, id: user.id }, 'user.set_capacity_and_skills', {
      ownerId: target.id,
      ownerRole: target.role,
    })
  ) {
    return fail('Only an Admin can set skills.');
  }
  if (!Number.isInteger(proficiency) || proficiency < 1 || proficiency > 5) {
    return fail('Proficiency runs 1 to 5 — 5 is expert, 3 is capable, 1 is can-help.');
  }

  await setUserSkill(user.id, { userId, skillId, proficiency, isPrimary });
  revalidatePath('/team');
  return { ok: true };
}

export async function removeSkillAction(
  userId: string,
  skillId: string,
): Promise<PeopleActionResult> {
  const user = await requireUser();
  const target = await getPerson(user.id, userId);
  if (!target) return fail('That person is no longer available.');

  if (
    !can({ role: user.role, id: user.id }, 'user.set_capacity_and_skills', {
      ownerId: target.id,
      ownerRole: target.role,
    })
  ) {
    return fail('Only an Admin can set skills.');
  }

  await removeUserSkill(user.id, userId, skillId);
  revalidatePath('/team');
  return { ok: true };
}

/* ==========================================================================
 * Leave and availability — FR-014
 * ========================================================================== */

export async function addAvailabilityAction(
  _prev: PeopleActionResult,
  form: FormData,
): Promise<PeopleActionResult> {
  const user = await requireUser();
  const userId = str(form, 'userId') || user.id;
  const type = str(form, 'type') as AvailabilityType;
  const startDate = str(form, 'startDate');
  const endDate = str(form, 'endDate') || startDate;

  if (!AVAILABILITY_TYPES.includes(type)) return fail('Choose a type of absence.');
  if (!startDate) return fail('Give a start date.');
  if (endDate < startDate) return fail('The end date cannot be before the start date.');

  /* A half day is half a day. Anything else is fully out, and doc 06 §2 excludes
     a fully-unavailable person from recommendations entirely (BR-005). */
  const multiplier = type === 'half_day' ? 0.5 : 0;

  try {
    await addAvailability(user.id, {
      userId,
      startDate,
      endDate,
      type,
      capacityMultiplier: multiplier,
      note: str(form, 'note') || null,
    });

    await withUser(user.id, (tx) =>
      record(tx, user.id, {
        entityType: 'user',
        entityId: userId,
        action: 'availability_added',
        summary: `recorded ${type.replace('_', ' ')} from ${startDate} to ${endDate}`,
        after: { type, startDate, endDate, multiplier },
      }),
    );

    revalidatePath('/team');
    revalidatePath('/workload');
    revalidatePath('/my-work');
    return { ok: true };
  } catch {
    return fail('That could not be saved. You can only record leave for yourself or your team.');
  }
}

/* ==========================================================================
 * Your own profile
 * ========================================================================== */

export async function updateProfileAction(
  _prev: PeopleActionResult,
  form: FormData,
): Promise<PeopleActionResult> {
  const user = await requireUser();

  const fullName = str(form, 'fullName');
  if (!fullName) return fail('Your name cannot be blank.');
  if (fullName.length > 120) return fail('That name is too long.');

  try {
    await updateOwnProfile(user.id, {
      fullName,
      phone: str(form, 'phone') || null,
      timezone: str(form, 'timezone') || undefined,
    });
    revalidatePath('/profile');
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch {
    return fail('That could not be saved.');
  }
}

/* ==========================================================================
 * YOUR SIGN-IN ADDRESS — REDESIGN-PLAN §2
 * ==========================================================================
 * ── WHY THIS IS ALLOWED AT ALL, INCLUDING FOR THE SUPER ADMIN ────────────────
 * Migration 005's immutability trigger blocks exactly four things on that row:
 * modification by anyone else, self-demotion, self-deactivation and self-locking
 * (BR-027, FR-140, FR-156). Email is not among them, and deliberately so — an
 * account whose address can never change is an account that dies with the
 * mailbox. The Profile page has promised this since Step 6 and never had it.
 *
 * ── WHY THE STEP-UP IS DEMANDED HERE AND NOT VIA `requiresStepUp()` ──────────
 * There is no doc 03 §3 action for "change your own email", and there must not
 * be one. `PERMISSIONS` is that document transcribed, and its test suite writes
 * the document out a second time and compares — inventing a row would put a rule
 * in the table the document does not contain, and the transcription layer would
 * be right to fail.
 *
 * It also would not mean anything. `can()` answers "may this actor perform this
 * action", and the answer is unconditionally yes: everybody may change their own
 * address, and RLS on `users` already confines the write to their own row. The
 * question this ceremony asks is a different one — is the person at the keyboard
 * still the account holder — which is what FR-149 is for. So the freshness check
 * is made directly, and it is unconditional rather than table-driven.
 *
 * ── APPLIED IMMEDIATELY, WITH THE ALERT AS THE CONTROL ───────────────────────
 * A link sent to the new address would prove it exists before trusting it. That
 * needs a verified sending domain, which the owner has deferred, so the plan
 * chose password + authenticator + an alert to the OLD address instead. The
 * hazard that leaves is a TYPO, not an attacker: a mistyped address saves
 * cleanly and locks the person out for good. That is why this asks for the
 * address twice, why `validateEmailAddress` refuses a domain that cannot
 * receive mail, and why the form says plainly what is at stake.
 * ========================================================================== */

/* `appUrl()` now lives in lib/app-url.ts and derives the origin from the
   request, so a link is never built against localhost. See that file. */

export async function changeEmailAction(
  _prev: PeopleActionResult,
  form: FormData,
): Promise<PeopleActionResult> {
  const user = await requireUser();

  const checked = validateEmailAddress(str(form, 'newEmail'));
  if (!checked.ok) return fail(checked.message);
  const newEmail = checked.email;

  /* Typed twice, compared after normalising — differing only in case is not a
     mismatch worth refusing somebody over. */
  if (!sameEmail(str(form, 'confirmEmail'), newEmail)) {
    return fail('The two addresses do not match. Check both, character for character.');
  }

  if (sameEmail(newEmail, user.email)) {
    return fail('That is already your sign-in address — nothing to change.');
  }

  /* FR-149, checked after the cheap validation so nobody is made to
     re-authenticate and only then told they mistyped the address. */
  if (!stepUpIsFresh(user, nowMs())) {
    return {
      ok: false,
      stepUpRequired: true,
      error: 'Confirm it is you before changing your sign-in address.',
    };
  }

  let changed: { previousEmail: string } | null;
  try {
    changed = await changeOwnEmail(user.id, newEmail);
  } catch (error) {
    /* The unique index is the only thing that can see the whole email column —
       RLS shows a Member one row, so there is no select that could have asked
       this question first. See changeOwnEmail's header. */
    const code = (error as { code?: string }).code;
    if (code === '23505') {
      return fail('Another account already uses that address. Every address here is one person.');
    }
    if (code === '23514') {
      return fail('The database refused that address. Check it and try again.');
    }
    return fail('That could not be saved. Your address is unchanged.');
  }

  if (!changed) {
    /* No row updated. They are signed in, so their row exists — this is the
       Super Admin trigger or a policy refusing the write, not a missing user. */
    return fail('That change was refused. Your address is unchanged.');
  }

  /* Pinned to a const before the closure below: `changed` is a `let`, and
     TypeScript widens a narrowed `let` back to its declared type inside a
     callback because it cannot prove nothing reassigned it in between. */
  const previousEmail = changed.previousEmail;
  const when = new Date(nowMs());

  /* Written BEFORE the email is attempted, and not fire-and-forget. The alert
     is the only control on an immediate change, and Resend is the one part of
     this that can be unreachable — so the durable record lands first, where the
     Super Admin sees it on /security whether or not the mail went. */
  await withUser(user.id, async (tx) => {
    await audit(tx, user, {
      entityType: 'user',
      entityId: user.id,
      action: 'user.email_changed',
      before: { email: previousEmail },
      after: { email: newEmail },
    });
    await tx`
      insert into public.security_events (user_id, event_type, severity, details)
      values (
        ${user.id},
        'email_changed',
        ${user.role === 'super_admin' ? 'critical' : 'warning'}::public.security_severity,
        ${tx.json({ from: previousEmail, to: newEmail, role: user.role })}
      )
    `;
  });

  notifyEmailChanged({
    previousEmail,
    newEmail,
    fullName: user.fullName,
    when,
    isSuperAdmin: user.role === 'super_admin',
    appUrl: await appUrl(),
  });

  revalidatePath('/profile');
  revalidatePath('/security');
  revalidatePath('/', 'layout');

  return {
    ok: true,
    note: `Done — you now sign in as ${newEmail}. An alert has gone to ${previousEmail}, so a change nobody made is visible to whoever owns that mailbox.`,
  };
}

/**
 * FR-202 — the theme follows the person, not the browser.
 *
 * The toggle still writes localStorage for the pre-paint script (there is no way
 * to avoid a flash otherwise: the database cannot be consulted before the first
 * paint). This persists the same choice so a new device starts correct.
 */
export async function setThemeAction(theme: Theme): Promise<PeopleActionResult> {
  const user = await requireUser();
  if (!THEMES.includes(theme)) return fail('Unknown theme.');
  await setTheme(user.id, theme);
  return { ok: true };
}

/* ==========================================================================
 * YOUR PROFILE PICTURE — CHANGE-PLAN 2.3
 * ==========================================================================
 * Owner instruction, Session 20: *"on the profiles everyone can add their
 * profile picture, their avatar… and that picture is presented on every task."*
 *
 * ── THE BUCKET IS PUBLIC, AND ATTACHMENTS ARE STILL PRIVATE ─────────────────
 * Owner decision. An attachment is work — a brief, a contract, an unreleased
 * campaign — and a permanent URL to one is access forever with no account. An
 * avatar is a face that appears on every card on the board, so a private bucket
 * would mean a signing round trip per person per page to protect a photograph
 * the same people are looking at anyway.
 *
 * ── WHICH MAKES THE FILE CHECK THE IMPORTANT PART ────────────────────────────
 * A public bucket serves whatever it is given. `uploadAvatar` decides the
 * content type from the file's MAGIC BYTES, never from what the browser said —
 * `File.type` is a claim by the client, not an inspection. SVG is refused
 * outright at both the bucket and the code: it is a document that can carry
 * script, and an uploaded one would be stored XSS on the storage origin.
 * ========================================================================== */

export async function uploadAvatarAction(
  _prev: PeopleActionResult,
  form: FormData,
): Promise<PeopleActionResult> {
  const user = await requireUser();

  const file = form.get('avatar');
  if (!(file instanceof File) || file.size === 0) return fail('Choose a picture first.');
  if (file.size > AVATAR_MAX_BYTES) {
    return fail('Pictures have to be under 2 MB. Try a smaller one.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const stored = await uploadAvatar(user.id, bytes);
  if (!stored.ok) return fail(stored.message);

  /* Row first, THEN the old object. The other order risks a row pointing at a
     file that is gone — a broken image on every card — where this one risks an
     orphaned 40 KB file nobody ever sees. */
  const { previousUrl } = await setOwnAvatar(user.id, stored.value.url);

  const oldPath = avatarPathFromUrl(previousUrl);
  if (oldPath) void removeAvatar(oldPath);

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'user',
      entityId: user.id,
      action: 'user.avatar_changed',
      after: { path: stored.value.path },
    }),
  ).catch(() => {});

  revalidatePath('/profile');
  revalidatePath('/', 'layout');
  for (const path of ['/tasks', '/team', '/workload', '/my-work', '/dashboard']) {
    revalidatePath(path);
  }
  return { ok: true, note: 'Your picture is set. It now appears wherever you do.' };
}

export async function removeAvatarAction(): Promise<PeopleActionResult> {
  const user = await requireUser();
  const { previousUrl } = await setOwnAvatar(user.id, null);

  const oldPath = avatarPathFromUrl(previousUrl);
  if (oldPath) void removeAvatar(oldPath);

  revalidatePath('/profile');
  revalidatePath('/', 'layout');
  for (const path of ['/tasks', '/team', '/workload', '/my-work', '/dashboard']) {
    revalidatePath(path);
  }
  return { ok: true, note: 'Removed. Your initials are shown again.' };
}
