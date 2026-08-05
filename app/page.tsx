import { redirect } from 'next/navigation';

/**
 * The root lands on the dashboard.
 *
 * Once sessions exist (Step 4) this becomes role-aware: Admins and
 * Coordinators land on /dashboard, Members on /my-work — they have no access
 * to the dashboard at all (ADR-003).
 */
export default function RootPage() {
  redirect('/dashboard');
}
