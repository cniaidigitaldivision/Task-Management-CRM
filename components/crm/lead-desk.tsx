'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronDown,
  MessageCircle,
  Phone,
  Radio,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';

import { ShareOutControl } from '@/components/crm/lead-actions';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import type { CrmLeadRow, CrmProjectOption } from '@/lib/db/queries/crm-leads';
import {
  STAGE_ORDER,
  activityLabel,
  stageLabel,
  stageToken,
  temperatureLabel,
  temperatureToken,
  TEMPERATURES,
} from '@/lib/domain/crm-stages';
import { DIVISION_NAME } from '@/lib/domain/constants';
import { displayPhone, whatsAppDigits } from '@/lib/domain/phone';
import { relativeAge } from '@/lib/view/relative-age';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE LEAD DESK
 * ----------------------------------------------------------------------------
 * ── ⚠️ EVERY FILTER LIVES IN THE URL, NOT IN STATE ─────────────────────────
 * The rows are paged in SQL, so a filter held in component state would describe
 * a set the server never saw — page 2 of a filtered list would come back
 * unfiltered. Putting them in the query string means the server and the screen
 * cannot disagree, the back button works, and a filtered view is a link somebody
 * can send to the person who has to act on it.
 *
 * ── ⚠️ FOUR COLUMNS ARE EMPTY TODAY AND THAT IS NOT A BUG ──────────────────
 * Owner, temperature, next action and outcome are all null for all 615 leads,
 * because assignment and working the lead are Steps 6 and 7. They are drawn
 * anyway, with real empty states rather than blanks, because a column that
 * appears once there is data in it is a column nobody plans around. The banner
 * under the header says so in words, and removes itself the moment one lead is
 * assigned.
 *
 * ── COLUMN ORDER ───────────────────────────────────────────────────────────
 * The person first, then what is owed on them. 08-TWELVE-STEPS listed next
 * action first, following the PropForce reference; in use, the name is what the
 * eye goes to when finding a specific caller, and the SORT — not the column
 * position — is what makes this a list you work from. The sort is unchanged.
 *
 * ⚠️ NO PROJECT COLUMN. The dropdown scopes the page to one project, so it would
 * print the same value 25 times.
 * ========================================================================= */

export interface LeadFilterState {
  readonly stage: string | null;
  readonly ownerId: string | null;
  readonly temperature: string | null;
  readonly formId: string | null;
  readonly search: string | null;
  readonly from: string | null;
  readonly to: string | null;
}

interface Option {
  readonly id: string;
  readonly name: string;
  readonly leads: number;
}

export function LeadDesk({
  projects,
  selected,
  rows,
  total,
  stageCounts,
  owners,
  forms,
  page,
  perPage,
  filters,
  unassigned,
  salesTeamSize,
  canShareOut,
  nowMs,
}: {
  projects: readonly CrmProjectOption[];
  selected: CrmProjectOption | null;
  rows: readonly CrmLeadRow[];
  total: number;
  stageCounts: Record<string, number>;
  owners: readonly Option[];
  forms: readonly Option[];
  page: number;
  perPage: number;
  filters: LeadFilterState;
  /** How many leads on this project have no owner. */
  unassigned: number;
  /** How many people are in Sales — 0 means the rota has nowhere to put one. */
  salesTeamSize: number;
  /** False for a salesperson: they work leads, they do not hand them out. */
  canShareOut: boolean;
  nowMs: number;
}) {
  const router = useRouter();
  const search = useSearchParams();

  /* One helper for every control, so changing a filter keeps the others.
     ⚠️ Any filter change resets to page 1 — otherwise filtering down to four
     results while sitting on page 9 shows an empty table, which reads as a bug
     rather than as a narrow filter. The same reasoning as usePagination's
     reset, which cannot help here because the paging is done in SQL. */
  const setParam = React.useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(search.toString());
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      if (key !== 'page') next.delete('page');
      router.push(`/leads?${next.toString()}`);
    },
    [router, search],
  );

  const activeFilters = [
    filters.ownerId,
    filters.temperature,
    filters.formId,
    filters.from ?? filters.to,
  ].filter(Boolean).length;

  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-4">
      <PageHeader
        eyebrow={DIVISION_NAME}
        title="Campaign & Lead Desk"
        description="Where the people a campaign brings in are worked, from first enquiry to won or lost."
      />

      {/* ── Project, search, filters — ⚠️ no card around them, as the Studio ── */}
      <div className="flex flex-wrap items-center gap-2">
        <ProjectSelect
          projects={projects}
          selectedId={selected?.id ?? ''}
          onSelect={(id) => setParam('project', id)}
        />

        {selected?.connection === 'live' && (
          <>
            <SearchBox value={filters.search ?? ''} onSearch={(q) => setParam('q', q)} />

            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <FilterMenu
                filters={filters}
                owners={owners}
                forms={forms}
                count={activeFilters}
                onSet={setParam}
              />
            </div>
          </>
        )}
      </div>

      {selected === null ? (
        <Empty
          title="No projects are visible to you yet"
          detail="A lead belongs to a project, so there is nowhere to put one until a project exists."
        />
      ) : selected.connection !== 'live' ? (
        <NotConnected project={selected} />
      ) : (
        <>
          <StageStrip
            counts={stageCounts}
            active={filters.stage}
            onPick={(stage) => setParam('stage', filters.stage === stage ? null : stage)}
          />

          {/* ⚠️ ONLY FOR SOMEBODY WHO MAY HAND LEADS OUT. A salesperson seeing
              "312 leads have nobody working them" would be told about work they
              cannot take — which reads as a queue they are being blamed for. */}
          {canShareOut && selected && (
            <ShareOutControl
              projectId={selected.id}
              unassigned={unassigned}
              salesTeam={salesTeamSize}
            />
          )}

          {/* ⚠️ THE LIST'S OWN QUERY STRING TRAVELS WITH EVERY ROW. A lead
              opened from page 9 of a filtered list has to come back to page 9
              of that filtered list — see `backToDesk` in the detail route.
              Read from the URL rather than rebuilt from `filters`, so a
              parameter this component does not model still survives the trip. */}
          {/* ⚠️ THE SAME TABLE FOR BOTH VIEWS. A salesperson's list is this one
              narrowed by migration 118's policy, not a second component — which
              is what stops the two drifting apart, and the reason
              08-TWELVE-STEPS asked for one component and two scopes. */}
          <LeadTable rows={rows} nowMs={nowMs} from={search.toString()} />

          {rows.length === 0 && !canShareOut && total === 0 && (
            <p className="text-caption leading-relaxed text-text-secondary">
              Nothing has been given to you yet. Leads are shared out by the sales manager, and you
              will get a notification the moment one is yours.
            </p>
          )}

          <Pagination
            page={page}
            pageCount={pageCount}
            onPage={(n) => setParam('page', String(n))}
            from={from}
            to={from === 0 ? 0 : from + rows.length - 1}
            total={total}
            label="leads"
          />
        </>
      )}
    </div>
  );
}

/* ---- The project dropdown ------------------------------------------------ */

/**
 * ⚠️ EVERY PROJECT, EACH CARRYING ITS OWN STATE — see the page's header. The
 * suffix is what makes the scope visible: a reader can see that their client is
 * known to the system and simply not connected yet, which is a different fact
 * from being absent.
 */
function ProjectSelect({
  projects,
  selectedId,
  onSelect,
}: {
  projects: readonly CrmProjectOption[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="relative">
      <select
        aria-label="Project"
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        className="min-h-[2.6rem] min-w-[16rem] cursor-pointer appearance-none rounded-xl border border-border-subtle bg-bg-surface px-3 pr-9 text-body-sm font-medium text-text-primary transition-colors hover:border-border-default focus:border-accent-primary focus:outline-none"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.connection === 'live'
              ? ` — ${p.leads} leads`
              : p.connection === 'no-leads-yet'
                ? ' — no leads yet'
                : ' — not connected'}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
        aria-hidden="true"
      />
    </div>
  );
}

/* ---- Search -------------------------------------------------------------- */

/**
 * ⚠️ SUBMITS, RATHER THAN SEARCHING AS YOU TYPE. Each search is a round trip to
 * a paged SQL query; a keystroke-triggered one would fire a query per letter and
 * race its own results back onto the screen out of order. Enter, or the clear
 * button.
 */
function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [draft, setDraft] = React.useState(value);

  /* The URL is the source of truth: a back button or a cleared filter has to be
     reflected here. Compared against the prop rather than synced in an effect,
     which would paint the stale value once first. */
  const [lastValue, setLastValue] = React.useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(value);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(draft.trim());
      }}
      className="relative"
    >
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
        aria-hidden="true"
      />
      <input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Name or phone number…"
        aria-label="Search leads by name or phone number"
        className="min-h-[2.6rem] w-[16rem] rounded-xl border border-border-subtle bg-bg-surface pl-9 pr-9 text-body-sm text-text-primary transition-colors placeholder:text-text-tertiary hover:border-border-default focus:border-accent-primary focus:outline-none"
      />
      {value !== '' && (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            onSearch('');
          }}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-md text-text-tertiary transition-colors hover:bg-bg-subtle hover:text-text-primary"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </form>
  );
}

/* ---- Filters ------------------------------------------------------------- */

function FilterMenu({
  filters,
  owners,
  forms,
  count,
  onSet,
}: {
  filters: LeadFilterState;
  owners: readonly Option[];
  forms: readonly Option[];
  count: number;
  onSet: (key: string, value: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  /* Close on an outside click or Escape — a menu that only closes by
     reselecting is the kind of thing people report as "it got stuck". */
  React.useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex min-h-[2.6rem] items-center gap-1.5 rounded-xl border bg-bg-surface px-3 text-micro font-medium text-text-primary transition-colors',
          open ? 'border-border-strong' : 'border-border-subtle hover:border-border-default',
        )}
      >
        <SlidersHorizontal className="size-4 text-text-tertiary" aria-hidden="true" />
        Filters
        {count > 0 && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold"
            style={{ backgroundColor: 'var(--chart-1-wash)', color: 'var(--chart-1)' }}
          >
            {count}
          </span>
        )}
        <ChevronDown
          className={cn(
            'size-3.5 text-text-tertiary transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1.5 max-h-[70vh] w-[18rem] overflow-y-auto rounded-xl border border-border-default bg-bg-surface py-1 shadow-[0_8px_28px_rgb(6_35_42_/_0.14)]"
        >
          <Section label="Temperature">
            <Choice
              selected={filters.temperature === null}
              onClick={() => onSet('temp', null)}
              label="Any"
            />
            {TEMPERATURES.map((t) => (
              <Choice
                key={t}
                selected={filters.temperature === t}
                onClick={() => onSet('temp', t)}
                label={temperatureLabel(t)}
              />
            ))}
          </Section>

          {/* ⚠️ Rendered only when somebody owns something. An "Owner: Any" menu
              with no names under it invites the reader to look for the list that
              is missing, when the truth is that nothing is assigned yet. */}
          {owners.length > 0 && (
            <Section label="Owner">
              <Choice
                selected={filters.ownerId === null}
                onClick={() => onSet('owner', null)}
                label="Anyone"
              />
              {owners.map((o) => (
                <Choice
                  key={o.id}
                  selected={filters.ownerId === o.id}
                  onClick={() => onSet('owner', o.id)}
                  label={o.name}
                  count={o.leads}
                />
              ))}
            </Section>
          )}

          {forms.length > 0 && (
            /* ⚠️ FORM, NOT CAMPAIGN, and the label says so. No lead carries a
               campaign yet — the import reads forms, and linking them to the
               campaigns that paid for them is Step 8. Labelling this "Campaign"
               would put a word on screen that the numbers underneath do not
               support, which is exactly how spend gets judged by the wrong
               figure. */
            <Section label="Form">
              <Choice
                selected={filters.formId === null}
                onClick={() => onSet('form', null)}
                label="All forms"
              />
              {forms.map((f) => (
                <Choice
                  key={f.id}
                  selected={filters.formId === f.id}
                  onClick={() => onSet('form', f.id)}
                  label={f.name}
                  count={f.leads}
                />
              ))}
            </Section>
          )}

          <Section label="Enquired between">
            <div className="flex items-center gap-1.5 px-3 pb-2 pt-1">
              <input
                type="date"
                aria-label="From date"
                value={filters.from ?? ''}
                onChange={(e) => onSet('from', e.target.value || null)}
                className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-bg-surface px-2 py-1 text-micro text-text-primary focus:border-accent-primary focus:outline-none"
              />
              <span className="text-micro text-text-tertiary">to</span>
              <input
                type="date"
                aria-label="To date"
                value={filters.to ?? ''}
                onChange={(e) => onSet('to', e.target.value || null)}
                className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-bg-surface px-2 py-1 text-micro text-text-primary focus:border-accent-primary focus:outline-none"
              />
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border-subtle pb-1 last:border-b-0">
      <p className="px-3 pb-1 pt-2 text-[0.62rem] font-semibold uppercase tracking-wide text-text-tertiary">
        {label}
      </p>
      {children}
    </div>
  );
}

function Choice({
  label,
  selected,
  count,
  onClick,
}: {
  label: string;
  selected: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-micro transition-colors',
        selected
          ? 'font-semibold text-text-primary'
          : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="tabular-nums text-text-tertiary">{count}</span>
      )}
      {selected && <span aria-hidden="true" className="text-text-brand">✓</span>}
    </button>
  );
}

/* ---- The stage strip ----------------------------------------------------- */

/**
 * The funnel, left to right, doubling as the stage filter.
 *
 * ⚠️ EVERY STAGE IS SHOWN, INCLUDING THE EMPTY ONES. Drawing only the stages
 * that hold leads would make a pipeline of 615 New leads look like a complete
 * one, and the shape of the funnel — the thing this strip exists to show — is
 * carried by the gaps as much as by the numbers.
 *
 * ⚠️ AND AN EMPTY STAGE IS NOT DIMMED. It was, with `opacity-55`, until the
 * contrast was measured: **2.42:1 in light, 3.42:1 in dark**, on a 10px label,
 * against a 4.5:1 floor. These chips are BUTTONS — clicking "Qualified 0" filters
 * to it — so a control nobody can read is worse than a loud one. The zero is
 * signal enough on its own; it needs no help from opacity.
 */
function StageStrip({
  counts,
  active,
  onPick,
}: {
  counts: Record<string, number>;
  active: string | null;
  onPick: (stage: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {STAGE_ORDER.map((stage) => {
        const n = counts[stage] ?? 0;
        const on = active === stage;
        return (
          <button
            key={stage}
            type="button"
            onClick={() => onPick(stage)}
            aria-pressed={on}
            className={cn(
              'flex min-w-[6.5rem] flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors',
              on ? 'border-border-strong bg-bg-subtle' : 'border-border-subtle bg-bg-surface hover:border-border-default',
            )}
          >
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{ backgroundColor: `var(--${stageToken(stage)})` }}
              />
              <span className="text-[0.62rem] font-medium text-text-secondary">
                {stageLabel(stage)}
              </span>
            </span>
            {/* The empty stages read quieter through the COUNT's ink, which stays
                above the contrast floor, rather than through opacity on the whole
                chip, which did not. */}
            <span
              className={cn(
                'text-body font-semibold tabular-nums',
                n === 0 ? 'text-text-secondary' : 'text-text-primary',
              )}
            >
              {n}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---- The table ----------------------------------------------------------- */

function LeadTable({
  rows,
  nowMs,
  from,
}: {
  rows: readonly CrmLeadRow[];
  nowMs: number;
  from: string;
}) {
  if (rows.length === 0) {
    return (
      <Empty
        title="No leads match these filters"
        detail="Clear a filter, or widen the dates. Nothing has been deleted — the counts above show the whole project."
      />
    );
  }

  return (
    /* ⚠️ The scroll lives on this wrapper, not on the page. A table this wide
       would otherwise scroll the whole document sideways on a laptop, taking the
       sidebar with it. */
    <div className="overflow-x-auto rounded-xl border border-border-default bg-bg-surface">
      <table className="w-full min-w-[62rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-border-default bg-bg-subtle">
            <Th>Lead</Th>
            <Th>Next action</Th>
            <Th>Stage</Th>
            <Th>Temp.</Th>
            <Th>Last outcome</Th>
            <Th>Owner</Th>
            <Th>Came from</Th>
            <Th>Reach them</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((lead) => (
            <Row key={lead.id} lead={lead} nowMs={nowMs} from={from} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ lead, nowMs, from }: { lead: CrmLeadRow; nowMs: number; from: string }) {
  const phone = displayPhone(lead.phoneE164, lead.phone);
  const wa = whatsAppDigits(lead.phoneE164 ?? lead.phone);

  return (
    <tr className="border-b border-border-subtle last:border-b-0 hover:bg-bg-subtle/60">
      {/* ── The person ─────────────────────────────────────────────────── */}
      <td className={TD}>
        {/* ⚠️ THE NAME IS THE LINK, NOT THE WHOLE ROW. A clickable `<tr>` needs
            a click handler, which gives a keyboard user nothing to tab to and
            steals the text selection from anybody copying a phone number out of
            the cell below. An anchor is reachable, focusable, opens in a new tab
            with a middle click, and shows its destination in the status bar. */}
        <Link
          href={`/leads/${lead.id}${from ? `?from=${encodeURIComponent(from)}` : ''}`}
          className="block truncate text-body-sm font-semibold text-text-primary underline-offset-2 hover:text-text-brand hover:underline"
        >
          {lead.fullName ?? 'Name not given'}
        </Link>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-caption text-text-secondary">
          <span className="tabular-nums">{phone}</span>
          {lead.city && (
            <>
              <span aria-hidden="true" className="text-text-disabled">
                ·
              </span>
              <span>{lead.city}</span>
            </>
          )}
          <span aria-hidden="true" className="text-text-disabled">
            ·
          </span>
          {/* ⚠️ WHEN THEY ENQUIRED, not when we imported them. A backlog pulled
              in one afternoon would otherwise show 615 leads all "2h ago", and
              response time is the number this desk exists to improve. */}
          <time
            dateTime={lead.submittedAt}
            title={new Date(lead.submittedAt).toLocaleString('en-GB', {
              timeZone: 'Asia/Karachi',
            })}
            className="text-text-tertiary"
          >
            {relativeAge(lead.submittedAt, nowMs)}
          </time>
        </span>
      </td>

      {/* ── What is owed ───────────────────────────────────────────────── */}
      <td className={TD}>
        {lead.nextAction ? (
          <>
            <span className="block truncate text-body-sm text-text-primary">{lead.nextAction}</span>
            {lead.nextActionAt && (
              <span
                className={cn(
                  'mt-0.5 block text-caption tabular-nums',
                  Date.parse(lead.nextActionAt) < nowMs
                    ? 'font-semibold text-feedback-error'
                    : 'text-text-secondary',
                )}
              >
                {Date.parse(lead.nextActionAt) < nowMs ? 'Overdue · ' : 'Due · '}
                {new Date(lead.nextActionAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'Asia/Karachi',
                })}
              </span>
            )}
          </>
        ) : (
          <Nothing>Not set</Nothing>
        )}
      </td>

      <td className={TD}>
        <Badge token={stageToken(lead.stage)} size="sm">
          {stageLabel(lead.stage)}
        </Badge>
      </td>

      <td className={TD}>
        {lead.temperature ? (
          <Badge token={temperatureToken(lead.temperature)} size="sm">
            {temperatureLabel(lead.temperature)}
          </Badge>
        ) : (
          <Nothing>—</Nothing>
        )}
      </td>

      {/* ── The last thing that happened ───────────────────────────────── */}
      <td className={TD}>
        {lead.lastActivityKind ? (
          <>
            <span className="block text-body-sm text-text-primary">
              {activityLabel(lead.lastActivityKind)}
            </span>
            <span className="mt-0.5 block text-caption text-text-tertiary">
              {relativeAge(lead.lastActivityAt, nowMs)}
              {lead.noteCount > 0 && ` · ${lead.noteCount} note${lead.noteCount === 1 ? '' : 's'}`}
            </span>
          </>
        ) : (
          <Nothing>Nothing yet</Nothing>
        )}
      </td>

      <td className={TD}>
        {lead.ownerName ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={lead.ownerName} size="xs" />
            <span className="truncate text-body-sm text-text-primary">{lead.ownerName}</span>
          </span>
        ) : (
          <Nothing>Unassigned</Nothing>
        )}
      </td>

      <td className={TD}>
        <span className="block truncate text-caption text-text-secondary">
          {lead.campaignName ?? lead.formName ?? '—'}
        </span>
        {lead.campaignName && lead.formName && (
          <span className="mt-0.5 block truncate text-micro text-text-tertiary">
            {lead.formName}
          </span>
        )}
      </td>

      {/* ── ⚠️ LINKS, NOT ACTIONS ──────────────────────────────────────────
          `tel:` and `wa.me` hand the number to the device and record nothing.
          Logging the attempt is Step 6, and a button that looked like it logged
          a call while logging nothing would make the activity timeline lie about
          work that was actually done. These are marked as what they are. */}
      <td className={TD}>
        <span className="flex items-center gap-1">
          {lead.phoneE164 ? (
            <>
              <ReachLink href={`tel:${lead.phoneE164}`} label={`Call ${lead.fullName ?? 'lead'}`}>
                <Phone className="size-3.5" aria-hidden="true" />
              </ReachLink>
              {wa && (
                <ReachLink
                  href={`https://wa.me/${wa}`}
                  external
                  label={`WhatsApp ${lead.fullName ?? 'lead'}`}
                >
                  <MessageCircle className="size-3.5" aria-hidden="true" />
                </ReachLink>
              )}
            </>
          ) : (
            /* ⚠️ Three of the 615 have a number that could not be parsed with
               confidence. The raw value is still shown in the Lead column — what
               is refused is a tel: link built from a guess, which would ring a
               stranger.

               Secondary ink for the same reason as `Nothing`: this is the cell's
               value, not a placeholder. */
            <Nothing>No usable number</Nothing>
          )}
        </span>
      </td>
    </tr>
  );
}

function ReachLink({
  href,
  label,
  external,
  children,
}: {
  href: string;
  label: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="grid size-7 place-items-center rounded-lg border border-border-subtle text-text-secondary transition-colors hover:border-border-default hover:bg-bg-subtle hover:text-text-primary"
    >
      {children}
    </a>
  );
}

/* ---- Empty states -------------------------------------------------------- */

/**
 * "Unassigned", "Not set", "Nothing yet", "No usable number".
 *
 * ⚠️ SECONDARY INK, NOT TERTIARY. These read like placeholders but they are the
 * cell's actual value — an unassigned lead is a fact somebody acts on. Measured
 * on the rendered page: tertiary gives **3.94:1 in light**, under the 4.5:1
 * floor for text this size; secondary gives 6.42:1. Relative ages stay tertiary,
 * because those genuinely are secondary to the row.
 */
function Nothing({ children }: { children: React.ReactNode }) {
  return <span className="text-caption text-text-secondary">{children}</span>;
}

/**
 * ⚠️ THE HONEST STATE, WITH THE REASON. "Not connected" and "connected but no
 * leads yet" send a reader to two different places — one to Meta to link a form,
 * one to nowhere at all. Collapsing them is what makes somebody redo setup that
 * was already done.
 */
function NotConnected({ project }: { project: CrmProjectOption }) {
  const waiting = project.connection === 'no-leads-yet';

  return (
    <Empty
      title={waiting ? `${project.name} has no leads yet` : `${project.name} is not connected`}
      detail={
        waiting
          ? `${project.forms} lead ${project.forms === 1 ? 'form is' : 'forms are'} linked and the import runs every fifteen minutes. Nothing has come through them yet, so there is nothing to show — this fills in on its own.`
          : 'No Meta lead form is linked to this project, so no leads can arrive. Chitral Royal Homes is the one project connected today; the rest follow one at a time, and nothing here needs changing to add them.'
      }
    />
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="rounded-2xl border border-dashed border-border-default bg-bg-surface px-6 py-10 text-center">
      <span
        aria-hidden="true"
        className="mx-auto grid size-11 place-items-center rounded-xl"
        style={{
          backgroundColor:
            'color-mix(in oklab, var(--accent-primary) var(--tint-medium), var(--bg-surface))',
          color: 'var(--accent-primary)',
        }}
      >
        <Radio className="size-5" strokeWidth={2} />
      </span>
      <h2 className="mt-3 text-h3 font-semibold text-text-primary">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-body-sm leading-relaxed text-text-secondary">
        {detail}
      </p>
    </section>
  );
}

/* ---- Table parts --------------------------------------------------------- */

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-3 py-2.5 text-caption font-medium text-text-secondary">
      {children}
    </th>
  );
}

const TD = 'max-w-[16rem] px-3 py-2.5 align-middle';
