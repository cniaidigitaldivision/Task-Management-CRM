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

import { ROLE_RANK, type Role, type TaskStatus } from './constants';

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
  /**
   * ⚠️ WIDENED TO ADMIN, 2026-08-23. Owner: *"I want that super admin and admin
   * to be able to delete a team member… I'm adding someone and I couldn't delete
   * it. I don't want to dump my database with the testing or dummy data."*
   *
   * The rank rule still applies underneath — `outranks` is not used here because
   * the database refuses regardless: an Admin cannot reach the Super Admin, and
   * `enforce_users_write_rules` is the thing that actually stops it.
   *
   * What keeps this safe is not the role, it is `purgeBlockers` below plus the
   * thirteen RESTRICT foreign keys on authored content. A person who has made
   * anything cannot be purged by anybody, Super Admin included.
   */
  'user.purge': M('allow', 'allow', 'deny', 'deny'),
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

  /* ── ⚠️ THE COORDINATOR RUNS PROJECTS NOW — owner, 2026-08-23 ──────────────
   * *"a team coordinator can create a new project and can add social media
   * accounts, their credentials, and their documentation. He can also manage all
   * these things."*
   *
   * Was Admin-and-above throughout, from doc 03 §3.2. The reasoning then was
   * that a project is a commercial commitment — it carries a package, a fee and
   * a client. That is still true of the MONEY, and `project.view_finance` is
   * unchanged: a Coordinator creates and runs the project without ever seeing
   * what it bills, which is the owner's earlier instruction and this one held
   * together.
   *
   * What stays Admin-only is destruction, not creation: `project.soft_delete`
   * and `project.purge` below. Someone who plans the work should not be able to
   * remove the container it lives in. */
  'project.create': M('allow', 'allow', 'allow', 'deny'),
  'project.set_type': M('allow', 'allow', 'allow', 'deny'),
  'project.edit': M('allow', 'allow', 'allow', 'deny'),
  'project.change_status': M('allow', 'allow', 'allow', 'deny'),
  /** doc 03 gives the Admin soft delete only; the purge is Super Admin, 🔒. */
  'project.soft_delete': M('allow', 'allow', 'deny', 'deny'),
  'project.purge': M('allow', 'deny', 'deny', 'deny'),
  'project.view_all': M('allow', 'allow', 'allow', 'deny'),
  /**
   * See money: the monthly fee, and any total derived from it.
   *
   * Owner, 2026-08-19: *"this monthly fee or any financial thing should only be
   * visible to super admin and admin only. It will not be visible to any
   * coordinator or anyone else on the team."*
   *
   * ── ⚠️ WHY THIS IS ITS OWN ACTION AND NOT `project.edit` ─────────────────────
   * The two happen to have the same answer today, and reusing `project.edit` would
   * work — right up until somebody gives a Coordinator edit rights on their own
   * projects, at which point every fee on the system becomes visible as a side
   * effect of an unrelated decision. Asking the question this screen actually means
   * keeps that from happening silently.
   *
   * Note this is a DISPLAY gate, not a confidentiality boundary: a Coordinator can
   * still reach `projects.monthly_fee_pkr` through any query RLS lets them run. Not
   * rendering it is what the owner asked for; making it unreadable would need a
   * column-level grant and is a separate piece of work.
   */
  'project.view_finance': M('allow', 'allow', 'deny', 'deny'),
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

  /* ── ⚠️ THIS ROW IS THE COARSE HALF OF THE RULE — SEE `canDeleteTask` ──────
   * Owner, 2026-08-23, stating it fully:
   *   1. *"everyone can delete his own task that he raised or created by
   *      himself. Tasks assigned by someone else would not be deletable unless
   *      that person deletes them."*
   *   2. *"that task will not be deletable unless it is in the To Do or In
   *      Progress status. Once it is in [Blocked], Done, Cancel, or Backlog
   *      status, the delete option will only be available to admin."*
   *
   * `self_created` for BOTH lower roles now, not just Member: a Coordinator was
   * `deny`, which meant they could raise a task by mistake and then had to ask
   * an Admin to remove it. The owner's rule 1 says everyone, and it means it.
   *
   * ⚠️ WHAT THIS ROW CANNOT SAY is rule 2. No `Rule` kind here takes a STATUS —
   * they describe the actor's relationship to a resource, not the resource's own
   * state. So this row answers "may this role ever delete this task", and
   * `canDeleteTask` below answers the whole question. The action calls that one.
   * Kept in the matrix anyway because doc 03 lists the action, and a row missing
   * from the table reads as an oversight rather than a deliberate split. */
  'task.soft_delete': M('allow', 'allow', 'self_created', 'self_created'),
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
  /* ⚠️ ADMIN, from 2026-08-22 — owner decision, taken against a stated caution.
   *
   * This screen lists live sessions, failed sign-ins and security events for
   * EVERY account, and its session panel can end a session. An Admin can
   * therefore sign the Super Admin out. The owner was told that in those words
   * and chose full parity anyway.
   *
   * What still holds them off the Super Admin: `users_update` refuses any write
   * to that row (migration 005), `audit_log_select` hides the Super Admin's own
   * entries from an Admin (Q-054), and nothing here grants `admin.create` or
   * `user.purge`. Being signed out is recoverable; the rest would not be.
   *
   * ⚠️ The matrix alone does NOT open this screen — the row-level policies on
   * `security_events` and `sessions` were super_admin-only and had to move with
   * it (migration 040). Granting one without the other renders empty panels,
   * which reads as a broken page rather than a permission boundary. */
  'security_dashboard.view': M('allow', 'allow', 'deny', 'deny'),

  /* ---- System settings — doc 03 §3.6 -----------------------------------
   * ⚠️ THE ADMIN REACHED ALL OF THESE ON 2026-08-22, BY OWNER DECISION.
   *
   * Owner: *"the admin today cannot open security, can't change [settings] …
   * and cannot export data. I want the admin to be able to export data because I
   * am the admin … They run the company project without being able to adjust how
   * the system works. Definitely I want that."*
   *
   * The original split gave the Admin the day-to-day settings and reserved the
   * ones that change how the ENGINE scores and schedules — capacity thresholds,
   * the status workflow, assignment weights — for the Super Admin, on the
   * reasoning that those alter every future decision the system makes rather than
   * one project. That reasoning was sound and the owner overruled it knowingly:
   * the person running the division is an Admin, and an Admin who cannot set a
   * capacity threshold has to ask someone else to run their own team.
   *
   * The Super Admin keeps what is genuinely about CONTROL OF THE SYSTEM ITSELF —
   * appointing Admins, purging records, and their own account. Those are still
   * 'deny' above, and deliberately so. */

  'settings.capacity_thresholds': M('allow', 'allow', 'deny', 'deny'),
  'settings.default_capacity': M('allow', 'allow', 'deny', 'deny'),
  'settings.status_workflow': M('allow', 'allow', 'deny', 'deny'),
  'settings.skills_library': M('allow', 'allow', 'deny', 'deny'),
  'settings.scoring_weights': M('allow', 'allow', 'deny', 'deny'),
  'settings.other_work_threshold': M('allow', 'allow', 'deny', 'deny'),
  'settings.project_type_priority': M('allow', 'allow', 'deny', 'deny'),
  'settings.notification_defaults': M('allow', 'allow', 'deny', 'deny'),
  'settings.own_notification_prefs': M('allow', 'allow', 'allow', 'allow'),
  'settings.security': M('allow', 'allow', 'deny', 'deny'),
  'data.export_all': M('allow', 'allow', 'deny', 'deny'),
  'sessions.view_and_revoke_own': M('allow', 'allow', 'allow', 'allow'),

  /* ---- The credentials vault — owner request 2026-08-12 ------------------
   * Third-party logins held for clients and projects. NOT user account
   * passwords, which are one-way digests nothing can read.
   *
   * ── ⚠️ COORDINATOR AND ABOVE. A MEMBER SEES NOTHING. REVISED 2026-08-24 ────
   * Owner: *"it is only shown to team coordinators and admins. Not even the
   * person who is working on this project can show that credential to them. This
   * control is given only to coordinators and admins."*
   *
   * `view` and `reveal` were `allow` for all four roles, on the reasoning that
   * the real rule was relational — a project you own, or a login issued to you —
   * and that row-level security expressed it (migration 023). That reasoning was
   * sound and the rule it deferred to is the one that has now been withdrawn:
   * migration 047 replaces `app.can_read_credential` with the same rank test
   * written here. The two layers now agree, which is the point.
   *
   * ⚠️ THE "ISSUED TO ME" ROUTE IS GONE, AND IT WAS THE ONE THAT MATTERED. It
   * read as generous and it was the leak: `issued_to_id` records who HOLDS an
   * account, and it was being spent as a permanent grant to read that account's
   * password. Custody and access are different things.
   *
   * ⚠️ AND THIS REVOKES SOMETHING PEOPLE WERE USING. A Member who read a client
   * login here to do their work can no longer. That is intended — stated twice,
   * in those words — and is written down because the failure mode is somebody
   * blocked on a Monday morning wondering what broke.
   *
   * ── `reveal` IS STILL SEPARATE FROM `view` ─────────────────────────────────
   * Seeing that an account exists, who holds it and when it was last rotated is a
   * different act from reading the password. Only the second needs step-up;
   * merging them would mean re-authenticating to look at a list.
   */
  'credential.view': M('allow', 'allow', 'allow', 'deny'),
  'credential.reveal': M('allow', 'allow', 'allow', 'deny'),
  /* ── ⚠️ ADMIN AND ABOVE. THIS WAS COORDINATOR UNTIL 2026-08-25 ─────────────
     Owner: *"only the admin is able to assign, add, delete, or manage who can
     view this whole project: credential plus any specific credential."*

     ⚠️ THIS REVERSES 2026-08-23 — *"he can also manage all these things"* — and
     the reversal is deliberate, not a regression. Both instructions are recorded
     because the older one is what the previous value was for.

     ⚠️ IT ALSO FIXES A MISMATCH THAT WAS ALREADY THERE. `credentials_delete` in
     the database has been admin-only since migration 023, while this line said
     Coordinator — so a Coordinator was shown a Delete button and got an RLS
     refusal when they used it. An application more permissive than its policies
     leaks nothing; it just lies to somebody about what they can do. Migration 058
     tightens insert and update to match, and both halves now say admin. */
  'credential.manage': M('allow', 'allow', 'deny', 'deny'),
  'credential.delete': M('allow', 'allow', 'deny', 'deny'),
  /**
   * Giving a NAMED person access to one credential, and taking it back.
   * Migration 050.
   *
   * ── ⚠️ ADMIN AND ABOVE, AND THIS IS THE ONE VAULT ACT A COORDINATOR CANNOT DO
   * Owner, 2026-08-24, of the "Who can see this credential" modal: *"only admins
   * and super admins can add someone and can delete someone from here."*
   *
   * Every other credential permission above allows a Coordinator. This one does
   * not, and the asymmetry is right rather than arbitrary: `credential.manage`
   * changes a stored value, and a value changed in error can be changed back.
   * Handing read access to a third person cannot be undone by revoking it — they
   * have already seen the password. So the act that is irreversible is the act
   * that needs the higher rank.
   */
  'credential.grant': M('allow', 'allow', 'deny', 'deny'),

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
   * ⚠️ `approve` REACHED COORDINATOR ON 2026-08-16, by the owner's decision when
   * asked directly. It previously stopped at Admin, on the reasoning that a
   * Coordinator approving their own upload makes the queue a formality. The owner
   * chose fewer bottlenecks: a Coordinator running a project can push its
   * documents through. **They can therefore approve their own upload.** That is
   * the accepted trade, not an oversight — and the audit log records who approved
   * what, so it is visible rather than merely permitted.
   *
   * `view` is 'allow' for every role for the same reason as the vault: the real
   * rule is relational (Admin+ sees the register, anybody sees their own uploads
   * and their projects' documents) and row-level security enforces it, in
   * `app.can_read_document`. No Rule here can express two joins.
   */
  'document.view': M('allow', 'allow', 'allow', 'allow'),
  'document.request': M('allow', 'allow', 'allow', 'allow'),
  'document.approve': M('allow', 'allow', 'allow', 'deny'),
  'document.manage': M('allow', 'allow', 'allow', 'deny'),
  /* Owner, 2026-08-16: *"super admin, admin and team coordinator … can make the
     documents viewable for members to see for any project they want."* So sharing
     a folder stops at Coordinator, one rung LOWER than approving — a Coordinator
     runs the projects whose folders these are, and deciding who may read a folder
     is part of running it. Mirrored by the `drive_folders_write` policy in
     migration 027, which is the enforcement; this is the sentence. */
  'document.share': M('allow', 'allow', 'allow', 'deny'),
  /* ⚠️ Still Admin-only, deliberately, and NOT part of the 2026-08-23 widening.
     This connects the division's Google account — one OAuth grant shared by
     everybody, not a per-project setting. A Coordinator managing a project's
     documents (`document.manage`, already theirs) is a different act from
     re-pointing the whole division's Drive. */
  'drive.configure': M('allow', 'allow', 'deny', 'deny'),

  /* ── THE COMPANY LIBRARY IS NOT THE UPLOAD QUEUE — owner request 2026-08-29 ─
     *"There is no button to upload any file in this category or in this company
     library… add a modal which will pop up to let me add any documentation."*

     ⚠️ ADMIN+, WHICH IS ONE RUNG HIGHER THAN `document.manage`, AND THAT IS THE
     POINT OF HAVING A SEPARATE ACTION. `document.*` governs the approval queue:
     material somebody submits, that is checked, that belongs to one project. The
     library is the agency's OWN collateral — the rate card, the package deck, the
     thing a client is quoted from — and it is read by everybody signed in with no
     approval step in front of it. Whoever may write here publishes to the whole
     company directly.

     ⚠️ AND IT MATCHES `library_documents_write` IN MIGRATION 035, which is
     `app.acting_at_least('admin')`. That policy is the enforcement; this line is
     what stops the screen offering a Coordinator a button whose only possible
     outcome is a database refusal. Widening one without the other produces
     exactly that. */
  'library.manage': M('allow', 'allow', 'deny', 'deny'),

  /* ---- Attendance — owner instruction, 2026-08-25 ----------------------- */

  /* ⚠️ EVERYBODY, INCLUDING THE SUPER ADMIN. Checking yourself in is not a
     privilege and there is no rank at which it stops applying — the owner asked
     for the button to be *"appearing throughout this whole dashboard"*, which
     means on everybody's. Enforced again by the trigger in migration 060, which
     only lets somebody open their own row, for today. */
  'attendance.check_in': M('allow', 'allow', 'allow', 'allow'),

  /* Whose attendance you can see. Owner: *"the CEO, or you can say the super
     admin or admin, and the team coordinator can see who is coming on time and
     who is coming late."* A Member sees their own record and no one else's,
     which is the RLS policy in 060 rather than this line. */
  'attendance.view_all': M('allow', 'allow', 'allow', 'deny'),

  /* ── THE ATTENDANCE TERMINALS — owner instruction, 2026-08-30 ─────────────
     Asked where the mapping screen should live, the owner answered: *"only in
     admin and superadmin."*

     ⚠️ NARROWER THAN `attendance.view_all`, WHICH THE COORDINATOR HAS. Seeing
     who came in late is reading a record; mapping an employee number decides
     WHOSE attendance a face opens, and registering a terminal hands out a key to
     the whole record. Those are different acts and the owner drew the line
     between them.

     ⚠️ Mirrored by migration 079, which narrows the two tables' select policies
     to match. Widening this line without widening those gives an Admin-only
     screen backed by data a Coordinator can still read. */
  'attendance.manage_devices': M('allow', 'allow', 'deny', 'deny'),

  /* ⚠️ ADMIN AND ABOVE ONLY, AND THE COORDINATOR IS DELIBERATELY OUT — the one
     place attendance diverges from every other permission in this file. Owner,
     naming him: *"he forgot to check out, he can add their checkout time but you
     can say Kashif or any team coordinator could not do that."*

     A Coordinator can therefore SEE everything and change nothing. That is the
     right split: the person who notices you were late should not be the person
     who can quietly make you on time. Migration 060's trigger refuses the write
     as well, so this line is the sentence and not the boundary. */
  'attendance.edit': M('allow', 'allow', 'deny', 'deny'),

  /* ---- Finance — owner instruction, 2026-08-26 -------------------------- */

  /* The ledger, its totals, its charts, its report. Owner: *"in the admin panel
     the admin and the super admin can view where we have spent and what we have
     spent [...] the list of expenses, their report, or their analysis should
     only be visible to the admin and the super admin."*

     ⚠️ NOT reusing `project.view_finance`, whose own comment argues against
     exactly that: the two happen to agree today, and sharing a key means a later
     decision about project fees silently changes who can read the payroll. */
  'finance.view': M('allow', 'allow', 'deny', 'deny'),

  /* ⚠️ THE COORDINATOR IS IN, AND THIS IS THE ONLY FINANCE LINE WHERE HE IS.
     Owner, same message: *"the team coordinator can also add expenses."* He
     files a bill and sees nothing back — no list, no total, no report.

     That asymmetry is enforced by migration 064, which gives `public.expenses`
     an INSERT policy admitting `team_coordinator` and a SELECT policy admitting
     only `admin`. This line is the sentence; the policy is the boundary. */
  'finance.record_expense': M('allow', 'allow', 'allow', 'deny'),

  /* Editing or deleting a ledger row, recording income, pricing a tool, and
     posting a month. Admin and above — correcting the books is a different act
     from filing a receipt into them. */
  'finance.manage': M('allow', 'allow', 'deny', 'deny'),

  /* ── ISSUING AN INVOICE — owner request 2026-08-29 ─────────────────────────
     *"When someone invoices, only super admin and admin can generate an invoice
     over here. For right now — later on, maybe I will add some other people."*

     ⚠️ ITS OWN ACTION RATHER THAN REUSING `finance.manage`, WHICH TODAY HAS THE
     IDENTICAL ROW. That looks like duplication and is the opposite: the owner
     said outright that this list will change, and `finance.manage` also governs
     editing the ledger, running payroll and reading the P&L. Widening "who may
     bill a client" must not silently widen "who may see what everyone is paid",
     and with one action it would.

     An invoice is also the only thing in this product that LEAVES THE COMPANY
     under its own letterhead and signature. That is a different kind of act
     from any other finance write, and it deserves a line of its own to point at
     when it changes.

     ⚠️ `revenue_entries` RLS is Admin+ (migration 064) and stays the
     enforcement. When this widens past Admin, that policy has to widen with it
     or the new person gets a button and a database refusal. */
  'invoice.issue': M('allow', 'allow', 'deny', 'deny'),

  /* Sending it is separated from creating it, because the owner chose "issue,
     preview, then send" — and because an email to a client cannot be recalled.
     Same rank today; separate so a future "a coordinator may draft, an admin
     sends" needs no new concept. */
  'invoice.send': M('allow', 'allow', 'deny', 'deny'),

  /* ⚠️ VOIDING IS THE ONLY WAY TO CORRECT A SENT INVOICE (migration 076 freezes
     them), so it is the one destructive act in this feature — and it is
     deliberately NOT wider than issuing. Somebody who may not bill a client
     must not be able to un-bill one. */
  'invoice.void': M('allow', 'allow', 'deny', 'deny'),

  /* ⚠️ EVERYBODY, MEMBER INCLUDED. Owner: *"each person can see which
     subscriptions they have, for example Gemini, but the subscription cost is
     not compulsory to show them."*

     Seeing your own seat is not a privilege. WHOSE seats you can see is decided
     by the policy in migration 063 (`user_id = app.current_user_id() or
     acting_at_least('admin')`), not by this line — and the cost is not merely
     hidden from a Member, it is in a table their role cannot select at all. */
  'subscription.view_own': M('allow', 'allow', 'allow', 'allow'),

  /* Assigning a tool to somebody, ending a seat, and setting what it costs. */
  'subscription.manage': M('allow', 'allow', 'deny', 'deny'),

  /* ---- The assistant — owner instruction, 2026-08-26 -------------------- */

  /* ⚠️ THE ROLE DEFAULT, NOT THE WHOLE ANSWER. Owner: *"I'm not providing this
     facility to all of the company. This facility will only be provided to
     upper levels, like this super admin, admin, or team coordinator [...] Later
     on maybe I can have a radio button for each member [...] that I can switch
     on and off at my choice."*

     A row in `public.assistant_access` OVERRIDES this line in either direction —
     an `allow` row turns one Member on, a `deny` row turns one Coordinator off.
     So this matrix is the floor somebody falls back to, and `mayUseAssistant()`
     in lib/domain/assistant-access.ts is the function that decides. Reading this
     row alone will give the wrong answer for anybody who has been switched. */
  'assistant.use': M('allow', 'allow', 'allow', 'deny'),

  /* Turning the assistant on or off for one person. Admin and above — the
     owner was explicit that it is *"on admin or super admin choice."* */
  'assistant.manage_access': M('allow', 'allow', 'deny', 'deny'),

  /* ⚠️ SEEING WHAT OTHER PEOPLE ASKED AND WHAT IT COST. Owner: *"maybe one
     person uses all the credits and someone didn't use it so I should have some
     check and balance."*

     This governs the usage SCREEN. What it can actually show is narrower and is
     set by RLS, not here: migration 069's select policy admits an Admin to rows
     with `role = 'user'` only, so questions are visible and other people's
     answers are not. Widening this line would not widen that. */
  'assistant.view_usage': M('allow', 'allow', 'deny', 'deny'),
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
  /* ⚠️ `user.purge` IS NOT IN THIS LIST, AND THAT IS NOT A RELAXATION.
     Owner, 2026-08-23, deleting a test account: *"once I enter it, it sends me
     to the authenticator app. No need… Just the password is enough here."*

     Session step-up is deliberately coarse: it stamps the SESSION, so for ten
     minutes it satisfies every 🔒 action at once. That is right for the things
     on this list, which are all reversible-but-privileged — a role change, a
     settings edit, reading a credential. It is the wrong instrument for a
     permanent delete, because passing it once to remove a mistyped invitation
     would also unlock a credential read as a side effect.

     So `purgePersonAction` asks for the password ITSELF, inline in its own
     confirmation, and does NOT mark the session. The proof is consumed by that
     one delete and elevates nothing else — narrower than what it replaced, not
     weaker. Removing it from this list is what stops the two mechanisms from
     both firing and asking twice. */
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
  /* ── ⚠️ `credential.reveal` IS DELIBERATELY ABSENT — OWNER'S DECISION ─────
     Owner, 2026-08-25: *"don't require confirming the password again. I don't
     need that. Just decrypt the credential and let me watch. Keep the access
     level and all these things."* Asked, and reaffirmed in the same breath.

     What this gives up, stated plainly so nobody has to rediscover it: FR-149
     existed because a HIJACKED SESSION must not be able to do what a stolen
     password could. Reading a credential is the one act here that hands over a
     working secret, so an attacker with a live session cookie can now read the
     vault without ever knowing the password. That is the cost.

     What still holds, and is why this is a narrowing rather than an opening:
       · The permission matrix is untouched — Member is still `deny`, and rank or
         a named grant is still required (see `revealCredentialAction`).
       · Every reveal is still written to the audit log AND to
         `security_events` with the reader's name. The trail is the control that
         remains, and it is now the only one, which makes it more important
         rather than less.
       · `credential.grant` KEEPS its step-up, below. Reading hands one secret to
         the person at the keyboard; granting hands it to a third party, standing,
         until somebody notices. The owner asked about viewing, not about granting.

     ⚠️ Do not "restore consistency" by re-adding this. It was removed on purpose
     and putting it back reintroduces the prompt the owner twice said they did not
     want. */
  /* ⚠️ AND SO IS GIVING SOMEBODY ELSE THAT ABILITY. `credential.reveal` hands over
     one secret, once, to the person at the keyboard. `credential.grant` hands it
     over to a third party, standing, until somebody notices — so a hijacked
     session that cannot read a password must certainly not be able to grant
     itself a colleague who can. It is the more dangerous of the two and would be
     an odd thing to protect less. Migration 050. */
  'credential.grant',
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

/**
 * May `actorRole` put work on somebody of `assigneeRole`?
 *
 * Owner, 2026-08-23: *"a lower-level person could not assign a task to an
 * upper-level person… The flow will always move from up to down. In the same way
 * the task assign thing will also move from up to down… the team coordinator can
 * assign a task to all team members except the admin and super admin."*
 *
 * ── ⚠️ THIS IS A DIFFERENT QUESTION FROM `task.create_for_other` ─────────────
 * That one asks "may this person assign work at all", and answers yes for
 * Coordinator and above. It says nothing about WHO — so a Coordinator could put
 * a task on the Super Admin, which is the gap this closes. Both checks run: the
 * first decides whether assigning is their job, this decides whether the target
 * is beneath them.
 *
 * ── WHY `>=` AND NOT `>` ────────────────────────────────────────────────────
 * Equal rank is allowed. Two Coordinators planning between themselves is normal
 * work, and the owner's rule names the exclusions upward — *"except the admin
 * and super admin"* — not sideways. `>` would stop a Coordinator handing
 * anything to another Coordinator, which nobody asked for.
 *
 * ── IT IS NOT IN `PERMISSIONS` ──────────────────────────────────────────────
 * The matrix answers "may this ROLE do this ACTION", and every `Rule` it has
 * describes the actor's relationship to a RESOURCE — self, own task, in project.
 * This compares two roles, which no rule kind expresses. `outranks` is the
 * closest and is subtly wrong here: it is strict, and it is about acting ON a
 * user record rather than about handing work to one.
 */
export function canAssignTo(actorRole: Role, assigneeRole: Role): boolean {
  /* ── ⚠️ A MEMBER HANDS WORK TO NOBODY, NARROWED 2026-09-03 ────────────────
     Owner: *"all the team members who is creating their task they will not
     assign to anyone as they have to do by there by himself"*, and only a
     Coordinator or above may hand work down: *"if I say that if a team
     coordinator he can assign tasks to lower team members, all the team
     members, not to admin."*

     The rank comparison alone returned TRUE for member → member, because their
     ranks are equal — so one Member could put work on another. Rank was the
     wrong instrument for that pair: what separates them is not seniority.

     ⚠️ THIS DOES NOT STOP A MEMBER RAISING THEIR OWN WORK, and the distinction
     matters. Assigning to yourself is settled by IDENTITY, not rank, and every
     caller checks it first — `rankGate` returns early on
     `assigneeId === actorId`. A function that only knows two roles cannot tell
     "me" from "a peer", so it answers the question it can and leaves the other
     to the code that has the ids. */
  if (actorRole === 'member') return false;

  return ROLE_RANK[actorRole] >= ROLE_RANK[assigneeRole];
}

/**
 * The people this actor may hand work to, filtered from a wider list.
 *
 * Used to build the assignee control, so a name that would be refused is never
 * offered. The server checks `canAssignTo` again — this is convenience, never
 * the boundary (registry C-21).
 */
export function assignableTo<T extends { readonly id: string; readonly role: Role }>(
  actor: { readonly id: string; readonly role: Role },
  people: readonly T[],
): T[] {
  /* ⚠️ Takes the actor's ID as well as their role, because since 2026-09-03 a
     Member may assign only to THEMSELVES — which is an identity question that
     `canAssignTo` cannot answer from a role alone. Without the id here the
     picker would offer a Member nobody at all, including themselves, and they
     could not raise their own work from it. */
  return people.filter(
    (person) => person.id === actor.id || canAssignTo(actor.role, person.role),
  );
}

/* ============================================================================
 * DELETING A TASK — THE WHOLE RULE, IN ONE PLACE
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-23, in three parts:
 *
 *   1. *"everyone can delete his own task that he raised or created by
 *      himself."*
 *   2. *"tasks assigned by someone else would not be deletable unless that
 *      person deletes them."*
 *   3. *"that task will not be deletable unless it is in the To Do or In
 *      Progress status. Once it is in [Blocked], Done, Cancel, or Backlog
 *      status, the delete option will only be available to admin."*
 *
 * ── ⚠️ WHY THIS IS A FUNCTION AND NOT A MATRIX ROW ──────────────────────────
 * Rules 1 and 2 are about WHO — `self_created` says both of them in one word,
 * and the matrix carries it. Rule 3 is about the task's own STATE, and no `Rule`
 * kind takes a status: they all describe the actor's relationship to a resource.
 * Adding a `self_created_and_early` kind would encode one screen's policy into
 * the shared vocabulary, which is how a permission table stops being readable.
 *
 * So the matrix keeps the coarse answer and this composes the full one. Both are
 * checked — this calls `can()` rather than reimplementing it.
 *
 * ── WHY ONLY TO DO AND IN PROGRESS ──────────────────────────────────────────
 * The owner named those two as the window and listed the rest as Admin-only.
 * It is a whitelist rather than a blacklist on purpose: `in_review` and
 * `revisions` were not named either way, and work that somebody else is
 * currently reviewing is exactly the case where a quiet delete is worst — the
 * reviewer's screen empties with no explanation. A whitelist fails closed for
 * every status nobody thought about, including any added later.
 *
 * ── "ADMIN" MEANS ADMIN AND SUPER ADMIN ─────────────────────────────────────
 * The owner said so explicitly. Expressed as a rank comparison rather than two
 * string equalities, so it stays true if a rank is ever inserted between them.
 * ========================================================================= */

/** The only statuses in which somebody other than an Admin may delete a task. */
export const DELETABLE_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress'];

export interface DeletableTask {
  readonly createdById: string;
  readonly assigneeId?: string | null;
  readonly status: TaskStatus;
}

/** Why a delete was refused, so the interface can say which rule applied rather
 *  than "no permission" — the two refusals need different responses from the
 *  person reading them. */
export type DeleteRefusal = 'not_yours' | 'too_far_along' | null;

/**
 * May this actor delete this task? Returns the reason when not.
 *
 * `null` means allowed. Anything else is the rule that refused, and the caller
 * turns it into a sentence — kept as a code rather than a string so the domain
 * layer holds no copy.
 */
export function deleteRefusal(actor: Actor, task: DeletableTask): DeleteRefusal {
  /* Admin and above: any task, any status. Rule 3's escape hatch. */
  if (ROLE_RANK[actor.role] >= ROLE_RANK.admin) return null;

  /* Rules 1 and 2, via the matrix — `self_created` is exactly "you raised it". */
  if (!can(actor, 'task.soft_delete', { createdById: task.createdById })) {
    return 'not_yours';
  }

  /* Rule 3. */
  if (!DELETABLE_STATUSES.includes(task.status)) return 'too_far_along';

  return null;
}

/** Convenience for the interface, which usually only needs the boolean. */
export function canDeleteTask(actor: Actor, task: DeletableTask): boolean {
  return deleteRefusal(actor, task) === null;
}

/* ==========================================================================
 * DELETING A PERSON — owner request, 2026-08-23
 * ==========================================================================
 * *"I want that super admin and admin to be able to delete a team member…
 * I'm having a lot of difficulty maintaining things because I'm just testing.
 * I'm adding someone and I couldn't delete it. I don't want to dump my
 * database with the testing or dummy data."*
 *
 * ── TWO DIFFERENT THINGS WERE BOTH CALLED "CANNOT DELETE" ────────────────────
 * They have opposite answers, and conflating them is why this looked like one
 * immovable rule:
 *
 *   1. A person who has never made anything — invited yesterday, or invited and
 *      never activated. There is nothing to protect. This was refused only
 *      because of a database accident (see migration 041) and is now allowed.
 *
 *   2. A person who created tasks, wrote comments, owns a project, logged time
 *      or uploaded a document. Removing them would either destroy that work or
 *      orphan it. Still refused, for everybody, Super Admin included — and the
 *      thirteen RESTRICT foreign keys enforce it whatever this file says.
 *
 * Deactivation remains the answer for (2), which is what BR-007 was always
 * really about: *"accounts are deactivated, never deleted"* is right for people
 * who have done work, and was never meant to trap a typo'd test account.
 *
 * ── WHY THE COUNTS ARE PASSED IN ─────────────────────────────────────────────
 * This layer has no database and no clock (doc 19 §2). The caller counts; this
 * decides. That also makes every branch below testable without a fixture.
 */

/** What a person has left behind. Each field maps to RESTRICT foreign keys. */
export interface PersonFootprint {
  readonly tasksCreated: number;
  readonly comments: number;
  readonly projects: number;
  readonly timeEntries: number;
  readonly uploads: number;
}

export const EMPTY_FOOTPRINT: PersonFootprint = {
  tasksCreated: 0,
  comments: 0,
  projects: 0,
  timeEntries: 0,
  uploads: 0,
};

/**
 * The specific things holding a person in the system, in the order a human
 * would want to hear them. Empty means they can be removed.
 *
 * Phrased for display because the alternative — returning codes and mapping
 * them in three different components — is how the same list ends up worded
 * three different ways.
 */
export function purgeBlockers(footprint: PersonFootprint): readonly string[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const blockers: string[] = [];

  if (footprint.tasksCreated > 0) blockers.push(plural(footprint.tasksCreated, 'task', 'tasks'));
  if (footprint.comments > 0) blockers.push(plural(footprint.comments, 'comment', 'comments'));
  if (footprint.projects > 0) blockers.push(plural(footprint.projects, 'project', 'projects'));
  if (footprint.timeEntries > 0) {
    blockers.push(plural(footprint.timeEntries, 'time entry', 'time entries'));
  }
  if (footprint.uploads > 0) blockers.push(plural(footprint.uploads, 'upload', 'uploads'));

  return blockers;
}

export type PurgeRefusal =
  | 'not_permitted'
  | 'self'
  | 'outranked'
  | 'has_work'
  | null;

/**
 * Whether `actor` may permanently remove `target`, and if not, why.
 *
 * ⚠️ `self` is checked before rank, because an Admin outranks themselves and
 * would otherwise sail through into deleting their own account — which, unlike
 * deactivation, nobody could undo for them.
 */
export function purgeRefusal(
  actor: Actor,
  target: { id: string; role: Role },
  footprint: PersonFootprint,
): PurgeRefusal {
  if (!can(actor, 'user.purge')) return 'not_permitted';
  if (actor.id === target.id) return 'self';

  /* Strictly greater, not `>=`. Deactivation lets an Admin manage a peer; a
     permanent delete between equals is how two Admins remove each other. */
  if (ROLE_RANK[actor.role] <= ROLE_RANK[target.role]) return 'outranked';

  if (purgeBlockers(footprint).length > 0) return 'has_work';

  return null;
}

/** Convenience for the interface, which usually only needs the boolean. */
export function canPurgePerson(
  actor: Actor,
  target: { id: string; role: Role },
  footprint: PersonFootprint,
): boolean {
  return purgeRefusal(actor, target, footprint) === null;
}
