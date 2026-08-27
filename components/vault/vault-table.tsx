'use client';

import * as React from 'react';
import {
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  LayoutGrid,
  List,
  Loader2,
  MoreVertical,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';

import type { CredentialRow } from '@/lib/db/queries/credentials';
import { credentialService } from '@/lib/domain/credential-service';
import { brandMarkLabel } from '@/lib/brand/service-marks';
import { CredentialIcon } from '@/components/brand/credential-icon';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { KINDS, KIND_LABEL } from './credential-dialog';

/* ============================================================================
 * THE VAULT — the owner's layout
 * ----------------------------------------------------------------------------
 * *"I want the exact same layout in both themes and exactly everything, but make
 * sure that the functionality and features are required. Implement each and every
 * thing logically and please make sure that you do not skip any feature."*
 *
 * Five counters, four controls, a table, and a details panel. Every figure is
 * computed from the rows in hand — none is a placeholder.
 *
 * ── ⚠️ THE COUNTERS THE SCHEMA COULD NOT ANSWER, AND NOW CAN ────────────────
 * The design asks for an Active/Inactive pill, a Deactivate button, a
 * "Compromised" counter and a "Last used" column. None of those existed:
 * migration 057 added `status` and `last_used_at` for exactly these, and
 * backfilled the second from `security_events` so it shipped populated rather
 * than reading "never used" on every row.
 *
 * ── ⚠️ "SHARED" MEANS A NAMED GRANT, NOT A PROJECT ──────────────────────────
 * `sharedWith` counts rows in `credential_grants` (migration 050) — people
 * explicitly given this one credential. A credential attached to a project is not
 * "shared"; it is filed. Conflating them would report most of the vault as shared
 * on the day somebody tidied it into projects.
 *
 * ── ⚠️ NO PASSWORD PROMPT BEFORE A REVEAL ───────────────────────────────────
 * Owner, 2026-08-25: *"don't require confirming the password again… Just decrypt
 * the credential and let me watch."* So the eye reveals directly. The permission
 * check and the audit trail are untouched — and that trail is now the only control
 * on a reveal, which is why the details panel has an Activity Log tab rather than
 * hiding the log on another screen.
 * ========================================================================= */

const ALL = '__all__';
const NONE = '__none__';
const PAGE_SIZE = 6;

export type SortKey = 'recent' | 'label' | 'used' | 'project';

const SORT_LABEL: Readonly<Record<SortKey, string>> = {
  recent: 'Recently Added',
  label: 'Name (A–Z)',
  used: 'Recently Used',
  project: 'Project',
};

const STATUS_META = {
  active: { label: 'Active', token: 'status-done' },
  inactive: { label: 'Inactive', token: 'status-backlog' },
  compromised: { label: 'Compromised', token: 'feedback-error' },
} as const;

/** A revealed secret, held only while its row is open. */
export interface Revealed {
  readonly id: string;
  readonly label: string;
  readonly username: string | null;
  readonly secret: string;
}

export interface VaultTableProps {
  readonly credentials: readonly CredentialRow[];
  readonly projects: ReadonlyArray<{ id: string; name: string }>;
  readonly canManage: boolean;
  readonly canDelete: boolean;
  readonly canGrant: boolean;
  /** The server's clock. See lib/now.ts. */
  readonly nowMs: number;
  readonly busyId: string | null;
  readonly revealed: Revealed | null;
  readonly onAdd: () => void;
  readonly onOpen: (credential: CredentialRow) => void;
  readonly onReveal: (credential: CredentialRow) => void;
  readonly onEdit: (credential: CredentialRow) => void;
  readonly onStatus: (credential: CredentialRow, status: 'active' | 'inactive' | 'compromised') => void;
  readonly onDelete: (credential: CredentialRow) => void;
  readonly onAccess: (credential: CredentialRow) => void;
}

export function VaultTable(props: VaultTableProps) {
  const { credentials, projects, canManage, canGrant, nowMs } = props;

  const [query, setQuery] = React.useState('');
  const [kind, setKind] = React.useState(ALL);
  const [projectId, setProjectId] = React.useState(ALL);
  const [status, setStatus] = React.useState<'all' | keyof typeof STATUS_META>('all');
  const [sort, setSort] = React.useState<SortKey>('recent');
  const [view, setView] = React.useState<'list' | 'grid'>('list');
  const [page, setPage] = React.useState(1);

  /* ---- The five counters ------------------------------------------------- */
  const stats = React.useMemo(() => {
    const total = credentials.length;
    const active = credentials.filter((c) => c.status === 'active').length;
    const shared = credentials.filter((c) => c.sharedWith > 0).length;
    const compromised = credentials.filter((c) => c.status === 'compromised').length;

    /* ⚠️ Thirty days, measured from the SERVER's clock, and only rows that have an
       expiry at all. A credential with no expiry date is not "expiring in 30 days"
       and must not be counted as safe OR as due — it simply has nothing to say. */
    const horizon = new Date(nowMs + 30 * 86_400_000).toISOString().slice(0, 10);
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const expiring = credentials.filter(
      (c) => c.expiresAt !== null && c.expiresAt <= horizon && c.expiresAt >= today,
    ).length;
    /* Already past. Counted separately so "expiring soon" cannot quietly include
       things that expired last month — those need a different verb. */
    const expired = credentials.filter((c) => c.expiresAt !== null && c.expiresAt < today).length;

    /* ⚠️ A real month-over-month, from `created_at`. The design shows "+12% this
       month"; this is that number or nothing. With no credential older than this
       month there is no previous total to compare against, and a percentage
       against zero is not a fact. */
    const monthStart = new Date(nowMs);
    monthStart.setUTCDate(1);
    const boundary = monthStart.toISOString().slice(0, 10);
    const addedThisMonth = credentials.filter((c) => c.createdAt.slice(0, 10) >= boundary).length;
    const before = total - addedThisMonth;

    return {
      total,
      active,
      shared,
      compromised,
      expiring,
      expired,
      addedThisMonth,
      growth: before > 0 ? Math.round((addedThisMonth / before) * 100) : null,
    };
  }, [credentials, nowMs]);

  /* ---- Rows -------------------------------------------------------------- */
  const shown = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    let rows = credentials.filter((c) => {
      if (kind !== ALL && c.kind !== kind) return false;
      if (projectId === NONE && c.projectId !== null) return false;
      if (projectId !== ALL && projectId !== NONE && c.projectId !== projectId) return false;
      if (status !== 'all' && c.status !== status) return false;
      if (!needle) return true;
      /* The username is searched too — people look for a login by the address it
         uses at least as often as by the name somebody gave it. */
      return `${c.label} ${c.username ?? ''} ${c.projectName ?? ''}`
        .toLowerCase()
        .includes(needle);
    });

    rows = [...rows].sort((a, b) => {
      switch (sort) {
        case 'label':
          return a.label.localeCompare(b.label);
        case 'used':
          /* Never-used last, whichever way — a blank is not "read in 1970". */
          return (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '');
        case 'project':
          return (a.projectName ?? '￿').localeCompare(b.projectName ?? '￿');
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });
    return rows;
  }, [credentials, query, kind, projectId, status, sort]);

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = shown.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const from = shown.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const to = Math.min(safePage * PAGE_SIZE, shown.length);

  /* Only the kinds and projects actually present, so no filter returns nothing. */
  const kindsPresent = React.useMemo(() => {
    const seen = new Set(credentials.map((c) => c.kind));
    return KINDS.filter((k) => seen.has(k));
  }, [credentials]);

  const projectsPresent = React.useMemo(() => {
    const seen = new Set(credentials.map((c) => c.projectId).filter(Boolean));
    return projects.filter((p) => seen.has(p.id));
  }, [credentials, projects]);

  const unfiled = credentials.filter((c) => c.projectId === null).length;

  return (
    <div className="space-y-4">
      {/* ---- Counters ------------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          icon={KeyRound}
          token="accent-primary"
          label="Total credentials"
          value={stats.total}
          hint={
            stats.addedThisMonth === 0
              ? 'none added this month'
              : stats.growth === null
                ? `${stats.addedThisMonth} added this month`
                : `+${stats.growth}% this month`
          }
        />
        <Stat
          icon={ShieldCheck}
          token="status-done"
          label="Active"
          value={stats.active}
          hint={stats.total > 0 ? `${Math.round((stats.active / stats.total) * 100)}% of total` : '—'}
        />
        <Stat
          icon={Users}
          token="status-progress"
          label="Shared"
          value={stats.shared}
          /* ⚠️ Says what it counts. "Shared 8" with no qualifier reads as "eight
             people can see the vault"; it means eight credentials have somebody
             named on them. */
          hint={stats.shared === 0 ? 'nobody named on any' : 'have named people'}
        />
        <Stat
          icon={Loader2}
          token="feedback-warning"
          label="Expiring soon"
          value={stats.expiring}
          hint={stats.expired > 0 ? `${stats.expired} already past` : 'within 30 days'}
        />
        <Stat
          icon={ShieldAlert}
          token="feedback-error"
          label="Compromised"
          value={stats.compromised}
          hint={stats.compromised === 0 ? 'all good' : 'change these at the source'}
        />
      </div>

      {/* ---- Controls ------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[13rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
            strokeWidth={2.25}
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search credentials…"
            aria-label="Search credentials"
            className={cn(
              'h-10 w-full rounded-xl border border-border-default bg-bg-surface pl-9 pr-3',
              'text-body-sm text-text-primary placeholder:text-text-tertiary',
              'focus-visible:border-border-brand focus-visible:outline-none',
            )}
          />
        </div>

        <Select
          label="Type"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
            setPage(1);
          }}
          options={[
            { value: ALL, label: 'All types' },
            ...kindsPresent.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k })),
          ]}
          className="h-10 w-[10.5rem] rounded-xl"
        />

        <Select
          label="Project"
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
            setPage(1);
          }}
          options={[
            { value: ALL, label: 'All projects' },
            ...projectsPresent.map((p) => ({ value: p.id, label: p.name })),
            ...(unfiled > 0 ? [{ value: NONE, label: `No project (${unfiled})` }] : []),
          ]}
          className="h-10 w-[11rem] rounded-xl"
        />

        <Select
          label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as typeof status);
            setPage(1);
          }}
          options={[
            { value: 'all', label: 'All statuses' },
            ...(Object.keys(STATUS_META) as Array<keyof typeof STATUS_META>).map((k) => ({
              value: k,
              label: STATUS_META[k].label,
            })),
          ]}
          className="h-10 w-[10rem] rounded-xl"
        />

        <div className="ml-auto flex items-center gap-2">
          <Select
            label="Sort by"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            options={(Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({
              value: k,
              label: `Sort: ${SORT_LABEL[k]}`,
            }))}
            className="h-10 w-[12.5rem] rounded-xl"
          />

          <div className="flex items-center gap-0.5 rounded-xl border border-border-default bg-bg-subtle p-0.5">
            <ViewButton on={view === 'grid'} label="Grid" icon={LayoutGrid} onClick={() => setView('grid')} />
            <ViewButton on={view === 'list'} label="List" icon={List} onClick={() => setView('list')} />
          </div>

          {canManage && (
            <button
              type="button"
              onClick={props.onAdd}
              className={cn(
                'flex h-10 items-center gap-2 rounded-xl bg-accent-primary px-4',
                'text-body-sm font-semibold text-text-on-brand hover:bg-accent-primary-hover',
              )}
            >
              <Plus className="size-4" strokeWidth={2.5} aria-hidden="true" />
              Add credential
            </button>
          )}
        </div>
      </div>

      {/* ---- Rows ----------------------------------------------------------- */}
      {view === 'list' ? (
        <div className="overflow-hidden rounded-xl border border-border-default bg-bg-surface">
          <table className="w-full table-fixed border-collapse text-left">
            <colgroup>
              {[26, 12, 16, 14, 10, 10, 12].map((share, i) => (
                <col key={i} style={{ width: `${share}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-border-default bg-bg-subtle">
                <Th>Service / credential</Th>
                <Th>Type</Th>
                <Th>Project</Th>
                <Th>Issued to</Th>
                <Th>Last used</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((credential) => (
                <Row key={credential.id} credential={credential} {...props} />
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <p className="text-body-sm font-semibold text-text-primary">
                      {credentials.length === 0 ? 'The vault is empty' : 'Nothing matches'}
                    </p>
                    <p className="mx-auto mt-1 max-w-[32rem] text-caption text-text-secondary">
                      {credentials.length === 0
                        ? canManage
                          ? 'Add a credential and it is encrypted before it is stored.'
                          : 'You will see a credential here when one is issued to you or shared with you.'
                        : 'Clear a filter or search for something else.'}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((credential) => (
            <GridCard key={credential.id} credential={credential} {...props} />
          ))}
          {shown.length === 0 && (
            <p className="col-span-full rounded-xl border border-border-default bg-bg-surface px-4 py-12 text-center text-body-sm text-text-secondary">
              {credentials.length === 0 ? 'The vault is empty.' : 'Nothing matches these filters.'}
            </p>
          )}
        </div>
      )}

      {/* ---- Footer --------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-text-secondary">
          {shown.length === 0
            ? 'No results'
            : `Showing ${from} to ${to} of ${shown.length} result${shown.length === 1 ? '' : 's'}`}
        </p>

        {pageCount > 1 && (
          <span className="flex items-center gap-1">
            <Step label="Previous" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>
              ‹
            </Step>
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                aria-current={n === safePage ? 'page' : undefined}
                onClick={() => setPage(n)}
                className={cn(
                  'size-8 rounded-lg text-caption font-semibold',
                  n === safePage
                    ? 'bg-accent-primary text-text-on-brand'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                )}
              >
                {n}
              </button>
            ))}
            <Step
              label="Next"
              disabled={safePage === pageCount}
              onClick={() => setPage(safePage + 1)}
            >
              ›
            </Step>
          </span>
        )}
      </div>

      {canGrant && (
        <p className="text-micro text-text-tertiary">
          {/* ⚠️ Said once, here, rather than on every row. Only an Admin sees it,
              because to anybody else it describes a control they do not have. */}
          Only an Admin can add, edit or delete a credential, or change who may see one.
          Every reveal is written to the security log.
        </p>
      )}
    </div>
  );
}

/* ---- Pieces -------------------------------------------------------------- */

function Stat({
  icon: Icon,
  token,
  label,
  value,
  hint,
}: {
  icon: typeof KeyRound;
  token: string;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border-default bg-bg-surface p-3.5">
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-lg"
        style={{ backgroundColor: `color-mix(in oklab, var(--${token}) 14%, transparent)` }}
      >
        <Icon className="size-5" strokeWidth={2.25} style={{ color: `var(--${token})` }} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-caption text-text-secondary">{label}</span>
        <span className="block text-h3 font-semibold tabular-nums text-text-primary">{value}</span>
        <span className="block truncate text-micro text-text-tertiary">{hint}</span>
      </span>
    </div>
  );
}

function ViewButton({
  on,
  label,
  icon: Icon,
  onClick,
}: {
  on: boolean;
  label: string;
  icon: typeof List;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${label} view`}
      title={`${label} view`}
      onClick={onClick}
      className={cn(
        'grid size-8 place-items-center rounded-lg',
        on ? 'bg-bg-surface text-text-primary shadow-xs' : 'text-text-tertiary hover:text-text-primary',
      )}
    >
      <Icon className="size-4" strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-3 py-2.5 text-caption font-medium text-text-secondary">
      {children}
    </th>
  );
}

const TD = 'px-3 py-3 align-middle';

/** The brand mark and the human name for one credential. */
function useIdentity(credential: CredentialRow) {
  return React.useMemo(
    () =>
      credentialService({
        url: credential.url,
        label: credential.label,
        kind: credential.kind,
        service: credential.service,
        markLabel: brandMarkLabel,
      }),
    [credential],
  );
}

function Row({
  credential,
  canManage,
  canDelete,
  nowMs,
  busyId,
  onOpen,
  onReveal,
  onEdit,
  onStatus,
  onDelete,
  onAccess,
}: { credential: CredentialRow } & Omit<VaultTableProps, 'credentials' | 'projects' | 'onAdd' | 'revealed'>) {
  const identity = useIdentity(credential);
  const meta = STATUS_META[credential.status];
  const busy = busyId === credential.id;

  return (
    <tr className="border-b border-border-subtle last:border-0 hover:bg-bg-hover">
      <td className={TD}>
        <button
          type="button"
          onClick={() => onOpen(credential)}
          className="flex w-full min-w-0 items-center gap-2.5 text-left"
        >
          <CredentialIcon
            url={credential.url}
            label={credential.label}
            kind={credential.kind}
            service={credential.service}
            size={30}
          />
          <span className="min-w-0">
            <span className="block truncate text-body-sm font-medium text-text-primary" title={credential.label}>
              {credential.label}
            </span>
            <span className="block truncate text-micro text-text-tertiary">
              {credential.username ?? identity.label}
            </span>
          </span>
        </button>
      </td>

      <td className={cn(TD, 'text-body-sm text-text-secondary')}>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: 'var(--accent-primary)' }}
          />
          <span className="truncate">{KIND_LABEL[credential.kind] ?? credential.kind}</span>
        </span>
      </td>

      <td className={cn(TD, 'text-body-sm text-text-secondary')}>
        <span className="block truncate" title={credential.projectName ?? undefined}>
          {credential.projectName ?? '—'}
        </span>
      </td>

      <td className={cn(TD, 'text-body-sm text-text-secondary')}>
        {/* ⚠️ EVERY holder, not one. A credential can be issued to several people
            (migration 059) and this column used to read the superseded single
            column — which the picker stopped writing, so it showed a dash for
            credentials that had two people on them. `title` carries the full list
            because the cell truncates and two names rarely fit. */}
        <span
          className="block truncate"
          title={credential.holders.map((h) => h.name).join(', ') || undefined}
        >
          {credential.holders.length === 0
            ? '—'
            : credential.holders.map((h) => h.name).join(', ')}
        </span>
      </td>

      <td className={cn(TD, 'text-body-sm text-text-tertiary')}>
        {/* ⚠️ "never" is a real answer, not a gap — and on a vault it is the more
            interesting one: a stored secret nobody has needed for a year is a
            candidate for retiring. */}
        {credential.lastUsedAt ? relative(credential.lastUsedAt, nowMs) : 'never'}
      </td>

      <td className={TD}>
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-micro font-semibold"
          style={{
            backgroundColor: `color-mix(in oklab, var(--${meta.token}) 14%, transparent)`,
            color: `var(--${meta.token})`,
          }}
        >
          {meta.label}
        </span>
      </td>

      <td className={TD}>
        <span className="flex items-center gap-0.5">
          {/* One press, no password prompt — the owner's instruction. */}
          <IconAction
            label={`Show the password for ${credential.label}`}
            icon={credential.hasSecret ? Eye : EyeOff}
            disabled={!credential.hasSecret || busy}
            busy={busy}
            onClick={() => onReveal(credential)}
          />
          <RowMenu
            credential={credential}
            canManage={canManage}
            canDelete={canDelete}
            busy={busy}
            onOpen={onOpen}
            onEdit={onEdit}
            onStatus={onStatus}
            onDelete={onDelete}
            onAccess={onAccess}
          />
        </span>
      </td>
    </tr>
  );
}

function GridCard({
  credential,
  nowMs,
  busyId,
  onOpen,
  onReveal,
}: { credential: CredentialRow } & Omit<VaultTableProps, 'credentials' | 'projects' | 'onAdd' | 'revealed'>) {
  const identity = useIdentity(credential);
  const meta = STATUS_META[credential.status];

  return (
    <button
      type="button"
      onClick={() => onOpen(credential)}
      className={cn(
        'flex flex-col gap-3 rounded-xl border-2 border-border-subtle bg-bg-surface p-4 text-left',
        'transition-[border-color,background-color] duration-[140ms]',
        'hover:border-border-strong hover:bg-bg-hover',
      )}
    >
      <span className="flex items-start gap-2.5">
        <CredentialIcon
          url={credential.url}
          label={credential.label}
          kind={credential.kind}
          service={credential.service}
          size={34}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm font-semibold text-text-primary">
            {credential.label}
          </span>
          <span className="block truncate text-micro text-text-tertiary">
            {credential.username ?? identity.label}
          </span>
        </span>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-micro font-semibold"
          style={{
            backgroundColor: `color-mix(in oklab, var(--${meta.token}) 14%, transparent)`,
            color: `var(--${meta.token})`,
          }}
        >
          {meta.label}
        </span>
      </span>

      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-text-tertiary">
        <span>{KIND_LABEL[credential.kind] ?? credential.kind}</span>
        {credential.projectName && <span>{credential.projectName}</span>}
        <span>
          {credential.lastUsedAt ? `used ${relative(credential.lastUsedAt, nowMs)}` : 'never used'}
        </span>
      </span>

      <span
        role="presentation"
        onClick={(event) => {
          /* ⚠️ Stops the card's own onClick — otherwise revealing also opens the
             panel, and the secret appears behind it. */
          event.stopPropagation();
          if (credential.hasSecret && busyId !== credential.id) onReveal(credential);
        }}
        className={cn(
          'flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border-default',
          'text-caption font-semibold',
          credential.hasSecret
            ? 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            : 'text-text-disabled',
        )}
      >
        {busyId === credential.id ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Eye className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        )}
        {credential.hasSecret ? 'Show password' : 'No password stored'}
      </span>
    </button>
  );
}

function IconAction({
  label,
  icon: Icon,
  disabled,
  busy,
  onClick,
}: {
  label: string;
  icon: typeof Eye;
  disabled: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-8 place-items-center rounded-lg text-text-tertiary',
        'hover:bg-bg-active hover:text-text-primary',
        'disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent',
      )}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Icon className="size-4" strokeWidth={2.25} aria-hidden="true" />
      )}
    </button>
  );
}

function RowMenu({
  credential,
  canManage,
  canDelete,
  busy,
  onOpen,
  onEdit,
  onStatus,
  onDelete,
  onAccess,
}: {
  credential: CredentialRow;
  canManage: boolean;
  canDelete: boolean;
  busy: boolean;
  onOpen: (c: CredentialRow) => void;
  onEdit: (c: CredentialRow) => void;
  onStatus: (c: CredentialRow, s: 'active' | 'inactive' | 'compromised') => void;
  onDelete: (c: CredentialRow) => void;
  onAccess: (c: CredentialRow) => void;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);

  /* `<details>` for the free keyboard behaviour, plus the outside-click and Escape
     it does not provide. Same pattern as the documents tables. */
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const close = (event: Event) => {
      if (!node.open) return;
      if (event.type === 'mousedown' && node.contains(event.target as Node)) return;
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      node.removeAttribute('open');
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  const item =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text-secondary ' +
    'hover:bg-bg-hover hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <details ref={ref} className="relative inline-block">
      <summary
        aria-label={`More actions for ${credential.label}`}
        className={cn(
          'grid size-8 cursor-pointer list-none place-items-center rounded-lg text-text-tertiary',
          'marker:content-none hover:bg-bg-active hover:text-text-primary',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <MoreVertical className="size-4" strokeWidth={2.25} aria-hidden="true" />
      </summary>

      <div
        onClick={() => ref.current?.removeAttribute('open')}
        className="absolute right-0 z-30 mt-1 w-[15rem] overflow-hidden rounded-xl border border-border-default bg-bg-surface py-1 shadow-[var(--shadow-lg)]"
      >
        <button type="button" onClick={() => onOpen(credential)} className={item}>
          Open details
        </button>

        {credential.url && (
          <a href={credential.url} target="_blank" rel="noopener noreferrer" className={item}>
            <ExternalLink className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            Visit the site
          </a>
        )}

        {/* ⚠️ NOT GATED ON `canGrant`, since 2026-08-25. Only an Admin may CHANGE
            who can see a credential — owner: *"only the admin is able to assign,
            add, delete, or manage who can view"* — but seeing the list is not
            changing it, and the same button on the project panel was never gated.
            The dialogue is read-only without `canGrant`, so hiding it here made
            that mode unreachable and left the two screens disagreeing about who may
            even ASK who can read a password. */}
        <button type="button" onClick={() => onAccess(credential)} className={item}>
          <Users className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
          Who can see this
          {credential.sharedWith > 0 && (
            <span className="ml-auto text-micro text-text-tertiary">{credential.sharedWith}</span>
          )}
        </button>

        {canManage && (
          <>
            <div className="my-1 h-px bg-border-subtle" />
            <button type="button" disabled={busy} onClick={() => onEdit(credential)} className={item}>
              Edit
            </button>

            {/* ⚠️ Only the transitions that mean something are offered. "Deactivate"
                on an already-inactive row does nothing, and a menu item that does
                nothing is one somebody presses twice and reports as broken. */}
            {credential.status !== 'inactive' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onStatus(credential, 'inactive')}
                className={item}
              >
                Deactivate
              </button>
            )}
            {credential.status !== 'active' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onStatus(credential, 'active')}
                className={item}
              >
                Make active again
              </button>
            )}
            {credential.status !== 'compromised' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onStatus(credential, 'compromised')}
                className={cn(item, 'text-[var(--feedback-error)] hover:text-[var(--feedback-error)]')}
              >
                <ShieldAlert className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                Flag as compromised
              </button>
            )}
          </>
        )}

        {canDelete && (
          <>
            <div className="my-1 h-px bg-border-subtle" />
            {/* ⚠️ Distinct from Deactivate, and the menu says which is which:
                deactivating keeps the secret, deleting destroys it. */}
            <button
              type="button"
              disabled={busy}
              onClick={() => onDelete(credential)}
              className={cn(item, 'text-[var(--feedback-error)] hover:text-[var(--feedback-error)]')}
            >
              <Trash2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              Delete permanently
            </button>
          </>
        )}
      </div>
    </details>
  );
}

/** `2d ago`. Formatted from the SERVER's clock — see lib/now.ts. */
function relative(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const elapsed = nowMs - then;
  if (elapsed < 60_000) return 'just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  if (elapsed < 2_592_000_000) return `${Math.floor(elapsed / 604_800_000)}w ago`;
  return `${Math.floor(elapsed / 2_592_000_000)}mo ago`;
}

function Step({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'size-8 rounded-lg text-caption text-text-secondary',
        'hover:bg-bg-hover hover:text-text-primary',
        'disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent',
      )}
    >
      {children}
    </button>
  );
}

/** Re-exported for the details panel, which shows the same pill and the same ages. */
export { STATUS_META, relative, Copy };
