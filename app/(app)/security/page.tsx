import type { Metadata } from 'next';
import { KeyRound, Lock, ShieldAlert, ShieldCheck } from 'lucide-react';

import { breakGlassStatus } from '@/app/actions/security';
import { SecurityWorkspace } from '@/components/security/security-workspace';
import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { StatCard } from '@/components/ui/metric';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth/current-user';
import {
  listAuditLog,
  listLockedAccounts,
  listLoginAttempts,
  listMySessions,
  listSecurityEvents,
} from '@/lib/db/queries/audit';
import { can } from '@/lib/domain/permissions';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Security' };

/* ============================================================================
 * SECURITY — doc 16 §10, FR-153, FR-154
 * ----------------------------------------------------------------------------
 * The last placeholder screen, and the one that made the audit trail worth
 * writing. Before this, `audit_log` had a single row — the Super Admin's own
 * creation — because every privileged action was writing to the human feed and
 * nothing was writing the trail. A viewer alone would have shown an empty table
 * and looked like the feature existed.
 *
 * ── Q-054 IS ENFORCED BY POLICY, NOT BY THIS PAGE ────────────────────────────
 * "An Admin sees the audit log, own scope" was ambiguous until it was settled
 * as: an Admin reads everything EXCEPT entries whose actor was the Super Admin.
 * `audit_log_select` implements exactly that. Nothing here filters by role, and
 * the absence is the point — a second implementation of an access rule is a
 * second place for it to be wrong.
 *
 * Same for the alert stream: `security_events_select` is Super Admin only, so an
 * Admin loading this page simply receives an empty list and the section does not
 * render. No branch required.
 * ========================================================================= */

export default async function SecurityPage() {
  /* Admin and above since 2026-08-22 — owner decision, see the note beside
     `security_dashboard.view` in lib/domain/permissions.ts. Hiding the nav item
     is convenience, not security (NFR-006) — registry C-21, which is why the
     rank is asserted here and in layout.tsx rather than in the nav alone. */
  const user = await requireRole('admin');

  const [sessions, attempts, auditLog, events, lockedAccounts, breakGlass] = await Promise.all([
    listMySessions(user.id, user.sessionId),
    listLoginAttempts(user.id, 60),
    listAuditLog(user.id, { limit: 100 }),
    listSecurityEvents(user.id, 40),
    listLockedAccounts(user.id),
    breakGlassStatus(),
  ]);

  const canUnlock = can({ role: user.role, id: user.id }, 'user.force_password_reset');

  const now = nowMs();
  const failedRecently = attempts.filter(
    (a) => a.outcome !== 'success' && now - new Date(a.createdAt).getTime() < 86_400_000,
  ).length;
  const criticals = events.filter((e) => e.severity === 'critical').length;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-8">
      <PageHeader
        eyebrow="Super Admin only"
        title="Security"
        description={
          <>
            Sessions, sign-in history and the record of every privileged action. Nothing on this
            page can be edited or deleted by anybody — the log tables are append-only by database
            trigger, not by convention, so a REVOKE that cannot bind a table owner is not what is
            relied on.
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={ShieldCheck}
          token="accent-primary"
          label="Your active sessions"
          value={sessions.length}
          hint="Each bound to its own device"
        />
        <StatCard
          icon={ShieldAlert}
          token={failedRecently > 0 ? 'load-warning' : 'load-healthy'}
          label="Failed sign-ins today"
          value={failedRecently}
          hint={failedRecently > 0 ? 'Three in a row locks an account' : 'Nothing unusual'}
        />
        <StatCard
          icon={Lock}
          token={lockedAccounts.length > 0 ? 'feedback-error' : 'feedback-success'}
          label="Locked accounts"
          value={lockedAccounts.length}
          hint={lockedAccounts.length > 0 ? 'Waiting to be released' : 'Nobody is locked out'}
        />
        <StatCard
          icon={KeyRound}
          token={criticals > 0 ? 'feedback-error' : 'feedback-success'}
          label="Critical events"
          value={criticals}
          hint={criticals > 0 ? 'Worth reading below' : 'None recorded'}
        />
      </div>

      <SecurityWorkspace
        sessions={sessions}
        attempts={attempts}
        auditLog={auditLog}
        events={events}
        lockedAccounts={lockedAccounts}
        canUnlock={canUnlock}
        now={now}
      />

      {/* ---- Break-glass (doc 16 §6) ---- */}
      <Card>
        <CardBody className="flex flex-wrap items-start gap-3 p-5">
          <IconTile
            icon={breakGlass.used ? ShieldAlert : Lock}
            token={breakGlass.used ? 'feedback-error' : 'accent-gold'}
            size="lg"
          />
          <div className="min-w-[16rem] flex-1">
            <p className="text-body-sm font-semibold text-text-primary">
              Break-glass recovery
              {breakGlass.used && (
                <span style={{ color: 'var(--feedback-error)' }}> — has been used</span>
              )}
            </p>
            <p className="mt-1 text-caption text-text-secondary">{breakGlass.note}</p>
            <p className="mt-1.5 text-micro text-text-tertiary">
              It exists so that &ldquo;the Super Admin cannot be altered by anybody&rdquo; does not
              quietly come to mean &ldquo;unrecoverable&rdquo;. Nothing in the application calls it;
              reaching it takes a deliberate, greppable path and every use writes a critical event
              that commits even if the surrounding transaction is rolled back.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
