import type { Metadata } from 'next';

import { WorkflowWorkspace } from '@/components/workflow/workflow-workspace';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth/current-user';
import { getChain, listChains } from '@/lib/db/queries/handoff';
import { listSkills } from '@/lib/db/queries/people';

export const metadata: Metadata = { title: 'Workflow' };

/* ============================================================================
 * WORKFLOW — handoff chains. doc 12 E-004, owner rule R4a.
 * ----------------------------------------------------------------------------
 * *"Kashif finishes the reel → the system creates 'Schedule reel across Meta +
 *  TikTok' and assigns it to Yusra using the smart engine."*
 *
 * ── WHAT THIS SCREEN IS NOT ──────────────────────────────────────────────────
 * The reference this canvas is modelled on is a job scheduler: its nodes are
 * Shell Script, HTTP Request and Web Hook. R4a's reversal of R4 was granted for
 * the LOOK of that editor over E-004's behaviour, and the carve-out is a
 * security boundary — arbitrary code execution and outbound SSRF have no place
 * in a system built on row-level security and an encrypted vault.
 *
 * A node here creates a task. Migration 026 has no column in which anything else
 * could be stored, and that is deliberate rather than incidental.
 *
 * Admin+ only, enforced in `layout.tsx` above the Suspense boundary as well as
 * by the policies in migration 026.
 * ========================================================================= */

export default async function WorkflowPage({
  searchParams,
}: {
  searchParams: Promise<{ chain?: string }>;
}) {
  const user = await requireRole('admin');
  const { chain: selectedId } = await searchParams;

  const [chains, skills] = await Promise.all([
    listChains(user.id),
    listSkills(user.id),
  ]);

  /* The selected chain comes down with the page rather than being fetched on
     the client. Opening a chain is a navigation, so the canvas already has its
     nodes on first paint instead of flashing empty and filling in. */
  const open = selectedId ? await getChain(user.id, selectedId) : null;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-6">
      <PageHeader
        eyebrow="System"
        title="Workflow"
        description="When a task is finished, the next one can be created and assigned automatically. A chain belongs to a project type, and only one chain per type can be live at a time."
      />
      <WorkflowWorkspace
        chains={chains}
        skills={skills.map((s) => ({ id: s.id, label: s.label }))}
        openChain={open}
      />
    </div>
  );
}
