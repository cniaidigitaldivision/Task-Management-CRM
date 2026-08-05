import { Settings } from 'lucide-react';
import type { Metadata } from 'next';

import { PhasePlaceholder } from '@/components/layout/phase-placeholder';

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <PhasePlaceholder
      icon={Settings}
      title={"Settings"}
      subtitle={"Thresholds, skills, workflow and notifications"}
      phase={"Phase 5 · Dashboards"}
      summary={"Everything you might want to tune lives here, editable without a developer — capacity thresholds, scoring weights, the status workflow, the skills library, and notification defaults."}
      features={[
        "Capacity thresholds and workload window",
        "Assignment scoring weights (must total 1.00)",
        "Skills library and status workflow",
        "Notification defaults and quiet hours",
      ]}
      docRef={"docs/10 §9 · docs/19 §5"}
    />
  );
}
