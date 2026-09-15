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
  PauseCircle,
  Plus,
  Search,
  SlidersHorizontal,
  Users,
} from 'lucide-react';

import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
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

  /* ⚠️ PAGE-SCOPED SELECTION, and deliberately. A selection that silently spans
     pages is how somebody bulk-changes 600 leads meaning 10. Nothing acts on it
     yet — the bulk bar is the next phase — but the control is real, because the
     owner asked for it and a checkbox that does not tick is worse than none. */
  const [ticked, setTicked] = React.useState<ReadonlySet<string>>(new Set());
  const shown = React.useMemo(() => rows.map((r) => r.id), [rows]);
  const allTicked = shown.length > 0 && shown.every((id) => ticked.has(id));
  const onTick = (id: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

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
              assigns it, and the form says so where the dropdown would be. */}
          <button
            type="button"
            onClick={() => setParam('action', 'add')}
            className="inline-flex min-h-[2.4rem] items-center gap-1.5 rounded-xl bg-accent-primary px-3 text-body-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add lead
          </button>
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

      {/* ⚠️ THE COUNT IS SHOWN, EVEN THOUGH NOTHING ACTS ON IT YET. A checkbox
          with no feedback anywhere reads as broken; a line saying what is
          selected is honest about the state and about what is missing. */}
      {ticked.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent-primary bg-[color-mix(in_oklab,var(--accent-primary)_8%,transparent)] px-4 py-2.5">
          <span className="text-body-sm font-medium text-text-primary">
            {ticked.size} selected on this page
          </span>
          <span className="text-caption text-text-secondary">
            Bulk actions arrive with the next phase.
          </span>
          <button
            type="button"
            onClick={() => setTicked(new Set())}
            className="ml-auto text-caption font-medium text-text-brand underline-offset-2 hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      {/* ── The table ───────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <Empty filters={filters} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-default bg-bg-surface">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border-default bg-bg-subtle">
                <th scope="col" className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Select every lead on this page"
                    checked={allTicked}
                    onChange={(e) => setTicked(e.target.checked ? new Set(shown) : new Set())}
                    className="size-4 rounded border-border-default align-middle"
                  />
                </th>
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
                <Row
                  key={lead.id}
                  lead={lead}
                  nowMs={nowMs}
                  fullName={fullName}
                  ticked={ticked.has(lead.id)}
                  onTick={onTick}
                  search={search}
                />
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
  ticked,
  onTick,
  search,
}: {
  lead: CrmLeadRow;
  nowMs: number;
  fullName: string;
  ticked: boolean;
  onTick: (id: string, on: boolean) => void;
  search: URLSearchParams;
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

  /* ⚠️ THE DRAWER, NOT A PAGE. Owner: *"I don't want to go somewhere else to
     view any details."* Every cell that opens something opens it HERE, on the
     tab that matches what was clicked — the conversation opens Conversations,
     the next action opens Follow-ups. The name is the one exception and goes to
     the full record, because sometimes you do want the whole thing.

     ⚠️ Built from the CURRENT search string, so the list's filters, tab and page
     all survive the trip and are still there when the drawer closes. */
  const drawer = (tab: string) => {
    const next = new URLSearchParams(search.toString());
    next.set('lead', lead.id);
    next.set('tab', tab);
    return `/my-leads?${next.toString()}` as Route;
  };
  const href = `/leads/${lead.id}` as Route;

  return (
    <tr
      className={cn(
        'border-b border-border-subtle transition-colors last:border-b-0',
        /* ⚠️ 12%, NOT 7% — owner, 2026-09-15: *"this hover state is very light,
           right? Make it a little more prominent."* At 7% on a white ground the
           wash was under a 2% luminance shift, which is below what the eye
           reliably reads as a change while it is moving down a list. */
        'hover:bg-[color-mix(in_oklab,var(--accent-primary)_12%,transparent)]',
        ticked && 'bg-[color-mix(in_oklab,var(--accent-primary)_16%,transparent)]',
      )}
    >
      <td className="px-3 py-3 align-top">
        <input
          type="checkbox"
          checked={ticked}
          onChange={(e) => onTick(lead.id, e.target.checked)}
          aria-label={`Select ${lead.fullName ?? 'this lead'}`}
          className="mt-1 size-4 rounded border-border-default"
        />
      </td>
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
            {/* ⚠️ THE THIRD LINE, AND ONLY WHEN THERE IS ONE. Migration 150
                gave this a table; most leads still have no property matched to
                them, and an empty line under every name would put a blank row of
                space between the name and the next lead. */}
            {lead.propertyLabel && (
              <span className="mt-0.5 block truncate text-caption text-text-tertiary">
                {lead.propertyLabel}
              </span>
            )}
          </span>
        </span>
      </td>

      {/* ⚠️ A REAL SELECT, TINTED BY ITS OWN STAGE — owner: *"in the stage
          column you can see there is a dropdown… I want the same size of text,
          sleekness, and everything."* Every one is the same width, so the column
          reads as a column rather than as ten differently-sized pills.

          ⚠️ AND IT IS STILL A NAVIGATION, NOT A WRITE — for now. Changing a
          stage has to record an outcome, a note and the next action (the owner's
          Record Outcome form); a silent dropdown that only moved the stage would
          leave the timeline saying nothing about WHY. It opens the record on
          that form. The control is here because the design puts it here; the
          write is the next phase. */}
      <td className={TD}>
        <StageChooser lead={lead} search={search} />
      </td>

      {/* ── What was last said ──────────────────────────────────────────── */}
      <td className={TD}>
        {lead.lastMessageAt ? (
          <Link href={drawer('conversations')} className="flex min-w-0 items-start gap-2 text-left">
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
          </Link>
        ) : (
          <span className="text-caption text-text-tertiary">Nothing yet</span>
        )}

        {/* The live quotation, under what was said — it is the SUBJECT of the
            conversation, not a separate fact, which is why the design puts it
            here. Only the CURRENT version is read (151): showing v1's price to a
            client who has been sent v2 is the exact mistake versioning exists to
            prevent. */}
        {lead.quotationNumber && (
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-caption">
            <span
              className="rounded px-1.5 py-px font-medium"
              style={
                lead.quotationStatus === 'pending_approval'
                  ? {
                      backgroundColor: 'color-mix(in oklab, var(--gold-700) 14%, transparent)',
                      color: 'var(--gold-700)',
                    }
                  : {
                      backgroundColor:
                        'color-mix(in oklab, var(--feedback-success) 14%, transparent)',
                      color: 'var(--feedback-success)',
                    }
              }
            >
              {lead.quotationNumber}
            </span>
            {lead.quotationAmount !== null && (
              <span className="tabular-nums text-text-secondary">
                PKR {lead.quotationAmount.toLocaleString('en-PK')}
              </span>
            )}
            {lead.quotationValidUntil && (
              <span className="text-text-tertiary">
                valid till{' '}
                {new Date(lead.quotationValidUntil).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'Asia/Karachi',
                })}
              </span>
            )}
          </span>
        )}
      </td>

      {/* ── What is owed ────────────────────────────────────────────────── */}
      <td className={TD}>
        {lead.nextAction ? (
          <Link href={drawer('followups')} className="flex min-w-0 items-start gap-2 text-left">
            {/* The icon says which state this is before the words do — owner,
                2026-09-15: overdue red, WhatsApp green, a reminder blue.

                ⚠️ OVERDUE IS A WARNING TRIANGLE, NOT A RED CALENDAR. At 20px a
                calendar and a clock are the same grey rectangle, so the SHAPE
                has to carry the meaning for anybody who cannot separate the
                hues — colour alone is not a state. A paused sequence gets amber
                and its own glyph for the same reason. */}
            <span
              aria-hidden="true"
              className="mt-0.5 shrink-0"
              style={{
                color: late
                  ? 'var(--feedback-error)'
                  : lead.sequenceState === 'paused'
                    ? 'var(--gold-700)'
                    : 'var(--accent-primary)',
              }}
            >
              {late ? (
                <AlertTriangle className="size-5" />
              ) : lead.sequenceState === 'paused' ? (
                <PauseCircle className="size-5" />
              ) : (
                <CalendarDays className="size-5" />
              )}
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
              {lead.sequenceState === 'paused' && (
                <span className="mt-0.5 block text-caption font-medium text-gold-700">
                  Sequence paused
                </span>
              )}
            </span>
          </Link>
        ) : (
          <Link
            href={drawer('followups')}
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

          {/* ⚠️ BLUE, NOT GREY. Each channel wears its own colour the way the
              WhatsApp mark does — grey was reading as "disabled" on a control
              that works perfectly well. */}
          {lead.email ? (
            <Reach
              href={`mailto:${lead.email}`}
              label={`Email ${lead.fullName ?? 'lead'} at ${lead.email}`}
              tone="mail"
            >
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
            href={drawer('followups')}
            title={`Plan the next action for ${lead.fullName ?? 'this lead'} · ${phone}`}
            className="ml-0.5 inline-flex min-h-9 shrink-0 items-center rounded-lg bg-accent-primary px-3 text-body-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Follow-up
          </Link>

          <Link
            href={drawer('overview')}
            aria-label={`Open ${lead.fullName ?? 'this lead'}`}
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

/* ============================================================================
 * THE STAGE, AS A CONTROL
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-15: *"in the stage column you can see there is a dropdown. Make
 * sure the colors and the sizes are equal… I want the same size of text,
 * sleekness, and everything."*
 *
 * ⚠️ ONE WIDTH FOR EVERY ROW. A pill sized to its own word makes the column a
 * ragged edge — "New" beside "Proposal pending" beside "Won" — and the eye stops
 * reading it as a column at all. Fixed width, one type size, tinted by the
 * stage's own measured token.
 *
 * ⚠️ AND IT NAVIGATES RATHER THAN WRITING, FOR NOW. Moving a stage has to record
 * an outcome, a note and the next action — that is the owner's own Record
 * Outcome form, and it is the next phase. A select that silently changed the
 * stage would leave a timeline saying WHAT changed and never WHY, which is the
 * question the log exists to answer. So it opens the lead on that form, and the
 * control is real rather than decorative.
 * ========================================================================= */
function StageChooser({ lead, search }: { lead: CrmLeadRow; search: URLSearchParams }) {
  const router = useRouter();
  const token = stageToken(lead.stage);

  /* ⚠️ IT OPENS THE OUTCOME FORM, IT DOES NOT WRITE. Picking a stage here and
     saving it silently would leave a timeline saying WHAT changed and never WHY
     — and "why" is the question the log exists to answer. The chosen stage is
     carried through so the form opens on it. */
  const open = (stage: string) => {
    const next = new URLSearchParams(search.toString());
    next.set('lead', lead.id);
    next.set('action', 'outcome');
    if (stage !== lead.stage) next.set('stage', stage);
    router.push(`/my-leads?${next.toString()}` as Route);
  };

  return (
    <div className="relative w-[9.5rem]">
      <select
        aria-label={`Stage for ${lead.fullName ?? 'this lead'} — currently ${stageLabel(lead.stage)}`}
        value={lead.stage}
        onChange={(e) => open(e.target.value)}
        className="w-full cursor-pointer appearance-none truncate rounded-md border py-1 pl-2.5 pr-7 text-caption font-medium transition-opacity hover:opacity-85 focus:outline-none focus:ring-2"
        style={{
          backgroundColor: `color-mix(in oklab, var(--${token}) 14%, transparent)`,
          borderColor: `color-mix(in oklab, var(--${token}) 30%, transparent)`,
          color: `var(--${token})`,
        }}
      >
        {/* ⚠️ The CURRENT stage is always offered, even if it has been retired
            (149). A select whose value is not among its options renders blank in
            every browser, and the row would silently lose its stage. */}
        {!STAGE_ORDER.includes(lead.stage as (typeof STAGE_ORDER)[number]) && (
          <option value={lead.stage}>{stageLabel(lead.stage)}</option>
        )}
        {STAGE_ORDER.map((st) => (
          <option key={st} value={st}>
            {stageLabel(st)}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2"
        style={{ color: `var(--${token})` }}
      />
    </div>
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
  tone?: 'plain' | 'wa' | 'mail';
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
          : tone === 'mail'
            ? {
                backgroundColor: 'color-mix(in oklab, var(--accent-primary) 12%, transparent)',
                color: 'var(--accent-primary)',
              }
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
