import { Users } from 'lucide-react';
import type { Metadata } from 'next';

import { PhasePlaceholder } from '@/components/layout/phase-placeholder';

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <PhasePlaceholder
      icon={Users}
      title={"Team"}
      subtitle={"Members, skills and capacity"}
      phase={"Phase 1 · Step 6"}
      summary={"The system ships with no team data at all — the Admin builds it here. Name, email, role, job title, skills with proficiency, weekly capacity. Adding member number eight is a 60-second form, never a code change."}
      features={[
        "Invite by email, no password ever sent",
        "Skills with proficiency 1 to 5",
        "Per-member capacity and concurrent limits",
        "Member Activity Preview by project type",
      ]}
      docRef={"docs/03 · ADR-009 · FR-010 to FR-017"}
    />
  );
}
