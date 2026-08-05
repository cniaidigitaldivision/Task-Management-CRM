import { FolderKanban } from 'lucide-react';
import type { Metadata } from 'next';

import { PhasePlaceholder } from '@/components/layout/phase-placeholder';

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <PhasePlaceholder
      icon={FolderKanban}
      title={"Projects"}
      subtitle={"Event · Client · Business · Self-Promotion · Other"}
      phase={"Phase 2 · Projects"}
      summary={"Every task belongs to exactly one project. The type changes the form — events ask for a date and schedule backwards from it, clients track retainer hours. Anything filed under Other must say in writing what the work actually is."}
      features={[
        "Five project types with type-specific fields",
        "Backwards scheduling from an event date",
        "Retainer hours consumed per client",
        "The Other audit, catching unbilled work",
      ]}
      docRef={"docs/15 · FR-100 to FR-119"}
    />
  );
}
