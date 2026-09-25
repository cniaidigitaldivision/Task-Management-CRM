import { requireNotExecutive } from '@/lib/auth/current-user';

/* The Composer is a client component with no server guard of its own, so this
   layout is the only place a floor can go.

   Owner, 2026-09-25: *"just hide this composer from him because it didn't
   complete."* Hiding the sidebar link left the page answering 200 to a typed
   URL, which a walkthrough as a real Executive found. */
export default async function ComposerLayout({ children }: { children: React.ReactNode }) {
  await requireNotExecutive();
  return children;
}
