import { CalendarClock } from 'lucide-react';
import type { Metadata } from 'next';

import { PhasePlaceholder } from '@/components/layout/phase-placeholder';

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage() {
  return (
    <PhasePlaceholder
      icon={CalendarClock}
      title={"Tasks"}
      subtitle={"List, board and calendar"}
      phase={"Phase 2 · Core tasks"}
      summary={"Every task across the team, in whichever view suits the question. Eight statuses with a real review and revision loop, because creative work rarely finishes on the first pass."}
      features={[
        "List view with filter and sort",
        "Board view with drag-and-drop",
        "Calendar by due date",
        "Task detail with comments and files",
      ]}
      docRef={"docs/05 · FR-081, FR-082"}
    />
  );
}
