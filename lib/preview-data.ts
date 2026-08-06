/* ============================================================================
 * PREVIEW DATA — UI ONLY
 * ----------------------------------------------------------------------------
 * ⚠️ This file exists so the interface can be designed and reviewed before the
 *    database exists. It is NOT seed data and it is NOT written anywhere.
 *
 *    ADR-009 is explicit: the system ships with no team data. The Admin
 *    creates every member through the application. This file is deleted the
 *    moment real queries land (Phase 1 Step 6 / Phase 2).
 *
 * Every number below obeys the real rules so the screens are honest:
 *   · capacity 36 pts/week (ADR-004)
 *   · load = effort × priority weight × status weight (doc 06 §2)
 *   · bands 0–59 available · 60–84 healthy · 85–99 near limit · 100+ over
 * ========================================================================= */

import { STATUS_META, type EffortSize, type Priority, type ProjectType, type TaskStatus, type WorkloadBand } from './domain/constants';

export interface PreviewMember {
  id: string;
  name: string;
  roleTitle: string;
  loadPoints: number;
  capacityPoints: number;
  openTasks: number;
  band: WorkloadBand;
  /** Share of this member's load by project type — drives doc 15 §6. */
  otherWorkPct: number;
}

export interface PreviewTask {
  /** Stable key. The board reorders tasks locally, so React needs an identity
   *  that does not change when the status does. */
  id: string;
  reference: string;
  title: string;
  projectName: string;
  projectType: ProjectType;
  assignee: string;
  /** Who created it. Drives the Member "self-created only" rules in doc 03 §3. */
  createdBy: string;
  status: TaskStatus;
  priority: Priority;
  effort: EffortSize;
  dueLabel: string;
  overdue?: boolean;
  timeSpentMinutes: number;
  timeLimitMinutes: number;
  /** Mandatory when status is `blocked` (FR-043). */
  blockedReason?: string;
  commentCount?: number;
  attachmentCount?: number;
  checklist?: { done: number; total: number };
}

export const PREVIEW_MEMBERS: readonly PreviewMember[] = [
  {
    id: 'm1',
    name: 'Kashif Ahmed',
    roleTitle: 'Video Editor · Coordinator',
    loadPoints: 16.5,
    capacityPoints: 36,
    openTasks: 4,
    band: 'available',
    otherWorkPct: 9,
  },
  {
    id: 'm2',
    name: 'Yusra Khan',
    loadPoints: 34.5,
    roleTitle: 'Ads Manager',
    capacityPoints: 36,
    openTasks: 10,
    band: 'warning',
    otherWorkPct: 21,
  },
  {
    id: 'm3',
    name: 'Ayesha Siddiqui',
    roleTitle: 'Graphic Designer',
    loadPoints: 10.5,
    capacityPoints: 36,
    openTasks: 3,
    band: 'available',
    otherWorkPct: 4,
  },
  {
    id: 'm4',
    name: 'Danish Raza',
    roleTitle: 'Content Writer',
    loadPoints: 29.5,
    capacityPoints: 36,
    openTasks: 6,
    band: 'healthy',
    otherWorkPct: 7,
  },
  {
    id: 'm5',
    name: 'Emaan Tariq',
    roleTitle: 'Web Developer',
    loadPoints: 38,
    capacityPoints: 36,
    openTasks: 2,
    band: 'over',
    otherWorkPct: 0,
  },
  {
    id: 'm6',
    name: 'Farhan Malik',
    roleTitle: 'Social Media Manager',
    loadPoints: 21.5,
    capacityPoints: 36,
    openTasks: 5,
    band: 'healthy',
    otherWorkPct: 12,
  },
];

/* Seventeen tasks spread across all eight statuses. Six was enough for a
 * dashboard widget but leaves a Kanban board looking abandoned, and a board is
 * exactly where the shape of the work has to be legible at a glance. */
export const PREVIEW_TASKS: readonly PreviewTask[] = [
  /* ---- In progress ---- */
  {
    id: 't01',
    reference: 'EVT-142',
    title: 'Edit exhibition showreel — 30s vertical',
    projectName: 'Expo Karachi — Oct 2026',
    projectType: 'event',
    assignee: 'Kashif Ahmed',
    createdBy: 'Sana Minhas',
    status: 'in_progress',
    priority: 'high',
    effort: 'M',
    dueLabel: 'Due today',
    timeSpentMinutes: 192,
    timeLimitMinutes: 240,
    commentCount: 4,
    attachmentCount: 3,
    checklist: { done: 3, total: 5 },
  },
  {
    id: 't02',
    reference: 'OTH-205',
    title: 'Fix audio on last year’s wedding video',
    projectName: 'Misc / Ad-hoc',
    projectType: 'other',
    assignee: 'Kashif Ahmed',
    createdBy: 'Kashif Ahmed',
    status: 'in_progress',
    priority: 'low',
    effort: 'S',
    dueLabel: 'No due date',
    timeSpentMinutes: 390,
    timeLimitMinutes: 300,
    commentCount: 1,
  },
  {
    id: 't03',
    reference: 'BIZ-032',
    title: 'Rewrite the services page copy',
    projectName: 'CNI Website Refresh',
    projectType: 'business',
    assignee: 'Danish Raza',
    createdBy: 'Sana Minhas',
    status: 'in_progress',
    priority: 'medium',
    effort: 'M',
    dueLabel: 'Due Fri',
    timeSpentMinutes: 95,
    timeLimitMinutes: 240,
    checklist: { done: 1, total: 4 },
  },

  /* ---- Blocked ---- */
  {
    id: 't04',
    reference: 'CLI-091',
    title: 'Eid sale campaign — Meta + TikTok setup',
    projectName: 'ABC Traders — Retainer',
    projectType: 'client',
    assignee: 'Yusra Khan',
    createdBy: 'Sana Minhas',
    status: 'blocked',
    priority: 'urgent',
    effort: 'L',
    dueLabel: 'Due Wed',
    timeSpentMinutes: 300,
    timeLimitMinutes: 480,
    blockedReason: 'Waiting on final creative approval from the client',
    commentCount: 6,
  },
  {
    id: 't05',
    reference: 'EVT-149',
    title: 'Book the LED wall vendor',
    projectName: 'Expo Karachi — Oct 2026',
    projectType: 'event',
    assignee: 'Farhan Malik',
    createdBy: 'Sana Minhas',
    status: 'blocked',
    priority: 'high',
    effort: 'S',
    dueLabel: 'Due Thu',
    timeSpentMinutes: 45,
    timeLimitMinutes: 120,
    blockedReason: 'Budget sign-off pending',
    commentCount: 2,
  },

  /* ---- In review ---- */
  {
    id: 't06',
    reference: 'CLI-088',
    title: 'ABC Traders — product launch video',
    projectName: 'ABC Traders — Retainer',
    projectType: 'client',
    assignee: 'Kashif Ahmed',
    createdBy: 'Sana Minhas',
    status: 'in_review',
    priority: 'high',
    effort: 'L',
    dueLabel: 'Due Fri',
    timeSpentMinutes: 550,
    timeLimitMinutes: 480,
    commentCount: 3,
    attachmentCount: 2,
  },
  {
    id: 't07',
    reference: 'PRM-021',
    title: 'Instagram grid redesign — 9 tiles',
    projectName: 'CNI Self-Promotion',
    projectType: 'self_promotion',
    assignee: 'Ayesha Siddiqui',
    createdBy: 'Sana Minhas',
    status: 'in_review',
    priority: 'medium',
    effort: 'M',
    dueLabel: 'Due Mon',
    timeSpentMinutes: 210,
    timeLimitMinutes: 240,
    attachmentCount: 9,
  },

  /* ---- Revisions ---- */
  {
    id: 't08',
    reference: 'PRM-017',
    title: 'CNI YouTube channel — October slate',
    projectName: 'CNI Self-Promotion',
    projectType: 'self_promotion',
    assignee: 'Farhan Malik',
    createdBy: 'Sana Minhas',
    status: 'revisions',
    priority: 'medium',
    effort: 'M',
    dueLabel: 'Due Mon',
    timeSpentMinutes: 140,
    timeLimitMinutes: 240,
    commentCount: 5,
  },

  /* ---- To do ---- */
  {
    id: 't09',
    reference: 'CLI-084',
    title: 'Monthly performance report — September',
    projectName: 'XYZ Foods — Brand',
    projectType: 'client',
    assignee: 'Yusra Khan',
    createdBy: 'Sana Minhas',
    status: 'todo',
    priority: 'medium',
    effort: 'S',
    dueLabel: '2 days late',
    overdue: true,
    timeSpentMinutes: 0,
    timeLimitMinutes: 120,
  },
  {
    id: 't10',
    reference: 'EVT-151',
    title: 'Export deliverables in 3 aspect ratios',
    projectName: 'Expo Karachi — Oct 2026',
    projectType: 'event',
    assignee: 'Kashif Ahmed',
    createdBy: 'Sana Minhas',
    status: 'todo',
    priority: 'high',
    effort: 'S',
    dueLabel: 'Due Thu',
    timeSpentMinutes: 0,
    timeLimitMinutes: 120,
  },
  {
    id: 't11',
    reference: 'CLI-093',
    title: 'XYZ Foods — packaging mockups round 2',
    projectName: 'XYZ Foods — Brand',
    projectType: 'client',
    assignee: 'Ayesha Siddiqui',
    createdBy: 'Sana Minhas',
    status: 'todo',
    priority: 'urgent',
    effort: 'L',
    dueLabel: 'Due tomorrow',
    timeSpentMinutes: 0,
    timeLimitMinutes: 480,
  },
  {
    id: 't12',
    reference: 'BIZ-035',
    title: 'Draft the Q4 capability deck',
    projectName: 'CNI Website Refresh',
    projectType: 'business',
    assignee: 'Danish Raza',
    createdBy: 'Danish Raza',
    status: 'todo',
    priority: 'low',
    effort: 'M',
    dueLabel: 'Due next week',
    timeSpentMinutes: 0,
    timeLimitMinutes: 240,
  },

  /* ---- Backlog ---- */
  {
    id: 't13',
    reference: 'BIZ-040',
    title: 'Case study template — reusable layout',
    projectName: 'CNI Website Refresh',
    projectType: 'business',
    assignee: 'Ayesha Siddiqui',
    createdBy: 'Sana Minhas',
    status: 'backlog',
    priority: 'low',
    effort: 'M',
    dueLabel: 'No due date',
    timeSpentMinutes: 0,
    timeLimitMinutes: 240,
  },
  {
    id: 't14',
    reference: 'PRM-024',
    title: 'Behind-the-scenes vlog series — pilot',
    projectName: 'CNI Self-Promotion',
    projectType: 'self_promotion',
    assignee: 'Emaan Tariq',
    createdBy: 'Emaan Tariq',
    status: 'backlog',
    priority: 'low',
    effort: 'XL',
    dueLabel: 'No due date',
    timeSpentMinutes: 0,
    timeLimitMinutes: 960,
  },

  /* ---- Done ---- */
  {
    id: 't15',
    reference: 'EVT-139',
    title: 'Stand graphics — final print files',
    projectName: 'Expo Karachi — Oct 2026',
    projectType: 'event',
    assignee: 'Ayesha Siddiqui',
    createdBy: 'Sana Minhas',
    status: 'done',
    priority: 'high',
    effort: 'M',
    dueLabel: 'Completed Wed',
    timeSpentMinutes: 225,
    timeLimitMinutes: 240,
    attachmentCount: 4,
  },
  {
    id: 't16',
    reference: 'CLI-081',
    title: 'ABC Traders — August ad creatives',
    projectName: 'ABC Traders — Retainer',
    projectType: 'client',
    assignee: 'Yusra Khan',
    createdBy: 'Sana Minhas',
    status: 'done',
    priority: 'medium',
    effort: 'L',
    dueLabel: 'Completed Tue',
    timeSpentMinutes: 460,
    timeLimitMinutes: 480,
  },
  {
    id: 't17',
    reference: 'BIZ-029',
    title: 'Set up the shared asset library',
    projectName: 'CNI Website Refresh',
    projectType: 'business',
    assignee: 'Emaan Tariq',
    createdBy: 'Sana Minhas',
    status: 'done',
    priority: 'low',
    effort: 'S',
    dueLabel: 'Completed Mon',
    timeSpentMinutes: 110,
    timeLimitMinutes: 120,
  },

  /* ---- Cancelled ---- */
  {
    id: 't18',
    reference: 'OTH-198',
    title: 'Reprint last year’s expo flyers',
    projectName: 'Misc / Ad-hoc',
    projectType: 'other',
    assignee: 'Farhan Malik',
    createdBy: 'Farhan Malik',
    status: 'cancelled',
    priority: 'low',
    effort: 'XS',
    dueLabel: 'Cancelled',
    timeSpentMinutes: 0,
    timeLimitMinutes: 60,
  },
];

export interface PreviewActivity {
  id: string;
  actor: string;
  action: string;
  target: string;
  when: string;
}

export const PREVIEW_ACTIVITY: readonly PreviewActivity[] = [
  { id: 'a1', actor: 'Yusra Khan', action: 'moved to Blocked', target: 'CLI-091', when: '2m ago' },
  { id: 'a2', actor: 'Kashif Ahmed', action: 'submitted for review', target: 'CLI-088', when: '18m ago' },
  { id: 'a3', actor: 'Sana Minhas', action: 'assigned', target: 'EVT-147', when: '41m ago' },
  { id: 'a4', actor: 'Ayesha Siddiqui', action: 'completed', target: 'EVT-139', when: '1h ago' },
  { id: 'a5', actor: 'Danish Raza', action: 'requested +2h on', target: 'PRM-017', when: '2h ago' },
];

/* Derived from PREVIEW_TASKS, not hand-written.
 *
 * These used to be a separate literal list, which meant the dashboard's status
 * counts and the task board could disagree — and the first thing anyone checks
 * on a new dashboard is whether the numbers add up. Deriving them makes that
 * impossible. Ordered by STATUS_META.sortOrder so the segmented bar always runs
 * Backlog → Cancelled rather than in whatever order the tasks happen to sit. */
export const PREVIEW_STATUS_COUNTS: ReadonlyArray<{ status: TaskStatus; count: number }> = (
  Object.keys(STATUS_META) as TaskStatus[]
)
  .map((status) => ({
    status,
    count: PREVIEW_TASKS.filter((t) => t.status === status).length,
  }))
  .filter((entry) => entry.count > 0)
  .sort((a, b) => STATUS_META[a.status].sortOrder - STATUS_META[b.status].sortOrder);

/** Statuses that represent live work — excludes done and cancelled. */
export const PREVIEW_OPEN_STATUS_COUNTS = PREVIEW_STATUS_COUNTS.filter(
  (entry) => !['done', 'cancelled'].includes(STATUS_META[entry.status].category),
);

/* ----------------------------------------------------------------------------
 * Trend series for the KPI sparklines — the last 8 working days, oldest first.
 *
 * Hand-shaped rather than random, for two reasons: a sparkline built from
 * Math.random() changes on every render and would defeat the point of a stable
 * preview, and `lib/domain` bans non-determinism anyway (doc 20 §5). These also
 * agree with the headline figures they sit under, so the card is internally
 * consistent instead of decorative.
 * ------------------------------------------------------------------------- */

export const PREVIEW_TRENDS = {
  openTasks: [21, 24, 23, 26, 25, 28, 27, 29],
  completed: [7, 9, 8, 11, 10, 9, 12, 12],
  overLimit: [1, 1, 2, 2, 1, 3, 2, 3],
  utilisation: [58, 62, 61, 66, 70, 69, 73, 76],
} as const;
