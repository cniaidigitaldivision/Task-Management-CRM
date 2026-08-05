import { Gauge } from 'lucide-react';
import type { Metadata } from 'next';

import { PhasePlaceholder } from '@/components/layout/phase-placeholder';

export const metadata: Metadata = { title: "Workload" };

export default function WorkloadPage() {
  return (
    <PhasePlaceholder
      icon={Gauge}
      title={"Workload"}
      subtitle={"Capacity, thresholds and rebalancing"}
      phase={"Phase 4 · Intelligence"}
      summary={"Load measured in weighted points, never raw task count — ten quick reposts are not busier than two campaign builds. Warns at 85%, blocks at 100%, and an override has to be typed and is logged."}
      features={[
        "Per-member bars against a 36-point week",
        "Soft warning and hard block thresholds",
        "Rebalance Advisor with one-click moves",
        "Leave and holidays reduce capacity",
      ]}
      docRef={"docs/06 · FR-060 to FR-066"}
    />
  );
}
