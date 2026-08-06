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

import type { Priority, ProjectType, TaskStatus, WorkloadBand } from './domain/constants';

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
  reference: string;
  title: string;
  projectName: string;
  projectType: ProjectType;
  assignee: string;
  status: TaskStatus;
  priority: Priority;
  dueLabel: string;
  overdue?: boolean;
  timeSpentMinutes: number;
  timeLimitMinutes: number;
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

export const PREVIEW_TASKS: readonly PreviewTask[] = [
  {
    reference: 'EVT-142',
    title: 'Edit exhibition showreel — 30s vertical',
    projectName: 'Expo Karachi — Oct 2026',
    projectType: 'event',
    assignee: 'Kashif Ahmed',
    status: 'in_progress',
    priority: 'high',
    dueLabel: 'Due today',
    timeSpentMinutes: 192,
    timeLimitMinutes: 240,
  },
  {
    reference: 'CLI-088',
    title: 'ABC Traders — product launch video',
    projectName: 'ABC Traders — Retainer',
    projectType: 'client',
    assignee: 'Kashif Ahmed',
    status: 'in_review',
    priority: 'high',
    dueLabel: 'Due Fri',
    timeSpentMinutes: 550,
    timeLimitMinutes: 480,
  },
  {
    reference: 'CLI-091',
    title: 'Eid sale campaign — Meta + TikTok setup',
    projectName: 'ABC Traders — Retainer',
    projectType: 'client',
    assignee: 'Yusra Khan',
    status: 'blocked',
    priority: 'urgent',
    dueLabel: 'Due Wed',
    timeSpentMinutes: 300,
    timeLimitMinutes: 480,
  },
  {
    reference: 'CLI-084',
    title: 'Monthly performance report — September',
    projectName: 'XYZ Foods — Brand',
    projectType: 'client',
    assignee: 'Yusra Khan',
    status: 'todo',
    priority: 'medium',
    dueLabel: '2 days late',
    overdue: true,
    timeSpentMinutes: 0,
    timeLimitMinutes: 120,
  },
  {
    reference: 'OTH-205',
    title: 'Fix audio on last year’s wedding video',
    projectName: 'Misc / Ad-hoc',
    projectType: 'other',
    assignee: 'Kashif Ahmed',
    status: 'in_progress',
    priority: 'low',
    dueLabel: 'No due date',
    timeSpentMinutes: 390,
    timeLimitMinutes: 300,
  },
  {
    reference: 'PRM-017',
    title: 'CNI YouTube channel — October slate',
    projectName: 'CNI Self-Promotion',
    projectType: 'self_promotion',
    assignee: 'Farhan Malik',
    status: 'revisions',
    priority: 'medium',
    dueLabel: 'Due Mon',
    timeSpentMinutes: 140,
    timeLimitMinutes: 240,
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

export const PREVIEW_STATUS_COUNTS: ReadonlyArray<{ status: TaskStatus; count: number }> = [
  { status: 'todo', count: 6 },
  { status: 'in_progress', count: 5 },
  { status: 'in_review', count: 3 },
  { status: 'blocked', count: 2 },
  { status: 'revisions', count: 1 },
  { status: 'done', count: 12 },
];

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
