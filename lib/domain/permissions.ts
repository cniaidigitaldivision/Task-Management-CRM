/* ============================================================================
 * CNI CRM — THE PERMISSION MATRIX, AS DATA
 * ----------------------------------------------------------------------------
 * Source of truth in prose: docs/03-ROLES-AND-PERMISSIONS.md §3 and §5.
 * This file is that document, transcribed into a table a machine can check.
 *
 * ⛔ LAYER 2 (Domain). Imports nothing but sibling constants — no database, no
 *    framework, no React, no clock, no randomness. doc 20 §1.
 *
 * 🔒 FROZEN CONTRACT (doc 20 §5):
 *       can(actor, action, resource) → boolean
 *       requiresStepUp(action)       → boolean
 *    Changing either signature means auditing every caller.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY A TABLE AND NOT `if` STATEMENTS
 *
 * Doc 03 §3 is ~80 rows across six tables. Written as branching code it would
 * be unreadable, unreviewable against the document, and impossible to test
 * exhaustively — you cannot enumerate the branches of scattered conditionals.
 *
 * As data it is all three: PERMISSIONS reads in the same order as the document,
 * a reviewer can diff it against doc 03 line by line, and the test suite walks
 * the entire action × role cross product because it can simply iterate the keys.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS IS ONE OF FOUR LAYERS, NOT THE ONLY ONE
 *
 * doc 16 §7 requires two independent enforcement layers, and doc 03 §2 requires
 * four for the Super Admin. This file is the SERVER AUTHORISATION layer. It is
 * not a substitute for row-level security, and RLS is not a substitute for it:
 *
 *   · can() answers "may this actor perform this action?"
 *   · RLS answers "which rows may this actor see or touch?"
 *   · triggers answer "is this write legal at all, whoever is asking?"
 *   · the UI merely declines to render controls — never a security boundary
 *
 * Some doc 03 qualifiers are deliberately NOT modelled here because they are
 * row scoping rather than permission, and RLS already owns them. Each is
 * annotated inline where it occurs.
 * ========================================================================= */

import { ROLE_RANK, type Role } from './constants';

/* ==========================================================================
 * RULES
 * ========================================================================== */

/**
 * How a role is permitted to perform an action.
 *
 * Anything other than `allow` / `deny` needs facts about the resource. When
 * those facts are absent, the rule evaluates to **false** — a permission check
 * that cannot prove it should pass, fails. Fail-closed is the only safe
 * default, and it means a caller that forgets to pass context gets a refusal
 * rather than an accidental grant.
 */
export type Rule =
  /** Permitted unconditionally. */
  | 'allow'
  /** Refused unconditionally. */
  | 'deny'
  /** Only on the actor's own user record. `resource.ownerId` */
  | 'self'
  /** Only on a task assigned to the actor. `resource.assigneeId` */
  | 'own_task'
  /** Only on a task the actor created. `resource.createdById` */
  | 'self_created'
  /** Only when the actor is NOT the assignee — BR-002. `resource.assigneeId` */
  | 'not_assignee'
  /** Only on a user the actor strictly outranks. `resource.ownerRole` */
  | 'outranks'
  /** Only within a project the actor already has work in. `resource.isProjectMember` */
  | 'in_project';

/** What a rule may need to know about the thing being acted on. */
export interface ResourceContext {
  /** The user a user-scoped action is about. */
  readonly ownerId?: string;
  /** That user's role, for rank comparisons. */
  readonly ownerRole?: Role;
  /** The assignee of the task being acted on. */
  readonly assigneeId?: string;
  /** Who created the task being acted on. */
  readonly createdById?: string;
  /** Whether the actor already has a task in the project in question. */
  readonly isProjectMember?: boolean;
}

export interface Actor {
  readonly id: string;
  readonly role: Role;
}

/* ==========================================================================
 * THE MATRIX — docs/03 §3, in document order
 * ========================================================================== */

const M = (
  super_admin: Rule,
  admin: Rule,
  team_coordinator: Rule,
  member: Rule,
): Readonly<Record<Role, Rule>> => ({ super_admin, admin, team_coordinator, member });

export const PERMISSIONS = {
  /* ---- Account & team management — doc 03 §3.1 ------------------------- */

  'admin.create': M('allow', 'deny', 'deny', 'deny'),
  'admin.manage': M('allow', 'deny', 'deny', 'deny'),
  'user.create': M('allow', 'allow', 'deny', 'deny'),
  'user.edit_profile': M('allow', 'allow', 'self', 'self'),
  'user.set_capacity_and_skills': M('allow', 'allow', 'deny', 'deny'),
  'user.deactivate': M('allow', 'allow', 'deny', 'deny'),
  'user.purge': M('allow', 'deny', 'deny', 'deny'),
  'user.change_role': M('allow', 'allow', 'deny', 'deny'),
  'user.promote_to_admin': M('allow', 'deny', 'deny', 'deny'),

  /** BR-028. No control exists, for anyone — including the Super Admin. */
  'user.promote_to_super_admin': M('deny', 'deny', 'deny', 'deny'),

  /** doc 03 §5, "No self-elevation": no account changes its own role, ever. */
  'user.change_own_role': M('deny', 'deny', 'deny', 'deny'),

  /** BR-027 / FR-140. Writable only by the row's own identity. */
  'super_admin.edit': M('self', 'deny', 'deny', 'deny'),

  /** FR-156. Guards against both accident and coercion. */
  'super_admin.self_destruct': M('deny', 'deny', 'deny', 'deny'),

  /** FR-146. Cannot be disabled by any account, his own included. */
  'super_admin.disable_mfa': M('deny', 'deny', 'deny', 'deny'),

  'invitation.resend': M('allow', 'allow', 'deny', 'deny'),
  /** doc 03: "Admin — Coordinator/Member only". */
  'user.force_password_reset': M('allow', 'outranks', 'deny', 'deny'),
  'user.reset_mfa': M('allow', 'outranks', 'deny', 'deny'),

  /** The full profile: role, job title, skills, capacity. */
  'user.view_profile': M('allow', 'allow', 'allow', 'deny'),
  /**
   * Name and avatar only — ADR-003's "Member sees other users: name and avatar".
   * A Member is denied the full profile above but allowed this, which is what
   * lets a comment render an author without leaking their capacity. Enforced in
   * the database by the `user_directory` view (migration 005).
   */
  'user.view_directory_entry': M('allow', 'allow', 'allow', 'allow'),

  /* ---- Projects — doc 03 §3.2 ------------------------------------------ */

  'project.create': M('allow', 'allow', 'deny', 'deny'),
  'project.set_type': M('allow', 'allow', 'deny', 'deny'),
  'project.edit': M('allow', 'allow', 'deny', 'deny'),
  'project.change_status': M('allow', 'allow', 'deny', 'deny'),
  /** doc 03 gives the Admin soft delete only; the purge is Super Admin, 🔒. */
  'project.soft_delete': M('allow', 'allow', 'deny', 'deny'),
  'project.purge': M('allow', 'deny', 'deny', 'deny'),
  'project.view_all': M('allow', 'allow', 'allow', 'deny'),
  /** BR-016. A Member sees a project only once they have work in it. */
  'project.view_member_of': M('allow', 'allow', 'allow', 'in_project'),
  /**
   * A Member may create work inside a project they are already on. That the
   * task must also be their own is not encoded here — `task.create_for_other`
   * below already denies them the alternative. Two simple rules compose more
   * safely than one compound one.
   */
  'task.create_in_project': M('allow', 'allow', 'allow', 'in_project'),
  'task.promote_other_to_project': M('allow', 'allow', 'deny', 'deny'),

  /* ---- Tasks — doc 03 §3.3 --------------------------------------------- */

  'task.create_for_self': M('allow', 'allow', 'allow', 'allow'),
  'task.create_for_other': M('allow', 'allow', 'allow', 'deny'),
  'task.assign': M('allow', 'allow', 'allow', 'deny'),
  /** BR-003. The Coordinator plans; only Admin+ may spend past the limit. */
  'task.override_capacity_block': M('allow', 'allow', 'deny', 'deny'),
  'task.edit_content': M('allow', 'allow', 'allow', 'own_task'),
  /** doc 03: a Member may re-plan only what they created themselves. */
  'task.edit_planning': M('allow', 'allow', 'allow', 'self_created'),
  'task.change_status_own': M('allow', 'allow', 'allow', 'allow'),
  'task.change_status_any': M('allow', 'allow', 'allow', 'deny'),

  /**
   * BR-002 — nobody approves their own work, at any rank.
   *
   * `not_assignee` rather than `allow` for all three senior roles. doc 03 §5 is
   * explicit that this includes Coordinators and Admins: their own work
   * escalates one level up. An Admin approving the task they are assigned is
   * exactly the review that never happened.
   */
  'task.approve_review': M('not_assignee', 'not_assignee', 'not_assignee', 'deny'),
  'task.request_revisions': M('not_assignee', 'not_assignee', 'not_assignee', 'deny'),

  'task.cancel': M('allow', 'allow', 'allow', 'self_created'),
  'task.soft_delete': M('allow', 'allow', 'deny', 'deny'),
  'task.purge': M('allow', 'deny', 'deny', 'deny'),
  'task.restore': M('allow', 'allow', 'deny', 'deny'),
  'task.comment': M('allow', 'allow', 'allow', 'own_task'),
  'task.log_time': M('allow', 'allow', 'allow', 'own_task'),

  /* ---- Time limits & extensions — doc 03 §3.4, doc 17 ------------------ */

  'time_limit.set': M('allow', 'allow', 'allow', 'deny'),
  'time_limit.edit_before_start': M('allow', 'allow', 'allow', 'deny'),
  /**
   * The key split (doc 03 §3.4): setting a limit is planning, and the
   * Coordinator does it. Editing it once work has started is a cost decision,
   * and only Admin+ makes that.
   */
  'time_limit.edit_after_start': M('allow', 'allow', 'deny', 'deny'),
  /** FR-184 / BR-018. */
  'extension.grant': M('allow', 'allow', 'deny', 'deny'),
  'extension.decline': M('allow', 'allow', 'deny', 'deny'),
  'extension.request_own': M('allow', 'allow', 'allow', 'allow'),
  /** Coordinator is read-only here: they see requests, `grant` above refuses. */
  'extension.view_all_pending': M('allow', 'allow', 'allow', 'deny'),
  'extension.view_own_pending': M('allow', 'allow', 'allow', 'allow'),
  'timer.control_own': M('allow', 'allow', 'allow', 'allow'),
  'timer.pause_other': M('allow', 'allow', 'allow', 'deny'),
  /**
   * Permitted for everyone on their own time. doc 03's "reason required,
   * flagged" for Coordinator and Member is a validation rule (BR-020, enforced
   * by a DB check and the server action), not a question of permission.
   */
  'time_entry.adjust_own': M('allow', 'allow', 'allow', 'allow'),
  'time_entry.adjust_other': M('allow', 'allow', 'deny', 'deny'),
  /** ADR-003. A Member sees nobody's time but their own. */
  'time_data.view_any': M('allow', 'allow', 'allow', 'deny'),

  /* ---- Visibility — doc 03 §3.5, ADR-003 ------------------------------- */

  'task.view_all': M('allow', 'allow', 'allow', 'deny'),
  'task.view_own': M('allow', 'allow', 'allow', 'allow'),
  'workload.view_team': M('allow', 'allow', 'allow', 'deny'),
  'workload.view_own': M('allow', 'allow', 'allow', 'allow'),
  'user.view_role': M('allow', 'allow', 'allow', 'deny'),
  'user.view_skills_and_capacity': M('allow', 'allow', 'allow', 'deny'),
  'member_activity_preview.view': M('allow', 'allow', 'allow', 'deny'),
  /**
   * doc 03 marks the Coordinator "⚠️ read-only" on the next four. Viewing IS
   * the action, so viewing is allowed; every write these screens offer is a
   * separate action already denied to them above.
   */
  'dashboard.view': M('allow', 'allow', 'allow', 'deny'),
  'reports.view_per_member': M('allow', 'allow', 'allow', 'deny'),
  'reports.view_own': M('allow', 'allow', 'allow', 'allow'),
  'rebalance_advisor.view': M('allow', 'allow', 'allow', 'deny'),
  /**
   * doc 03 gives the Admin "read-only, own scope". *Which rows* is row scoping,
   * and RLS owns it (migration 005 hides Super Admin entries from an Admin —
   * Q-054). Whether they may open the log at all is this.
   */
  'audit_log.view': M('allow', 'allow', 'deny', 'deny'),
  'security_dashboard.view': M('allow', 'deny', 'deny', 'deny'),

  /* ---- System settings — doc 03 §3.6 ----------------------------------- */

  'settings.capacity_thresholds': M('allow', 'deny', 'deny', 'deny'),
  'settings.default_capacity': M('allow', 'deny', 'deny', 'deny'),
  'settings.status_workflow': M('allow', 'deny', 'deny', 'deny'),
  'settings.skills_library': M('allow', 'allow', 'deny', 'deny'),
  'settings.scoring_weights': M('allow', 'deny', 'deny', 'deny'),
  'settings.other_work_threshold': M('allow', 'allow', 'deny', 'deny'),
  'settings.project_type_priority': M('allow', 'deny', 'deny', 'deny'),
  'settings.notification_defaults': M('allow', 'allow', 'deny', 'deny'),
  'settings.own_notification_prefs': M('allow', 'allow', 'allow', 'allow'),
  'settings.security': M('allow', 'deny', 'deny', 'deny'),
  'data.export_all': M('allow', 'deny', 'deny', 'deny'),
  'sessions.view_and_revoke_own': M('allow', 'allow', 'allow', 'allow'),

  /* ---- The credentials vault — owner request 2026-08-12 ------------------
   * Third-party logins held for clients and projects. NOT user account
   * passwords, which are one-way digests nothing can read.
   *
   * ── `view` AND `reveal` ARE 'allow' FOR EVERYBODY, AND THAT IS NOT A HOLE ──
   * The real rule is relational — a project you own, or a login issued to you —
   * and no `Rule` in this file can express that, because it depends on two joins
   * rather than on the actor's role. **Row-level security enforces it**
   * (migration 023, `app.can_read_credential`), exactly as it does for the
   * calendar: a Member opening the vault sees only what was issued to them,
   * which is usually nothing.
   *
   * Inventing a rule kind here would have put a second, weaker copy of that
   * logic in front of the real one — and a permission matrix that looks like it
   * decides row visibility, but does not, is worse than one that plainly says
   * "the database decides".
   *
   * ── `reveal` IS SEPARATE FROM `view` ON PURPOSE ────────────────────────────
   * Seeing that an account exists, who holds it and when it was last rotated is a
   * different act from reading the password. Only the second needs step-up;
   * merging them would mean re-authenticating to look at a list.
   *
   * `manage` and `delete` ARE role-decidable, so they say so: a Coordinator may
   * maintain credentials (RLS narrows it to projects they own) and may not
   * destroy the record of one.
   */
  'credential.view': M('allow', 'allow', 'allow', 'allow'),
  'credential.reveal': M('allow', 'allow', 'allow', 'allow'),
  'credential.manage': M('allow', 'allow', 'allow', 'deny'),
  'credential.delete': M('allow', 'allow', 'deny', 'deny'),

  /* ---- Google Drive documents — owner request 2026-08-13 -----------------
   * Owner: *"every time a user or anybody comes, they should have a place where
   * they can upload something. Other than the team coordinator or admin, every
   * approval will go to the admin… the added is only possible by the admin, super
   * admin, and the coordinator."*
   *
   * `request` is open to everybody, and that is safe because a pending upload is
   * NOT in Drive — it sits in the application's own storage until somebody with
   * authority says yes. The approval is the gate, so the request need not be.
   *
   * `approve` stops at Admin. A Coordinator may add, edit and delete documents but
   * cannot approve one — including their own — which is what keeps the queue
   * meaningful rather than a formality.
   *
   * `view` is 'allow' for every role for the same reason as the vault: the real
   * rule is relational (Admin+ sees the register, anybody sees their own uploads
   * and their projects' documents) and row-level security enforces it, in
   * `app.can_read_document`. No Rule here can express two joins.
   */
  'document.view': M('allow', 'allow', 'allow', 'allow'),
  'document.request': M('allow', 'allow', 'allow', 'allow'),
  'document.approve': M('allow', 'allow', 'deny', 'deny'),
  'document.manage': M('allow', 'allow', 'allow', 'deny'),
  'drive.configure': M('allow', 'allow', 'deny', 'deny'),
} as const satisfies Record<string, Readonly<Record<Role, Rule>>>;

export type Action = keyof typeof PERMISSIONS;

/** Every action, for exhaustive iteration in tests and in the settings UI. */
export const ACTIONS = Object.keys(PERMISSIONS) as readonly Action[];

/* ==========================================================================
 * STEP-UP RE-AUTHENTICATION — FR-149, doc 16 §4
 * ==========================================================================
 * Every 🔒 in doc 03 §3. These demand password + MFA re-entry even inside a
 * valid session, so a hijacked session cannot do the damage a stolen password
 * could.
 */

export const STEP_UP_ACTIONS = [
  'admin.create',
  'admin.manage',
  'user.purge',
  'user.change_role',
  'user.promote_to_admin',
  'super_admin.edit',
  'user.reset_mfa',
  'project.purge',
  'task.purge',
  'audit_log.view',
  'security_dashboard.view',
  'settings.capacity_thresholds',
  'settings.default_capacity',
  'settings.status_workflow',
  'settings.scoring_weights',
  'settings.project_type_priority',
  'settings.security',
  'data.export_all',
  /* Reading a stored credential is the one act in this system that hands over a
     working secret. A valid session is not enough for that — the whole reason
     step-up exists (FR-149) is that a hijacked session must not be able to do
     what a stolen password could, and a vault is precisely where that matters. */
  'credential.reveal',
] as const satisfies readonly Action[];

const STEP_UP_SET: ReadonlySet<string> = new Set(STEP_UP_ACTIONS);

/* ==========================================================================
 * THE PUBLIC API
 * ========================================================================== */

/**
 * May `actor` perform `action` on this resource?
 *
 * Deterministic and total: same inputs, same answer, no exceptions thrown for
 * unknown input — an unrecognised action or role returns `false` rather than
 * crashing a request, because a permission check is the wrong place to fail
 * loudly at runtime.
 *
 * doc 20 §5 — frozen signature.
 */
export function can(actor: Actor, action: Action, resource: ResourceContext = {}): boolean {
  const row = PERMISSIONS[action] as Readonly<Record<Role, Rule>> | undefined;
  if (!row) return false;

  const rule = row[actor.role];
  if (!rule) return false;

  switch (rule) {
    case 'allow':
      return true;

    case 'deny':
      return false;

    case 'self':
      return isSame(actor.id, resource.ownerId);

    case 'own_task':
      return isSame(actor.id, resource.assigneeId);

    case 'self_created':
      return isSame(actor.id, resource.createdById);

    case 'not_assignee':
      // Fail closed: without knowing the assignee we cannot prove BR-002 holds.
      if (resource.assigneeId === undefined) return false;
      return resource.assigneeId !== actor.id;

    case 'outranks': {
      const target = resource.ownerRole;
      if (target === undefined) return false;
      return ROLE_RANK[actor.role] > ROLE_RANK[target];
    }

    case 'in_project':
      return resource.isProjectMember === true;

    default:
      // Unreachable while Rule is exhaustive; a new rule added without a branch
      // here refuses rather than silently permitting.
      return false;
  }
}

/** Does this action demand password + MFA re-entry first? FR-149. */
export function requiresStepUp(action: Action): boolean {
  return STEP_UP_SET.has(action);
}

/**
 * The rule for one role and action, for building UI that explains itself
 * rather than merely hiding a button.
 */
export function ruleFor(role: Role, action: Action): Rule | undefined {
  return (PERMISSIONS[action] as Readonly<Record<Role, Rule>> | undefined)?.[role];
}

/** Every action a role can ever perform, ignoring resource conditions. */
export function actionsFor(role: Role): Action[] {
  return ACTIONS.filter((action) => ruleFor(role, action) !== 'deny');
}

/**
 * Which roles this actor may hand out — doc 03 §3.1, FR-141.
 *
 * ── WHY THIS MOVED HERE ──────────────────────────────────────────────────────
 * It lived as a private function inside `app/actions/team.ts`, reachable only
 * through an `async` wrapper. That made a **pure lookup** cost a server round
 * trip, which is why CHANGE-PLAN 6.1 needed it: the app shell decides whether to
 * offer "Add member" while rendering, and cannot await an action to do it.
 *
 * It is not the authorisation. `users_insert` refuses an out-of-rank insert at the
 * database, and `users_single_super_admin_idx` makes a second Super Admin
 * impossible for the lifetime of the database. This is what lets the interface
 * say so in a sentence instead of letting somebody discover it from an error.
 *
 * **A Super Admin is never in the list.** There is exactly one, for the life of
 * the system, created by first-run setup (BR-028) — so no role, including their
 * own, can produce another.
 */
export function assignableRolesFor(actorRole: Role): Role[] {
  if (actorRole === 'super_admin') return ['admin', 'team_coordinator', 'member'];
  if (actorRole === 'admin') return ['team_coordinator', 'member'];
  return [];
}

/* -------------------------------------------------------------------------- */

function isSame(actorId: string, candidate: string | undefined): boolean {
  // An empty id must never satisfy an ownership check — that would make an
  // unauthenticated request the owner of anything with a missing field.
  if (!candidate || !actorId) return false;
  return candidate === actorId;
}
