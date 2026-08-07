'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LogOut,
  Monitor,
  Unlock,
} from 'lucide-react';

import {
  revokeOtherSessionsAction,
  revokeSessionAction,
  unlockAccountAction,
  type SecurityActionResult,
} from '@/app/actions/security';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardToolbar } from '@/components/ui/card';
import type { AuditRow, LoginAttemptRow, SecurityEventRow, SessionRow } from '@/lib/db/queries/audit';
import { cn } from '@/lib/utils';

/* ============================================================================
 * SECURITY — doc 16 §10, FR-153, FR-154
 * ----------------------------------------------------------------------------
 * ── ORDERED BY WHAT YOU CAME HERE TO DO ──────────────────────────────────────
 * Somebody opens this screen for one of two reasons: they think something is
 * wrong, or somebody is locked out. So: your sessions first (the thing you can
 * act on immediately), then locked accounts, then the evidence.
 *
 * The audit log is last on purpose. It is the most impressive-looking part and
 * the least urgent — nobody reads a hundred rows to answer "is somebody in my
 * account", they hit sign-out-everywhere and then read.
 * ========================================================================= */

/* `now` is passed in from the server rather than read here. A client render
   that calls Date.now() is impure — two renders disagree, and the server's
   "5m ago" becomes the client's "6m ago" as a hydration mismatch. One
   timestamp, taken once, keeps every relative time on the page consistent. */
function when(iso: string, now: number): string {
  if (!iso) return '—';
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

/** A user-agent string is unreadable; the useful part is small. */
function describeDevice(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && !/Chrome/.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : 'Unknown browser';
  const platform =
    /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'unknown platform';
  return `${browser} on ${platform}`;
}

const OUTCOME_TOKEN: Record<string, string> = {
  success: 'feedback-success',
  bad_password: 'feedback-error',
  bad_mfa: 'feedback-error',
  unknown_account: 'neutral-500',
  locked: 'feedback-warning',
};

export function SecurityWorkspace({
  sessions,
  attempts,
  auditLog,
  events,
  lockedAccounts,
  canUnlock,
  now,
}: {
  sessions: readonly SessionRow[];
  attempts: readonly LoginAttemptRow[];
  auditLog: readonly AuditRow[];
  events: readonly SecurityEventRow[];
  lockedAccounts: ReadonlyArray<{ id: string; fullName: string; email: string; lockedAt: string }>;
  canUnlock: boolean;
  /** The server's clock, so every relative time agrees. */
  now: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<SecurityActionResult | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const run = async (fn: () => Promise<SecurityActionResult>) => {
    setBusy(true);
    const result = await fn();
    setNote(result);
    if (result.ok) router.refresh();
    setBusy(false);
  };

  const otherSessions = sessions.filter((s) => !s.isCurrent).length;

  return (
    <div className="space-y-8">
      {note && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border px-4 py-3"
          style={
            note.ok
              ? {
                  borderColor: 'color-mix(in oklab, var(--feedback-success) 35%, transparent)',
                  backgroundColor:
                    'color-mix(in oklab, var(--feedback-success) var(--tint-soft), var(--bg-surface))',
                }
              : {
                  borderColor: 'color-mix(in oklab, var(--feedback-error) 35%, transparent)',
                  backgroundColor:
                    'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
                }
          }
        >
          {note.ok ? (
            <CheckCircle2
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-success)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
          ) : (
            <AlertTriangle
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-error)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
          )}
          <p className="text-caption text-text-primary">{note.note ?? note.error}</p>
        </div>
      )}

      {/* ── 1 · Your sessions ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-h3 text-text-primary">Where you are signed in</h2>
            <p className="text-caption text-text-secondary">
              Each session is bound to the device that created it — a copied cookie replayed
              elsewhere does not match and is not a session (FR-150).
            </p>
          </div>
          {otherSessions > 0 && (
            <Button
              variant="secondary"
              size="md"
              disabled={busy}
              onClick={() => void run(revokeOtherSessionsAction)}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogOut className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              )}
              Sign out {otherSessions} other {otherSessions === 1 ? 'device' : 'devices'}
            </Button>
          )}
        </div>

        <Card>
          <ul className="divide-y divide-border-subtle">
            {sessions.length === 0 && (
              <li className="px-5 py-6 text-caption text-text-tertiary">No active sessions.</li>
            )}
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <Monitor className="h-4 w-4 shrink-0 text-text-tertiary" strokeWidth={2} aria-hidden="true" />
                <div className="min-w-[12rem] flex-1">
                  <p className="text-caption font-semibold text-text-primary">
                    {describeDevice(session.userAgent)}
                    {session.isCurrent && (
                      <Badge token="feedback-success" size="sm" className="ml-2">
                        This device
                      </Badge>
                    )}
                  </p>
                  <p className="text-micro text-text-tertiary">
                    {[session.ipCountry, session.ipAddress].filter(Boolean).join(' · ') ||
                      'Location unknown'}
                    {' · active '}
                    {when(session.lastSeenAt, now)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(() => revokeSessionAction(session.id))}
                >
                  {session.isCurrent ? 'Sign out here' : 'Sign out'}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* ── 2 · Locked accounts ───────────────────────────────────────────── */}
      {canUnlock && (
        <section className="space-y-3">
          <div>
            <h2 className="text-h3 text-text-primary">Locked accounts</h2>
            <p className="text-caption text-text-secondary">
              Three failed sign-ins locks an account. Unlocking restores access and leaves the
              password alone — the usual cause is somebody&rsquo;s own typing.
            </p>
          </div>

          <Card>
            {lockedAccounts.length === 0 ? (
              <CardBody className="flex items-center gap-3 p-5">
                <CheckCircle2
                  className="h-5 w-5 shrink-0"
                  style={{ color: 'var(--feedback-success)' }}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <p className="text-caption text-text-secondary">Nobody is locked out.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {lockedAccounts.map((account) => (
                  <li key={account.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <div className="min-w-[12rem] flex-1">
                      <p className="text-caption font-semibold text-text-primary">
                        {account.fullName}
                      </p>
                      <p className="text-micro text-text-tertiary">
                        {account.email} · locked {when(account.lockedAt, now)}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void run(() => unlockAccountAction(account.id))}
                    >
                      <Unlock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                      Unlock
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      {/* ── 3 · Sign-in history ───────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-h3 text-text-primary">Sign-in attempts</h2>
          <p className="text-caption text-text-secondary">
            Every attempt, successful or not, including addresses that do not exist. Append-only —
            no role can edit or remove a row (doc 19 §6).
          </p>
        </div>

        <Card>
          <div className="max-h-[26rem] overflow-y-auto">
            <ul className="divide-y divide-border-subtle">
              {attempts.length === 0 && (
                <li className="px-5 py-6 text-caption text-text-tertiary">Nothing recorded yet.</li>
              )}
              {attempts.map((attempt) => (
                <li key={attempt.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                  <Badge token={OUTCOME_TOKEN[attempt.outcome] ?? 'neutral-500'} size="sm">
                    {attempt.outcome.replace(/_/g, ' ')}
                  </Badge>
                  <span className="min-w-[10rem] flex-1 truncate text-caption text-text-primary">
                    {attempt.userName ?? attempt.emailAttempted}
                  </span>
                  <span className="text-micro text-text-tertiary">
                    {[attempt.ipCountry, attempt.ipAddress].filter(Boolean).join(' · ') || '—'}
                  </span>
                  <span className="w-20 shrink-0 text-right text-micro text-text-tertiary">
                    {when(attempt.createdAt, now)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </section>

      {/* ── 4 · The audit trail ───────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-h3 text-text-primary">Audit trail</h2>
          <p className="text-caption text-text-secondary">
            Every privileged action, with what changed and who did it. The actor&rsquo;s role is
            stored on each row rather than looked up later, so a promotion cannot silently rewrite
            what the record says was true at the time.
          </p>
        </div>

        <Card>
          <div className="max-h-[34rem] overflow-y-auto">
            <ul className="divide-y divide-border-subtle">
              {auditLog.length === 0 && (
                <li className="px-5 py-6 text-caption text-text-tertiary">
                  Nothing yet. Role changes, deactivations, capacity overrides and forced resets all
                  land here.
                </li>
              )}
              {auditLog.map((entry) => {
                const open = expanded === entry.id;
                const hasDetail = Boolean(entry.before || entry.after || entry.reason);
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : entry.id)}
                      disabled={!hasDetail}
                      className={cn(
                        'flex w-full flex-wrap items-center gap-3 px-5 py-2.5 text-left transition-colors',
                        hasDetail && 'hover:bg-bg-hover',
                        'focus-visible:outline-none',
                      )}
                    >
                      <Badge
                        token={entry.outcome === 'success' ? 'accent-primary' : 'feedback-error'}
                        size="sm"
                        variant="outline"
                      >
                        {entry.action}
                      </Badge>
                      <span className="min-w-[9rem] flex-1 truncate text-caption text-text-primary">
                        {entry.actorName ?? entry.actorEmail ?? 'Unknown'}
                        {entry.actorRole && (
                          <span className="text-text-tertiary"> · {entry.actorRole.replace('_', ' ')}</span>
                        )}
                      </span>
                      {entry.reason && (
                        <span className="max-w-[16rem] truncate text-micro" style={{ color: 'var(--accent-gold)' }}>
                          “{entry.reason}”
                        </span>
                      )}
                      <span className="w-20 shrink-0 text-right text-micro text-text-tertiary">
                        {when(entry.createdAt, now)}
                      </span>
                    </button>

                    {open && hasDetail && (
                      <div className="space-y-2 bg-bg-surface-sunken px-5 py-3">
                        {entry.reason && (
                          <p className="text-micro text-text-secondary">
                            <span className="font-semibold text-text-primary">Reason given:</span>{' '}
                            {entry.reason}
                          </p>
                        )}
                        <div className="grid gap-2 sm:grid-cols-2">
                          {([
                            ['Before', entry.before],
                            ['After', entry.after],
                          ] as ReadonlyArray<[string, unknown]>).map(([label, value]) =>
                            value ? (
                              <div key={label}>
                                <p className="text-micro font-semibold text-text-tertiary">{label}</p>
                                <pre className="overflow-x-auto rounded-md border border-border-subtle bg-bg-surface px-2 py-1.5 font-mono text-micro text-text-secondary">
                                  {JSON.stringify(value, null, 2)}
                                </pre>
                              </div>
                            ) : null,
                          )}
                        </div>
                        {entry.ipAddress && (
                          <p className="text-micro text-text-tertiary">From {entry.ipAddress}</p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      </section>

      {/* ── 5 · The alert stream — Super Admin only ───────────────────────── */}
      {events.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-h3 text-text-primary">Security events</h2>
            <p className="text-caption text-text-secondary">
              Kept apart from the audit trail on purpose, so the alert feed stays signal while the
              trail stays complete.
            </p>
          </div>

          <Card>
            <CardToolbar title={`${events.length} most recent`} />
            <ul className="divide-y divide-border-subtle">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                  <Badge
                    token={
                      event.severity === 'critical'
                        ? 'feedback-error'
                        : event.severity === 'warning'
                          ? 'feedback-warning'
                          : 'neutral-500'
                    }
                    size="sm"
                  >
                    {event.severity}
                  </Badge>
                  <span className="min-w-[10rem] flex-1 truncate text-caption text-text-primary">
                    {event.eventType.replace(/_/g, ' ')}
                    {event.userName && (
                      <span className="text-text-tertiary"> · {event.userName}</span>
                    )}
                  </span>
                  <span className="w-20 shrink-0 text-right text-micro text-text-tertiary">
                    {when(event.createdAt, now)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
