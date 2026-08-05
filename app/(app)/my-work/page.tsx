import { ListChecks } from 'lucide-react';
import type { Metadata } from 'next';

import { PhasePlaceholder } from '@/components/layout/phase-placeholder';

export const metadata: Metadata = { title: "My Work" };

export default function MyWorkPage() {
  return (
    <PhasePlaceholder
      icon={ListChecks}
      title={"My Work"}
      subtitle={"Your day, in one screen"}
      phase={"Phase 2 · Core tasks"}
      summary={"The default landing page for every member — overdue first, then due today, this week, awaiting review, and anything that came back for revision. Status changes in one click, because anything slower and people revert to WhatsApp."}
      features={[
        "Overdue, Today, This week, In review",
        "One-click status change from the list",
        "Live timer against each task limit",
        "Personal load against your 36-point week",
      ]}
      docRef={"docs/10 §2 · FR-080"}
    />
  );
}
