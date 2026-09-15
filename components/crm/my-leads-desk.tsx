'use client';

import * as React from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  Mail,
  MoreVertical,
  Plus,
  Search,
  SlidersHorizontal,
  Users,
} from 'lucide-react';

import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { Badge } from '@/components/ui/badge';
import { Pagination } from '@/components/ui/pagination';
import { useToast } from '@/components/ui/toast';
import type { CrmDueCounts, CrmLeadRow, CrmProjectOption } from '@/lib/db/queries/crm-leads';
import { STAGE_ORDER, stageLabel, stageToken } from '@/lib/domain/crm-stages';
import { leadPriority, priorityLabel, priorityToken } from '@/lib/domain/lead-priority';
import { sourceDetail, sourceLabel, sourceToken } from '@/lib/domain/lead-source';
import { displayPhone, whatsAppDigits } from '@/lib/domain/phone';
import { relativeAge } from '@/lib/view/relative-age';
import { cn } from '@/lib/utils';

/* ============================================================================
 * MY LEADS — the sales consultant's own list
 * ----------------------------------------------------------------------------
 * From the owner's reference of 2026-09-14 and the Phase 1 specification.
 *
 * ── ⚠️ EVERY PIECE OF STATE LIVES IN THE URL ───────────────────────────────
 * Owner's requirement: *"URL state supports direct links and browser
 * navigation"*, and *"opening and closing a drawer must preserve current search,
 * applied filters, sorting, pagination."*
 *
 * `useState` for the tab or the filters would break all of that at once — the
 * back button, a shared link, and the drawer closing back onto a list that has
 * silently reset to page 1. So the tab, the project, the search, the stage and
 * the page are parameters, and the only local state in this file is the
 * selection checkboxes, which nothing else needs to know about.
 *
 * ── ⚠️ AND `mine` IS NOT ONE OF THEM ───────────────────────────────────────
 * The page hard-codes it. A URL parameter would make "only leads assigned to me"
 * a suggestion, and the owner's rule is that it is locked.
 * ========================================================================= */

interface Option {
  readonly id: string;
  readonly name: string;
  readonly leads: number;
}

export function MyLeadsDesk({
  projects,
  selectedProjectId,
  rows,
  total,
  stageCounts,
  counts,
  page,
  perPage,
  filters,
  firstName,
  fullName,
  nowMs,
}: {
  projects: readonly CrmProjectOption[];
  selectedProjectId: string | null;
  rows: readonly CrmLeadRow[];
  total: number;
  stageCounts: Record<string, number>;
  counts: CrmDueCounts;
  owners: readonly Option[];
  page: number;
  perPage: number;
  filters: { stage: string | null; search: string | null; due: string | null };
  firstName: string;
  fullName: string;
  nowMs: number;
}) {
  const router = useRouter();
  const search = useSearchParams();

  /* One helper for every control, so changing a filter keeps the others — and
     so any parameter this component does not model still survives the trip. */
  const setParam = React.useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(search.toString());
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      /* ⚠️ Any change except paging returns to page 1. Filtering to four rows
         while still on page 9 shows an empty list, which reads as "no leads"
         rather than as "wrong page". */
      if (key !== 'page') next.delete('page');
      router.push(`/my-leads?${next.toString()}` as Route);
    },
    [router, search],
  );

  const assigned = counts.assigned ?? total;
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const pageCount = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-4">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-h1 tracking-tight text-text-primary">My leads</h1>
          <p className="mt-1.5 max-w-2xl text-body-sm text-text-secondary">
            Work the leads assigned to you and always set the next action.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* ⚠️ "Add lead" does NOT let a salesperson choose an owner — the rota
              assigns it. The form is Phase 4; until it exists this opens the
              desk's own path rather than a dialog that cannot finish. */}
          <Link
            href={'/leads' as Route}
            className="inline-flex min-h-[2.4rem] items-center gap-1.5 rounded-xl bg-accent-primary px-3 text-body-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add lead
          </Link>
          <button
            type="button"
            onClick={() => setParam('due', 'no-plan')}
            className="inline-flex min-h-[2.4rem] items-center gap-1.5 rounded-xl border border-border-subtle bg-bg-surface px-3 text-body-sm font-medium text-text-primary transition-colors hover:border-border-default"
          >
            <CalendarPlus className="size-4" aria-hidden="true" />
            New follow-up
          </button>
        </div>
      </div>

      {/* ── The four figures ────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure
          label="Assigned leads"
          value={assigned}
          icon={Users}
          token="accent-primary"
          on={filters.due === null}
          onPick={() => setParam('due', null)}
        />
        <Figure
          label="Needs attention"
          value={counts.overdue}
          icon={AlertTriangle}
          token="gold-700"
          on={filters.due === 'overdue'}
          onPick={() => setParam('due', filters.due === 'overdue' ? null : 'overdue')}
        />
        <Figure
          label="Due today"
          value={counts.dueToday}
          icon={CalendarDays}
          token="accent-primary"
          on={filters.due === 'today'}
          onPick={() => setParam('due', filters.due === 'today' ? null : 'today')}
        />
        <Figure
          label="Unread replies"
          value={counts.waitingForReply}
          icon={Mail}
          token="feedback-success"
          on={filters.due === 'waiting'}
          onPick={() => setParam('due', filters.due === 'waiting' ? null : 'waiting')}
        />
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            { key: null, label: 'All my leads', n: assigned },
            { key: 'overdue', label: 'Needs attention', n: counts.overdue },
            { key: 'waiting', label: 'Waiting for reply', n: counts.waitingForReply },
            { key: 'upcoming', label: 'Upcoming', n: null },
            { key: 'closed', label: 'Closed', n: null },
          ] as const
        ).map((t) => {
          const on = (filters.due ?? null) === t.key;
          return (
            <button
              key={t.label}
              type="button"
              onClick={() => setParam('due', t.key)}
              aria-pressed={on}
              className={cn(
                'rounded-lg px-3 py-1.5 text-body-sm font-medium transition-colors',
                on
                  ? 'bg-accent-primary text-white'
                  : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary',
              )}
            >
              {t.label}
              {/* ⚠️ Upcoming and Closed carry NO count. Both are cheap to show
                  and expensive to count — they need their own queries, and a
                  number that is quietly wrong is worse than no number. They
                  arrive when the count does. */}
              {t.n !== null && ` (${t.n})`}
            </button>
          );
        })}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Picker
          label="My projects"
          value={selectedProjectId ?? ''}
          onChange={(v) => setParam('project', v || null)}
          options={[
            { value: '', label: 'My projects' },
            ...projects.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />

        <label className="relative min-w-[16rem] flex-1">
          <span className="sr-only">Search by name, email or phone</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
          />
          <input
            type="search"
            defaultValue={filters.search ?? ''}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setParam('q', (e.target as HTMLInputElement).value);
            }}
            placeholder="Search by name, email or phone…"
            className="min-h-[2.6rem] w-full rounded-xl border border-border-subtle bg-bg-surface pl-9 pr-3 text-body-sm text-text-primary transition-colors hover:border-border-default focus:border-accent-primary focus:outline-none"
          />
        </label>

        <Picker
          label="Stage"
          value={filters.stage ?? ''}
          onChange={(v) => setParam('stage', v || null)}
          options={[
            { value: '', label: 'Stage' },
            ...STAGE_ORDER.map((s) => ({
              value: s,
              label: `${stageLabel(s)}${stageCounts[s] ? ` (${stageCounts[s]})` : ''}`,
            })),
          ]}
        />

        <button
          type="button"
          onClick={() => setParam('due', 'no-plan')}
          className="inline-flex min-h-[2.6rem] items-center gap-1.5 rounded-xl border border-border-subtle bg-bg-surface px-3 text-body-sm font-medium text-text-primary transition-colors hover:border-border-default"
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          More filters
        </button>
      </div>

      {/* ── The table ───────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <Empty filters={filters} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-default bg-bg-surface">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border-default bg-bg-subtle">
                <Th>Lead / project</Th>
                <Th>Stage</Th>
                <Th>Latest conversation</Th>
                <Th>Next action</Th>
                <Th>Priority</Th>
                <Th>Source</Th>
                <Th>Quick actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((lead) => (
                <Row key={lead.id} lead={lead} nowMs={nowMs} fullName={fullName} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Pagination
          page={page}
          pageCount={pageCount}
          onPage={(n) => setParam('page', String(n))}
          from={from}
          to={from === 0 ? 0 : from + rows.length - 1}
          total={total}
          label="leads"
        />
        <p className="text-caption text-text-secondary">
          Everything here is assigned to you, {firstName}.
        </p>
      </div>
    </div>
  );
}

/* ---- The figures ---------------------------------------------------------- */

function Figure({
  label,
  value,
  icon: Icon,
  token,
  on,
  onPick,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  token: string;
  on: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={on}
      className={cn(
        'flex items-center gap-3 rounded-2xl border bg-bg-surface px-4 py-3.5 text-left transition-colors',
        on ? 'border-accent-primary ring-1 ring-accent-primary' : 'border-border-subtle hover:border-border-default',
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-full"
        style={{
          backgroundColor: `color-mix(in oklab, var(--${token}) 12%, transparent)`,
          color: `var(--${token})`,
        }}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-caption text-text-secondary">{label}</span>
        <span className="block text-h3 font-semibold tabular-nums text-text-primary">{value}</span>
      </span>
    </button>
  );
}

function Picker({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[2.6rem] cursor-pointer appearance-none rounded-xl border border-border-subtle bg-bg-surface px-3 pr-9 text-body-sm font-medium text-text-primary transition-colors hover:border-border-default focus:border-accent-primary focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
      />
    </div>
  );
}

/* ---- One lead ------------------------------------------------------------- */

const TD = 'px-3 py-3 align-top';

function Row({
  lead,
  nowMs,
  fullName,
}: {
  lead: CrmLeadRow;
  nowMs: number;
  fullName: string;
}) {
  const toast = useToast();
  const phone = displayPhone(lead.phoneE164, lead.phone);
  const wa = whatsAppDigits(lead.phoneE164 ?? lead.phone);
  const priority = leadPriority(lead, nowMs);
  const late = lead.nextActionAt !== null && Date.parse(lead.nextActionAt) < nowMs;

  /* ⚠️ INITIALS FROM THE NAME, never a stored avatar. A lead is a stranger who
     filled in a form; there is no photo of them and inventing one — a generated
     face, a gravatar — would put a fictional person's picture beside a real
     name. Two letters is the honest maximum. */
  const initials = (lead.fullName ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  const href = `/leads/${lead.id}` as Route;

  return (
    <tr className="border-b border-border-subtle transition-colors last:border-b-0 hover:bg-[color-mix(in_oklab,var(--accent-primary)_7%,transparent)]">
      {/* ── The person ──────────────────────────────────────────────────── */}
      <td className={TD}>
        <span className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-full text-caption font-semibold"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--accent-primary) 12%, transparent)',
              color: 'var(--accent-primary)',
            }}
          >
            {initials}
          </span>
          <span className="min-w-0">
            <Link
              href={href}
              className="block truncate text-body-sm font-semibold text-text-primary underline-offset-2 hover:text-text-brand hover:underline"
            >
              {lead.fullName ?? 'Name not given'}
            </Link>
            <span className="mt-0.5 block truncate text-caption text-text-secondary">
              {lead.projectName ?? 'No project'}
              {lead.city && ` · ${lead.city}`}
            </span>
            {/* ⚠️ THE PROPERTY LINE IS ABSENT UNTIL PHASE C. The design shows
                "5 Marla Plot · Block A" here; there is no property table yet, and
                a placeholder would be a fact about somebody's enquiry that nobody
                recorded. */}
          </span>
        </span>
      </td>

      <td className={TD}>
        <Badge token={stageToken(lead.stage)} size="sm">
          {stageLabel(lead.stage)}
        </Badge>
      </td>

      {/* ── What was last said ──────────────────────────────────────────── */}
      <td className={TD}>
        {lead.lastMessageAt ? (
          <span className="flex min-w-0 items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-0.5 shrink-0"
              style={{
                color: lead.lastMessageDirection === 'inbound' ? WA_GREEN : 'var(--text-tertiary)',
              }}
            >
              <WhatsAppMark className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-body-sm text-text-primary">
                {lead.lastMessageBody?.trim() || 'An attachment'}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-caption text-text-secondary">
                {relativeAge(lead.lastMessageAt, nowMs)}
                {lead.lastMessageDirection === 'inbound' && (
                  <span
                    className="rounded-full px-1.5 py-px text-micro font-medium"
                    style={{
                      backgroundColor: `color-mix(in oklab, ${WA_GREEN} 16%, transparent)`,
                      color: 'var(--text-primary)',
                    }}
                  >
                    New reply
                  </span>
                )}
              </span>
            </span>
          </span>
        ) : (
          <span className="text-caption text-text-tertiary">Nothing yet</span>
        )}
      </td>

      {/* ── What is owed ────────────────────────────────────────────────── */}
      <td className={TD}>
        {lead.nextAction ? (
          <span className="flex min-w-0 items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-0.5 shrink-0"
              style={{ color: late ? 'var(--feedback-error)' : 'var(--accent-primary)' }}
            >
              <CalendarDays className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-body-sm text-text-primary">
                {lead.nextAction}
              </span>
              {lead.nextActionAt && (
                <span
                  className={cn(
                    'mt-0.5 block text-caption tabular-nums',
                    late ? 'font-semibold text-feedback-error' : 'text-text-brand',
                  )}
                >
                  {late ? 'Overdue · ' : ''}
                  {new Date(lead.nextActionAt).toLocaleString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Karachi',
                  })}
                </span>
              )}
            </span>
          </span>
        ) : (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-caption font-medium text-text-brand underline-offset-2 hover:underline"
          >
            <CalendarPlus className="size-3.5" aria-hidden="true" />
            Add follow-up
          </Link>
        )}
      </td>

      {/* ── How urgent ──────────────────────────────────────────────────── */}
      <td className={TD}>
        <span
          className="inline-flex items-center gap-1.5 text-caption text-text-secondary"
          title={priority.reason}
        >
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: `var(--${priorityToken(priority.level)})` }}
          />
          {priorityLabel(priority.level)}
        </span>
      </td>

      {/* ── Where they came from ────────────────────────────────────────── */}
      <td className={TD}>
        <span className="flex min-w-0 items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-1 size-2 shrink-0 rounded-full"
            style={{ backgroundColor: `var(--${sourceToken(lead.source)})` }}
          />
          <span className="min-w-0">
            <span className="block truncate text-body-sm text-text-primary">
              {sourceLabel(lead.source)}
            </span>
            {sourceDetail(lead.source, lead.sourceDetail) && (
              <span className="mt-0.5 block truncate text-caption text-text-secondary">
                {sourceDetail(lead.source, lead.sourceDetail)}
              </span>
            )}
          </span>
        </span>
      </td>

      {/* ── Reaching them ───────────────────────────────────────────────── */}
      <td className={TD}>
        <span className="flex items-center gap-1">
          {lead.canWhatsApp && lead.phoneE164 ? (
            <Reach href={`/leads/${lead.id}?chat=1` as Route} label={`WhatsApp ${lead.fullName ?? 'lead'}`} tone="wa">
              <WhatsAppMark className="size-5" />
            </Reach>
          ) : wa ? (
            <Reach
              href={`https://wa.me/${wa}`}
              external
              label={`WhatsApp ${lead.fullName ?? 'lead'} from your own phone`}
              tone="wa"
            >
              <WhatsAppMark className="size-5" />
            </Reach>
          ) : (
            <Explain
              toast={toast}
              label={`WhatsApp ${lead.fullName ?? 'this lead'}`}
              reason={
                lead.phone
                  ? `“${lead.phone}” could not be read as a WhatsApp number. Open the lead to correct it.`
                  : 'This lead has no WhatsApp number on record.'
              }
            >
              <WhatsAppMark className="size-5" />
            </Explain>
          )}

          {lead.email ? (
            <Reach href={`mailto:${lead.email}`} label={`Email ${lead.fullName ?? 'lead'} at ${lead.email}`}>
              <Mail className="size-4" aria-hidden="true" />
            </Reach>
          ) : (
            <Explain
              toast={toast}
              label={`Email ${lead.fullName ?? 'this lead'}`}
              reason="This lead did not give an email address."
            >
              <Mail className="size-4" aria-hidden="true" />
            </Explain>
          )}

          <Link
            href={href}
            title={`Call ${lead.fullName ?? 'this lead'} on ${phone}`}
            className="ml-0.5 inline-flex min-h-9 shrink-0 items-center rounded-lg bg-accent-primary px-3 text-body-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Follow-up
          </Link>

          <Link
            href={href}
            aria-label={`More for ${lead.fullName ?? 'this lead'}`}
            title={`Open ${lead.fullName ?? 'this lead'} — ${fullName}'s lead`}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <MoreVertical className="size-4" aria-hidden="true" />
          </Link>
        </span>
      </td>
    </tr>
  );
}

/* ---- Small parts ---------------------------------------------------------- */

function Reach({
  href,
  label,
  external,
  tone = 'plain',
  children,
}: {
  href: string;
  label: string;
  external?: boolean;
  tone?: 'plain' | 'wa';
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      style={
        tone === 'wa'
          ? { backgroundColor: `color-mix(in oklab, ${WA_GREEN} 14%, transparent)`, color: WA_GREEN }
          : undefined
      }
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-lg border border-transparent transition-colors',
        tone === 'plain' && 'bg-bg-subtle text-text-secondary hover:text-text-primary',
      )}
    >
      {children}
    </a>
  );
}

/**
 * A reach control whose data is missing.
 *
 * ⚠️ PRESENT AND ANSWERING, never absent. A control that appears on some rows
 * and not others makes the eye re-find the Follow-up button on every line, and
 * teaches the reader that a missing icon means "nothing to do here" when it
 * means "this one needs a number".
 */
function Explain({
  toast,
  label,
  reason,
  children,
}: {
  toast: ReturnType<typeof useToast>;
  label: string;
  reason: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => toast({ tone: 'warn', text: reason })}
      aria-label={`${label} — not available`}
      title={reason}
      className="grid size-9 shrink-0 place-items-center rounded-lg border border-dashed border-border-default text-text-disabled transition-colors hover:bg-bg-subtle hover:text-text-secondary"
    >
      {children}
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-3 py-2.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary"
    >
      {children}
    </th>
  );
}

function Empty({ filters }: { filters: { due: string | null; search: string | null } }) {
  /* ⚠️ THREE DIFFERENT EMPTIES, because they need three different actions. "You
     have no leads" and "no leads match this filter" look identical and mean
     opposite things — one is a queue problem for the manager, the other is one
     click to fix. */
  const filtered = filters.due !== null || (filters.search ?? '') !== '';
  return (
    <div className="rounded-xl border border-border-default bg-bg-surface px-6 py-12 text-center">
      <p className="text-body font-medium text-text-primary">
        {filtered ? 'No leads match this view' : 'Nothing is assigned to you yet'}
      </p>
      <p className="mx-auto mt-1.5 max-w-md text-caption leading-relaxed text-text-secondary">
        {filtered
          ? 'Clear the tab or the search to see the rest of your leads. Nothing has been deleted.'
          : 'Leads are shared out by the sales manager, and you will get a notification the moment one is yours.'}
      </p>
    </div>
  );
}
