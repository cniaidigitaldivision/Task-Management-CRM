import { Download, Plus } from 'lucide-react';

import { AppShell } from '@/components/layout/app-shell';
import { TasksWorkspace } from '@/components/task/tasks-workspace';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { PREVIEW_TASKS } from '@/lib/preview-data';

/* ============================================================================
 * TASKS — doc 10 §3 · FR-081 (list, filter, sort) · FR-082 (board)
 * ----------------------------------------------------------------------------
 * Pulled forward from Phase 2 at the owner's request (Session 08), the same way
 * the app shell was pulled forward in Session 06: this is where the team will
 * spend its day, so it is the screen worth getting in front of them early.
 *
 * The page stays a Server Component and hands the interactive parts to
 * <TasksWorkspace/>. `role` and `userName` are placeholders until the session
 * exists (Step 4) — the shape is already right, so wiring the real session is a
 * substitution rather than a rewrite.
 * ========================================================================= */

const CURRENT_USER = 'Sana Minhas';

export default function TasksPage() {
  const open = PREVIEW_TASKS.filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled',
  ).length;
  const overdue = PREVIEW_TASKS.filter((t) => t.overdue).length;

  return (
    <AppShell
      role="admin"
      userName={CURRENT_USER}
      title="Tasks"
      subtitle="Every task across the team"
    >
      <div className="mx-auto max-w-[var(--content-max)] space-y-5">
        <PageHeader
          eyebrow="All work"
          title="Tasks"
          description={
            <>
              {open} open across {new Set(PREVIEW_TASKS.map((t) => t.projectName)).size} projects
              {overdue > 0 && (
                <>
                  {' · '}
                  <span className="font-semibold text-text-primary">{overdue} overdue</span>
                </>
              )}
              . Switch between list and board, group and filter, and drag cards to change status.
            </>
          }
          actions={
            <>
              <Button variant="secondary" size="md">
                <Download className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                Export
              </Button>
              <Button variant="primary" size="md">
                <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                New task
              </Button>
            </>
          }
        />

        <TasksWorkspace
          initialTasks={PREVIEW_TASKS}
          currentUser={CURRENT_USER}
          currentRole="admin"
        />
      </div>
    </AppShell>
  );
}
