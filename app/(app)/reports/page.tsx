import { BarChart3 } from 'lucide-react';
import type { Metadata } from 'next';

import { PhasePlaceholder } from '@/components/layout/phase-placeholder';

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <PhasePlaceholder
      icon={BarChart3}
      title={"Reports"}
      subtitle={"Throughput, accuracy and cost"}
      phase={"Phase 5 · Dashboards"}
      summary={"On-time rate, cycle time, revision rate, and estimate accuracy per person and per skill. If video tasks are extended 60% of the time, that is a statement about the estimates, not about the editor."}
      features={[
        "Completion and on-time rate",
        "Estimate accuracy and extension patterns",
        "Capacity consumed per client and project",
        "Skill gap reporting from real task data",
      ]}
      docRef={"docs/17 §8 · FR-088, FR-193"}
    />
  );
}
