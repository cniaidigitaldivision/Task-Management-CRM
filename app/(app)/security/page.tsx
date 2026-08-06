import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';

import { PhasePlaceholder } from '@/components/layout/phase-placeholder';

export const metadata: Metadata = { title: "Security" };

export default function SecurityPage() {
  return (
    <PhasePlaceholder
      icon={ShieldCheck}
      title={"Security"}
      subtitle={"Super Admin only"}
      phase={"Phase 1 · Steps 4 and 5"}
      summary={"Active sessions, recent sign-ins, anomaly alerts and the append-only audit log. The Super Admin account cannot be edited, demoted or deleted by anyone else — enforced by a database trigger, not just by hiding buttons."}
      features={[
        "Active sessions with instant revoke",
        "Login and anomaly alerting",
        "Append-only audit log",
        "Break-glass recovery status",
      ]}
      docRef={"docs/16 · FR-140 to FR-159"}
    />
  );
}
