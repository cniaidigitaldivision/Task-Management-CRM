import type { Metadata } from 'next';

import { DocumentsWorkspace } from '@/components/documents/documents-workspace';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/current-user';
import { getDriveSync, listDocuments, listDraftProjects } from '@/lib/db/queries/documents';
import { listProjects } from '@/lib/db/queries/projects';
import { can } from '@/lib/domain/permissions';
import { describeDrive } from '@/lib/drive/client';

export const metadata: Metadata = { title: 'Documents' };

/* ============================================================================
 * DOCUMENTS — owner request 2026-08-13
 * ----------------------------------------------------------------------------
 * The register of what is in the company Google Drive, and the queue of uploads
 * waiting to go into it.
 *
 * ── OPEN TO EVERY ROLE, BECAUSE ANYBODY MAY UPLOAD ───────────────────────────
 * Owner: *"every time a user or anybody comes, they should have a place where they
 * can upload something."* So the screen is open and row-level security decides
 * what is on it: Admin+ sees the whole register, anybody sees their own uploads and
 * documents on projects they can see (`app.can_read_document`, migration 025).
 *
 * A Member therefore lands on a page that is mostly their own uploads — which is
 * the honest version of "a place where they can upload something".
 * ========================================================================= */

export default async function DocumentsPage() {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  const canConfigure = can(actor, 'drive.configure');
  const drive = describeDrive();

  const [documents, projects, sync, drafts] = await Promise.all([
    listDocuments(user.id),
    listProjects(user.id),
    /* Both are Admin+ by policy, so they are only read for somebody who may see
       them — an RLS refusal would come back empty anyway, but asking for data the
       page will not render is a query for nothing. */
    canConfigure ? getDriveSync(user.id) : Promise.resolve(null),
    canConfigure ? listDraftProjects(user.id) : Promise.resolve([]),
  ]);

  const pending = documents.filter((d) => d.state === 'pending').length;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-6">
      <PageHeader
        eyebrow="AI & Digital Division"
        title="Documents"
        description={
          <>
            Anybody can upload; an{' '}
            <span className="font-semibold text-text-primary">Admin approves</span> before anything
            reaches the company Google Drive. Nothing is sent until then — a refused file never
            arrives there at all.
            {pending > 0 && (
              <>
                {' '}
                <span className="font-semibold" style={{ color: 'var(--feedback-warning)' }}>
                  {pending} waiting.
                </span>
              </>
            )}
          </>
        }
      />

      <DocumentsWorkspace
        documents={documents}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        canApprove={can(actor, 'document.approve')}
        canManage={can(actor, 'document.manage')}
        canConfigure={canConfigure}
        drive={{
          configured: drive.configured,
          /* The service-account address is shown so somebody knows what to share
             a folder WITH. Only to those who can configure it — it is not a
             secret, but it is not everybody's business either. */
          account: canConfigure ? drive.account : null,
          sync,
          drafts,
        }}
      />
    </div>
  );
}
