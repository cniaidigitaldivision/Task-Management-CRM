import { UserCog } from 'lucide-react';
import type { Metadata } from 'next';

import { PhasePlaceholder } from '@/components/layout/phase-placeholder';

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <PhasePlaceholder
      icon={UserCog}
      title={"Profile"}
      subtitle={"Your account and appearance"}
      phase={"Phase 1 · Step 6"}
      summary={"Your details, your skills, your notification preferences — and the theme switch, which is available to every role including members. Theme preference is stored on your account and follows you across devices."}
      features={[
        "Light, dark or match my device",
        "Your own skills and capacity",
        "Notification preferences per channel",
        "Active sessions with self-revoke",
      ]}
      docRef={"docs/18 §6 · FR-201, FR-202"}
    />
  );
}
