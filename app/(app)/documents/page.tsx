import type { Metadata } from 'next';

import { DocumentsWorkspace } from '@/components/documents/documents-workspace';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/current-user';
import { getDriveSync, listDocuments, listDraftProjects } from '@/lib/db/queries/documents';
import { connectionStatus } from '@/lib/db/queries/drive';
import { listFolders } from '@/lib/db/queries/drive-folders';
import { listLibraryDocuments } from '@/lib/db/queries/library';
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

/* What the OAuth callback can say when it sends somebody back here. Written out
   rather than echoed, because the value arrives in a URL anybody can edit and an
   echoed query parameter is a content-injection hole. */
const DRIVE_OUTCOME: Record<string, { tone: 'ok' | 'warn'; text: string }> = {
  connected: { tone: 'ok', text: 'Google Drive is connected.' },
  cancelled: { tone: 'warn', text: 'Google Drive was not connected — the consent screen was cancelled.' },
  disconnected: { tone: 'ok', text: 'Google Drive has been disconnected. Files already filed there are untouched.' },
  not_configured: { tone: 'warn', text: 'No Google OAuth client is configured yet, so there was nothing to connect to.' },
  state_mismatch: { tone: 'warn', text: 'That sign-in could not be verified as one started here, so it was refused. Try Connect again.' },
  failed: { tone: 'warn', text: 'Google refused the connection. Try again, and check the redirect URI is registered.' },
};

/**
 * Green when Drive is connected, red when it is not.
 *
 * A pill rather than a button: pressing it would have to mean either "connect" or
 * "disconnect" depending on state, and a control that does opposite things in the
 * same place is how somebody disconnects the division's Drive by muscle memory.
 * Connecting lives in Drive settings, one tab away, where the consequence is
 * spelled out.
 */
function DriveStatusPill({ connected }: { connected: boolean }) {
  const token = connected ? 'feedback-success' : 'feedback-error';
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-caption font-semibold"
      style={{
        borderColor: `color-mix(in oklab, var(--${token}) 45%, transparent)`,
        backgroundColor: `color-mix(in oklab, var(--${token}) 12%, transparent)`,
        color: `var(--${token})`,
      }}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: `var(--${token})` }}
      />
      {connected ? 'Google Drive connected' : 'Google Drive not connected'}
    </span>
  );
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ drive?: string }>;
}) {
  const params = await searchParams;
  const outcome = params.drive ? (DRIVE_OUTCOME[params.drive] ?? null) : null;

  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  const canConfigure = can(actor, 'drive.configure');
  const canShare = can(actor, 'document.share');
  const drive = describeDrive();

  const [documents, projects, sync, drafts, connection, folders, library] = await Promise.all([
    listDocuments(user.id),
    listProjects(user.id),
    /* Both are Admin+ by policy, so they are only read for somebody who may see
       them — an RLS refusal would come back empty anyway, but asking for data the
       page will not render is a query for nothing. */
    canConfigure ? getDriveSync(user.id) : Promise.resolve(null),
    canConfigure ? listDraftProjects(user.id) : Promise.resolve([]),
    /* Not gated on `canConfigure` like the two above: `connectionStatus` reads
       three harmless columns and deliberately cannot reach the token, so there
       is nothing to withhold. What is withheld is done below, at the props. */
    connectionStatus(),
    /* Read for every role. The registry's select policy is "anybody signed in",
       deliberately: a Member has to be able to see the folder to understand why
       a document is visible to them, and to pick one to upload into. What a
       Member may DO with it is decided by `canShare` below. */
    listFolders(user.id),
    /* The company's own material. Read for every role — the whole point is that
       anybody can find the rate card. */
    listLibraryDocuments(user.id),
  ]);

  const pending = documents.filter((d) => d.state === 'pending').length;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-6">
      <PageHeader
        eyebrow="AI & Digital Division"
        title="Documents"
        /* ── THE CONNECTION STATE BELONGS BESIDE THE TITLE ───────────────────
           Owner, 2026-08-18: *"the connector button should be at the top with the
           documentation heading on the right side… green when it is connected to a
           drive, and turn to red when it's not."*

           Right, and it was buried in a card halfway down the page. It is the one
           fact that decides whether anything else on this screen can work, so it
           reads at a glance now.

           ⚠️ Colour is not the only signal: the text says "connected" or "not
           connected" too. Red-versus-green alone fails for the ~8% of men with
           red-green colour blindness, and this is the status they most need. */
        actions={<DriveStatusPill connected={drive.configured && connection.connected} />}
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

      {outcome && (
        <p
          role="status"
          className="rounded-lg border px-3.5 py-2.5 text-body-sm"
          style={{
            borderColor: `color-mix(in oklab, var(--feedback-${
              outcome.tone === 'ok' ? 'success' : 'warning'
            }) 40%, transparent)`,
            background: `color-mix(in oklab, var(--feedback-${
              outcome.tone === 'ok' ? 'success' : 'warning'
            }) 10%, transparent)`,
            color: 'var(--text-primary)',
          }}
        >
          {outcome.text}
        </p>
      )}

      <DocumentsWorkspace
        documents={documents}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        canApprove={can(actor, 'document.approve')}
        canManage={can(actor, 'document.manage')}
        canConfigure={canConfigure}
        canShare={canShare}
        folders={folders}
        library={library}
        drive={{
          configured: drive.configured,
          connected: connection.connected,
          /* The connected address is shown so somebody knows WHOSE Drive this
             is. Only to those who can configure it — it is not a secret, but it
             is not everybody's business either. */
          account: canConfigure ? connection.accountEmail : null,
          /* Likewise the last failure: it can quote Google verbatim, and Google
             is not careful about what it puts in an error string. */
          lastError: canConfigure ? connection.lastError : null,
          /* ── FORMATTED HERE, IN A SERVER COMPONENT, ON PURPOSE ─────────────
             `lib/now.ts` states the rule: date labels are computed on the server
             and shipped as strings. The client component used to call
             `toLocaleString()` itself, which Node rendered as "17:12:09" and the
             browser as "5:12:09 pm" — a hydration mismatch, and a visible error.

             The locale is pinned rather than left to the runtime, so the string
             does not change with whatever ICU data the host happens to carry. */
          lastCheckedLabel: sync?.lastCheckedAt
            ? `Last checked ${new Date(sync.lastCheckedAt).toLocaleString('en-GB', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Karachi',
              })} — ${sync.lastCreated} new.`
            : null,
          sync,
          drafts,
        }}
      />
    </div>
  );
}
