'use client';

import * as React from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlarmClock,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  Columns3,
  Mail,
  MoreVertical,
  Plus,
  Table2,
  FileQuestion,
  Users,
  Phone,
  Radio,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';

import { ShareOutControl } from '@/components/crm/lead-actions';
import { SalesTeamPanel } from '@/components/crm/sales-team';
import { useToast } from '@/components/ui/toast';
import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
/* ⚠️⚠️ TEMPORARY — delete with the block that uses it. See below. */
import { TestLeadButton } from '@/components/crm/test-lead-modal';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import type {
  CrmDueCounts,
  CrmLeadRow,
  CrmProjectOption,
  CrmSalesPerson,
} from '@/lib/db/queries/crm-leads';
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
  /** Step 8: `overdue` · `today` · `no-plan` · `waiting`, or null for all. */
  readonly due: string | null;
  /** ⚠️ `board` or null. In the URL rather than in state so "look at this"
   *  arrives on the view the sender was looking at, and so a filter change does
   *  not silently drop somebody back to the table. */
  readonly view: string | null;
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
  due,
  salesTeam,
  canShareOut,
  allProjects,
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
  /** What is owed — narrowed by RLS, so it means "mine" for a salesperson. */
  due: CrmDueCounts;
  /** ⚠️ EMPTY FOR A SALESPERSON, by migration 120's guard inside
   *  `crm_sales_roster()` — colleagues' response times are the manager's view. */
  salesTeam: readonly CrmSalesPerson[];
  /** False for a salesperson: they work leads, they do not hand them out. */
  canShareOut: boolean;
  /** Whether the SELECTED project has a WhatsApp number of its own. */
  /** True when the reader chose "All projects". Decides whether the page can
   *  talk about one project's name, number or roster at all. */
  allProjects: boolean;
  nowMs: number;
}) {
  const router = useRouter();
  /* ⚠️ READ OFF THE ROWS, not off a page-wide flag — since "All projects" the
     desk can hold leads from several projects and only some of them have a
     number. This line says "at least one lead here can be messaged", which is
     the honest claim; each row's own control says the rest. */
  const anyCanWhatsApp = rows.some((r) => r.canWhatsApp);
  const search = useSearchParams();

  /* One helper for every control, so changing a filter keeps the others.
     ⚠️ Any filter change resets to page 1 — otherwise filtering down to four
     results while sitting on page 9 shows an empty table, which reads as a bug
     rather than as a narrow filter. The same reasoning as usePagination's
     reset, which cannot help here because the paging is done in SQL. */
  /* ⚠️ THE ROUND TRIP IS REAL, THE SILENCE IS NOT — Rule Zero, §3.4 of
     docs/20-UI-RESPONSIVENESS.md. A filter genuinely has to ask the database for
     different rows; what it must not do is sit there looking like nothing
     happened, which is what makes somebody click it a second time. */
  const [pending, startTransition] = React.useTransition();

  const setParam = React.useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(search.toString());
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      if (key !== 'page') next.delete('page');
      startTransition(() => {
        router.push(`/leads?${next.toString()}`);
      });
    },
    [router, search],
  );

  /* ── ⚠️ TABLE OR BOARD IS NOT A QUERY ────────────────────────────────────
     `view` never reaches SQL — checked, it is read once in the page to build
     `filters` and no reader looks at it. Both arrangements are drawn from the
     SAME rows, which are already here. So the old toggle spent a full server
     render fetching identical data to rearrange it, and the button did not
     even highlight until Singapore answered.

     The comment this replaces was right about WHY the URL should hold it — a
     salesperson sending "look at this" wants the other person to land on the
     same view, and it must survive a filter change. That is law 2: the URL
     RECORDS the view, it does not decide when the view changes. */
  const urlView = search.get('view') === 'board' ? 'board' : 'table';
  const [viewWish, setViewWish] = React.useState<'table' | 'board' | undefined>(undefined);
  if (viewWish !== undefined && viewWish === urlView) setViewWish(undefined);
  const view = viewWish ?? urlView;

  /* ── ⚠️ THE CATEGORY NARROWS THE CARDS IN THIS FRAME ─────────────────────
     Owner, 2026-09-15, on the board: *"I want to show all the card categories
     above and when I click one, only those categories will be visible."*

     Two things have to be true at once, and only one of them is free:

       · the CARDS must narrow instantly — they are already on the page
       · the COUNTS and the PAGING must stay truthful, and those are the
         server's, because a page holds ten leads and a stage may hold forty

     So the chip applies twice: once here, against the rows already in hand, and
     once through the URL so the next page of that stage is the right one. Law 2
     again — the URL records the choice, it does not decide when it takes
     effect. */
  const urlStage = search.get('stage');
  const [stageWish, setStageWish] = React.useState<string | null | undefined>(undefined);
  if (stageWish !== undefined && stageWish === urlStage) setStageWish(undefined);
  const activeStage = stageWish === undefined ? urlStage : stageWish;

  const pickStage = (stage: string | null) => {
    /* Pressing the active one again clears it — the chips are a filter, not a
       radio group you can get stuck inside. */
    const next = activeStage === stage ? null : stage;
    setStageWish(next);
    startTransition(() => {
      const q = new URLSearchParams(search.toString());
      if (next) q.set('stage', next);
      else q.delete('stage');
      q.delete('page');
      router.push(`/leads?${q.toString()}`);
    });
  };

  const setView = (next: 'table' | 'board') => {
    setViewWish(next);
    startTransition(() => {
      const q = new URLSearchParams(search.toString());
      if (next === 'board') q.set('view', 'board');
      else q.delete('view');
      router.replace(`/leads?${q.toString()}`);
    });
  };

  const activeFilters = [
    filters.ownerId,
    filters.temperature,
    filters.formId,
    filters.from ?? filters.to,
    /* ⚠️ The due strip is its own control, but it narrows the table like any
       other filter and the count has to say so — otherwise "Filters 2" above a
       list cut down by a third reads as a bug. */
    filters.due,
  ].filter(Boolean).length;

  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-4">
      <PageHeader
        eyebrow={DIVISION_NAME}
        title="Campaign & Lead Desk"
        /* The supplied design's wording, and it is better: it names the three
           things this screen is for rather than describing the lifecycle. */
        description="Manage enquiries, conversations and the next follow-up."
        /* ⚠️ BOTH ARE REAL, AND NEITHER IS NEW MACHINERY. "Add lead" is the test
            form on the demo project and a link to the record elsewhere; "New
            follow-up" opens the desk already filtered to what has no plan, which
            is exactly the queue somebody pressing it wants. A button that opened
            an empty dialog to invent a lead from nothing would be the one thing
            on this page with no data behind it. */
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {selected?.name.endsWith('[demo]') ? (
              <TestLeadButton projectId={selected.id} />
            ) : null}
            <button
              type="button"
              onClick={() => setParam('due', 'no-plan')}
              className="inline-flex min-h-[2.4rem] items-center gap-1.5 rounded-xl bg-accent-primary px-3 text-body-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              <Plus className="size-4" aria-hidden="true" />
              New follow-up
            </button>
          </div>
        }
      />

      {selected === null && !allProjects ? (
        <Empty
          title="No projects are visible to you yet"
          detail="A lead belongs to a project, so there is nowhere to put one until a project exists."
        />
      ) : selected !== null && selected.connection !== 'live' ? (
        <NotConnected project={selected} />
      ) : (
        <>
          {/* ⚠️ ABOVE EVERYTHING, because it is the only thing on this page
              that is about TIME rather than about position in the funnel — and
              time is what a salesperson opens the desk to check.

              ⚠️ AND THEY ARE FILTERS, NOT DECORATION. Every figure here is a
              button that narrows the list to exactly the rows it counted. A
              dashboard tile that states a number somebody then has to go and
              find by hand is the shape this deliberately is not. */}
          <DueCards
            total={total}
            due={due}
            active={filters.due}
            onPick={(v) => setParam('due', v)}
          />

          {/* ── Project, search, filters — ⚠️ no card around them, as the Studio ── */}
          <div className="flex flex-wrap items-center gap-2">
            <ProjectSelect
              projects={projects}
              selectedId={allProjects ? 'all' : (selected?.id ?? '')}
              onSelect={(id) => setParam('project', id)}
            />

            {selected?.connection === 'live' && (
              <>
                <SearchBox value={filters.search ?? ''} onSearch={(q) => setParam('q', q)} />

                    {/* ⚠️ OWNER IS OUT HERE, NOT ONLY INSIDE `Filters`. It is still in
                    the menu too, and that is on purpose rather than a duplicate: the
                    menu is where somebody assembles a query, and this is the one
                    dimension a manager flips through all day — "show me Sara's, now
                    show me Omar's". A filter you change twenty times a session does
                    not belong two clicks deep.

                    ⚠️ EMPTY FOR A SALESPERSON, and it disappears rather than
                    offering them a list of one. Migration 120's guard returns them
                    an empty roster; this reads that rather than re-deciding it. */}
                {owners.length > 0 && (
                  <OwnerSelect
                    owners={owners}
                    selectedId={filters.ownerId ?? ''}
                    onSelect={(id) => setParam('owner', id || null)}
                  />
                )}

                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                      {/* ⚠️⚠️ TEMPORARY — DELETE WITH ITS IMPORT, `components/crm/
                      test-lead-modal.tsx` AND `app/actions/crm-test-lead.ts` WHEN
                      THE TESTING IS DONE. Owner, 2026-09-12: "I will remove this
                      once I make sure that the system is working smartly."

                      Moved up here 2026-09-14: it used to sit alone on a line of its
                      own between the chips and the table, which in the owner's own
                      screenshot is the widest piece of empty space on the page. Only
                      on the demo project, and the SERVER re-checks that on every
                      call — a hidden button is not a permission. */}
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


          <div className="flex flex-wrap items-center justify-between gap-2">
            <ViewTabs
              total={total}
              due={due}
              waiting={due.waitingForReply}
              active={filters.due}
              onPick={(v) => setParam('due', v)}
            />

            {/* ⚠️ BOTH VIEWS ARE REAL NOW. Owner, 2026-09-14: *"Table view is
                working but board view is not working. Board view should be
                working."* Quite right — it was drawn and inert.

                ⚠️ THE CHOICE LIVES IN THE URL, not in component state. A
                salesperson who sends "look at this" wants the other person to
                land on the same view, and a `useState` here would lose the
                board on every filter change. */}
            <div className="flex items-center gap-1 rounded-lg border border-border-subtle bg-bg-surface p-0.5">
              {(
                [
                  { key: 'table', label: 'Table', icon: Table2 },
                  { key: 'board', label: 'Board', icon: Columns3 },
                ] as const
              ).map((v) => {
                const on = view === v.key;
                const Icon = v.icon;
                return (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setView(v.key)}
                    aria-pressed={on}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-caption font-medium transition-colors',
                      on
                        ? 'bg-accent-primary text-white'
                        : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary',
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {v.label}
                  </button>
                );
              })}
            </div>
          </div>

          <StageStrip
            counts={stageCounts}
            active={activeStage}
            onPick={pickStage}
            total={total}
          />

          {/* ⚠️⚠️ TEMPORARY — DELETE THIS BLOCK, ITS IMPORT, `components/crm/
              test-lead-modal.tsx` AND `app/actions/crm-test-lead.ts` WHEN THE
              TESTING IS DONE. Owner, 2026-09-12: "I will remove this once I make
              sure that the thing or the system is working smartly."

              Only on the demo project, and the SERVER re-checks that on every
              call — a hidden button is not a permission. */}
          {/* ⚠️ ONLY FOR SOMEBODY WHO MAY HAND LEADS OUT. A salesperson seeing
              "312 leads have nobody working them" would be told about work they
              cannot take — which reads as a queue they are being blamed for. */}
          {canShareOut && selected && (
            <ShareOutControl
              projectId={selected.id}
              unassigned={unassigned}
              salesTeam={salesTeam.filter((p) => !p.isManager).length}
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
          {/* ⚠️ DIMMED WHILE THE NEXT ROWS ARE IN FLIGHT, never blanked. What is
              on screen is still the truthful answer to the previous question;
              swapping it for grey bars trades something readable for something
              that is not. §3.4 of docs/20-UI-RESPONSIVENESS.md. */}
          <div
            className={cn('transition-opacity', pending && 'pointer-events-none opacity-50')}
            aria-busy={pending}
          >
            {view === 'board' ? (
              <LeadBoard
                rows={rows}
                nowMs={nowMs}
                from={search.toString()}
                activeStage={activeStage}
              />
            ) : (
              <LeadTable
                rows={rows}
                nowMs={nowMs}
                from={search.toString()}
              />
            )}
          </div>

          {rows.length === 0 && !canShareOut && total === 0 && (
            <p className="text-caption leading-relaxed text-text-secondary">
              Nothing has been given to you yet. Leads are shared out by the sales manager, and you
              will get a notification the moment one is yours.
            </p>
          )}

          {/* ⚠️ BELOW THE LIST, not above it. The desk exists to be worked from;
              the team's figures are what a manager checks afterwards, and putting
              them first would push the leads themselves below the fold on the one
              screen somebody opens between two calls. */}
          {canShareOut && <SalesTeamPanel team={salesTeam} nowMs={nowMs} />}

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
            {/* ⚠️ ONE CHANNEL, NOT TWO. The mockup this was drawn from shows
                "Email connected" beside it; there is no email integration, so
                claiming one would be a green dot that means nothing. WhatsApp is
                real and per-project (139), which is why it can say so. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-text-secondary">
              {/* ⚠️ EMAIL IS GREY AND SAYS SO. There is no email integration —
                  the controls above are `mailto:` links, which is the reader's
                  own client, not ours. A green dot here would be the one claim
                  on this page that nothing backs. */}
              <span className="flex items-center gap-1.5" title="No email integration — the email buttons open your own mail client.">
                <Mail className="size-3.5 text-text-disabled" aria-hidden="true" />
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: 'var(--text-disabled)' }}
                />
                Email not connected
              </span>

              <span className="flex items-center gap-1.5">
                <span style={{ color: anyCanWhatsApp ? WA_GREEN : 'var(--text-disabled)' }}>
                  <WhatsAppMark className="size-3.5" />
                </span>
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: anyCanWhatsApp ? WA_GREEN : 'var(--text-disabled)' }}
                />
                {anyCanWhatsApp ? 'WhatsApp connected' : 'WhatsApp not connected'}
              </span>

              {/* ⚠️ THE TIMEZONE IS NAMED, and that is not decoration: every date
                  on this page is rendered in Asia/Karachi rather than the
                  reader's own, and for five hours each evening those are
                  different days. */}
              <span className="tabular-nums text-text-tertiary">
                {new Date(nowMs).toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'Asia/Karachi',
                })}{' '}
                · Asia/Karachi
              </span>
            </div>
          </div>
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
function OwnerSelect({
  owners,
  selectedId,
  onSelect,
}: {
  owners: readonly Option[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="relative">
      <select
        aria-label="Owner"
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        className="min-h-[2.6rem] min-w-[11rem] cursor-pointer appearance-none rounded-xl border border-border-subtle bg-bg-surface px-3 pr-9 text-body-sm font-medium text-text-primary transition-colors hover:border-border-default focus:border-accent-primary focus:outline-none"
      >
        <option value="">All owners</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} ({o.leads})
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
        {/* ⚠️ EVERY PROJECT AT ONCE, and it is a real query rather than a
            client-side merge — the counts, the stage strip and the pages all
            come back for the whole set. RLS narrows it exactly as it narrows one
            project, so a salesperson choosing this still sees only their own
            leads, across whichever projects those sit on. */}
        <option value="all">All projects</option>
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

/* ---- What is owed -------------------------------------------------------- */

/**
 * Overdue, due today, and nothing planned — Step 8.
 *
 * ⚠️ IT DISAPPEARS WHEN THERE IS NOTHING TO SAY. A row of three zeroes above
 * every lead list is furniture, and furniture is what people stop reading. The
 * strip earns its place only on the days it has something on it.
 *
 * ⚠️ AND "NOTHING PLANNED" IS NOT AN ALARM. A lead somebody was given this
 * morning has no next action and should not; it is here because a lead that has
 * been owned for a fortnight with no plan is the one that quietly dies, and
 * there is no other screen that would show it.
 */
/* ============================================================================
 * THE FOUR FIGURES, AS CARDS — the desk's redesign, 2026-09-14
 * ----------------------------------------------------------------------------
 * ⚠️ EVERY CARD IS A FILTER, NOT A TILE. Pressing one narrows the list to
 * exactly the rows it counted, and pressing it again clears it. A figure that
 * somebody then has to go and reproduce by hand is the shape this is not — and
 * it is why the active card is outlined rather than merely tinted: a filter
 * that is on has to be obvious, or the next reader thinks the desk is empty.
 *
 * ⚠️ AND THE COUNTS ARE RLS-NARROWED, SO THEY MEAN "MINE" FOR A SALESPERSON
 * and "the project's" for a manager. Same numbers the list is drawn from, from
 * the same query — never a second count that can disagree with the rows under it.
 * ========================================================================= */
function DueCards({
  total,
  due,
  active,
  onPick,
}: {
  total: number;
  due: CrmDueCounts;
  active: string | null;
  onPick: (value: string | null) => void;
}) {
  const cards = [
    {
      key: null as string | null,
      label: 'Total leads',
      value: total,
      icon: Users,
      token: 'accent-primary',
    },
    {
      key: 'overdue',
      label: 'Overdue follow-ups',
      value: due.overdue,
      icon: AlarmClock,
      token: 'feedback-error',
    },
    {
      key: 'today',
      label: 'Due today',
      value: due.dueToday,
      icon: CalendarDays,
      token: 'accent-primary',
    },
    {
      key: 'no-plan',
      label: 'No next action',
      value: due.noPlan,
      icon: FileQuestion,
      token: 'text-secondary',
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => {
        const on = active === c.key && !(c.key === null && active === null);
        const Icon = c.icon;
        return (
          <button
            key={c.label}
            type="button"
            onClick={() => onPick(active === c.key ? null : c.key)}
            aria-pressed={on}
            className={cn(
              'flex items-center gap-3 rounded-2xl border bg-bg-surface px-4 py-3.5 text-left transition-colors',
              on
                ? 'border-accent-primary ring-1 ring-accent-primary'
                : 'border-border-subtle hover:border-border-default',
            )}
          >
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-full"
              /* ⚠️ A TINT OF THE TOKEN, not a second hardcoded palette. 12% keeps
                 the circle readable in both themes — a fixed light fill goes
                 invisible on the dark ground. */
              style={{
                backgroundColor: `color-mix(in oklab, var(--${c.token}) 12%, transparent)`,
                color: `var(--${c.token})`,
              }}
            >
              <Icon className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-caption text-text-secondary">{c.label}</span>
              <span className="block text-h3 font-semibold tabular-nums text-text-primary">
                {c.value}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================================
 * THE VIEW TABS
 * ----------------------------------------------------------------------------
 * ⚠️ THREE, NOT FOUR. The design this follows carries an "Active sequences" tab.
 * There are no sequences — no table, no scheduler, nothing to count — so the tab
 * is absent rather than drawn over a zero that could never move. The same reason
 * the Board toggle beside it is absent: a view that does not exist is worse as a
 * dead control than as no control.
 *
 * ⚠️ "WAITING FOR REPLY" IS REAL AND IS NOT A GUESS: it counts the leads whose
 * LAST WhatsApp message came from them. That is exactly "they spoke last and we
 * have not answered", and it is the one number on this page that carries a
 * deadline — Meta's free window shuts 24 hours after their message.
 * ========================================================================= */
function ViewTabs({
  total,
  due,
  waiting,
  active,
  onPick,
}: {
  total: number;
  due: CrmDueCounts;
  waiting: number;
  active: string | null;
  onPick: (value: string | null) => void;
}) {
  const tabs = [
    { key: null as string | null, label: 'All leads', n: total },
    { key: 'overdue', label: 'Needs attention', n: due.overdue },
    { key: 'waiting', label: 'Waiting for reply', n: waiting },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tabs.map((t) => {
        const on = active === t.key;
        return (
          <button
            key={t.label}
            type="button"
            onClick={() => onPick(t.key)}
            aria-pressed={on}
            className={cn(
              'rounded-lg px-3 py-1.5 text-body-sm font-medium transition-colors',
              on
                ? 'bg-accent-primary text-white'
                : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary',
            )}
          >
            {t.label} ({t.n})
          </button>
        );
      })}
    </div>
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
 *
 * ⚠️ AND IT OPENS WITH "ALL LEADS", BECAUSE THE WAY BACK WAS INVISIBLE. Owner,
 * 2026-09-12: *"once I click someone new, it starts new but when I want to go
 * back to see all of the leads, there is no button available."* Clicking the
 * active chip a second time always cleared the filter — but nothing on the
 * screen said so, and a toggle whose off-state is hidden inside the on-control
 * is a toggle only its author can find. The count on it is the sum of the
 * strip, so it also answers "how many are there altogether" without the reader
 * adding nine numbers up.
 */
function StageStrip({
  counts,
  active,
  onPick,
  total,
}: {
  counts: Record<string, number>;
  active: string | null;
  onPick: (stage: string | null) => void;
  total: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* ⚠️ THE WAY BACK OUT. The row used to be the nine stages and nothing
          else, because a third copy of the total was a figure somebody would
          catch disagreeing after a filter. That reasoning still holds for a
          DECORATIVE total — but once these chips are how the board is filtered,
          a person who picks Contacted needs somewhere to press to see everything
          again, and hunting for the same chip to press twice is not it.

          ⚠️ It shows `total`, which is the count for the FILTERS CURRENTLY ON —
          the same number the pager says — so it cannot disagree with anything on
          screen. It is not a claim about the whole project. */}
      <button
        type="button"
        onClick={() => onPick(null)}
        aria-pressed={active === null}
        className={cn(
          'flex items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-2 text-caption transition-colors',
          active === null
            ? 'border-border-strong bg-bg-subtle'
            : 'border-border-subtle bg-bg-surface hover:border-border-default',
        )}
      >
        <span className="font-medium text-text-secondary">All</span>
        <span
          className={cn(
            'min-w-4 rounded-full px-1 text-center font-semibold tabular-nums',
            total === 0 ? 'text-text-tertiary' : 'bg-bg-subtle text-text-primary',
          )}
        >
          {total}
        </span>
      </button>

      {STAGE_ORDER.map((stage) => {
        const n = counts[stage] ?? 0;
        const on = active === stage;
        return (
          <button
            key={stage}
            type="button"
            onClick={() => onPick(stage)}
            aria-pressed={on}
            /* ⚠️ A PILL, ONE LINE: dot, name, count. The stacked card this
                replaced was 6.5rem wide nine times over, which wrapped to three
                rows on a laptop and pushed the leads themselves below the fold —
                on the one screen somebody opens between two calls. */
            className={cn(
              'flex items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-2 text-caption transition-colors',
              on
                ? 'border-border-strong bg-bg-subtle'
                : 'border-border-subtle bg-bg-surface hover:border-border-default',
            )}
          >
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: `var(--${stageToken(stage)})` }}
            />
            <span className="font-medium text-text-secondary">{stageLabel(stage)}</span>
            {/* ⚠️ The empty stages read quieter through the COUNT's ink, which
                stays above the contrast floor — never through opacity on the
                whole pill, which did not. */}
            <span
              className={cn(
                'min-w-4 rounded-full px-1 text-center font-semibold tabular-nums',
                n === 0 ? 'text-text-tertiary' : 'bg-bg-subtle text-text-primary',
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

/* ============================================================================
 * THE BOARD — cards, narrowed by the category strip above them
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-15: *"in the board view, you categorize each card. I don't want
 * that. I want to show all the card categories above and when I click one, only
 * those categories will be visible. In one row at least three cards should be
 * displayed."*
 *
 * ── ⚠️ WHAT THIS REPLACED, AND WHY THE COLUMNS WERE WRONG HERE ─────────────
 * It was a nine-column kanban. Nine columns do not fit a laptop, so it carried
 * its own horizontal scrollbar; each column was 15rem, so each card had room for
 * a name and little else; and with ten leads spread across nine stages most
 * columns said "Empty" while the few cards that existed were too narrow to read.
 * A board that needs sideways scrolling to reach a stage is not one somebody
 * reads between two calls.
 *
 * The categories moved ABOVE, as a filter — which is what `StageStrip` already
 * was. So there is one control rather than two ways to say the same thing.
 *
 * ── ⚠️ AT LEAST THREE ACROSS, AND THE CARDS GREW TO MATCH ──────────────────
 * A third of the content column instead of 15rem, so a card now carries its
 * stage, the city, the last message, the owner and when the next action is due
 * without truncating any of them to a single word.
 *
 * ── ⚠️ IT SHOWS THE PAGE, NOT THE PROJECT, and still says so ───────────────
 * Ten leads at a time is the table's unit, and a board that silently held a
 * different set would make the two views disagree about how many leads exist —
 * the bug somebody reports as "the board is missing leads". The chips above
 * count the whole project; this sentence counts what is on screen, and says
 * which is which.
 *
 * ── ⚠️ AND IT IS STILL NOT DRAG-AND-DROP ───────────────────────────────────
 * Moving a card between stages would be an unlogged stage change —
 * `crm_lead_activity` would miss it and the timeline would start lying about who
 * moved what. The card opens the record, where the change is recorded with its
 * note.
 * ========================================================================= */
function LeadBoard({
  rows,
  nowMs,
  from,
  activeStage,
}: {
  rows: readonly CrmLeadRow[];
  nowMs: number;
  from: string;
  /**
   * ⚠️ Applied HERE as well as on the server, so the cards narrow in the click's
   * own frame rather than after a round trip. Once the server answers, the rows
   * are already only this stage and the filter is a no-op.
   */
  activeStage: string | null;
}) {
  const cards = activeStage ? rows.filter((r) => r.stage === activeStage) : rows;

  if (rows.length === 0) {
    return (
      <Empty
        title="No leads match these filters"
        detail="Clear a filter, or widen the dates. Nothing has been deleted — the counts above show the whole project."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-caption text-text-secondary">
        {activeStage ? (
          <>
            {cards.length} {stageLabel(activeStage).toLowerCase()} lead
            {cards.length === 1 ? '' : 's'} on this page. The count on the chip above is the whole
            project — use the pages below to see the rest.
          </>
        ) : (
          <>
            The {cards.length} lead{cards.length === 1 ? '' : 's'} on this page. Pick a category
            above to narrow them.
          </>
        )}
      </p>

      {/* ⚠️ THE STAGE THIS PAGE HOLDS NONE OF. A chip counts the whole project,
          so pressing one whose leads all sit on another page lands here — and an
          empty grid with no explanation reads as a broken filter. */}
      {cards.length === 0 ? (
        <Empty
          title={`No ${stageLabel(activeStage ?? '').toLowerCase()} leads on this page`}
          detail="They are on another page of these results. Use the pages below, or pick All to see everything."
        />
      ) : (
        /* ⚠️ THREE ACROSS ON A LAPTOP, two on a tablet, one on a phone. The owner
            asked for at least three in a row; below that width three would each
            be too narrow to read, which is the problem the columns already had. */
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((lead) => {
            const late = lead.nextActionAt !== null && Date.parse(lead.nextActionAt) < nowMs;
            return (
              <Link
                key={lead.id}
                href={
                  `/leads/${lead.id}${from ? `?from=${encodeURIComponent(from)}` : ''}` as Route
                }
                className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-bg-surface p-3 transition-colors hover:border-border-default hover:bg-[color-mix(in_oklab,var(--accent-primary)_6%,transparent)]"
              >
                {/* ⚠️ THE STAGE IS ON THE CARD NOW. The columns used to say it;
                    with the cards mixed together, one that does not name its own
                    stage is one you cannot place. */}
                <span className="flex items-center justify-between gap-2">
                  <span
                    className="flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-caption font-medium"
                    style={{
                      borderColor: `var(--${stageToken(lead.stage)})`,
                      color: `var(--${stageToken(lead.stage)})`,
                      backgroundColor: `color-mix(in oklab, var(--${stageToken(lead.stage)}) 10%, transparent)`,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: `var(--${stageToken(lead.stage)})` }}
                    />
                    {stageLabel(lead.stage)}
                  </span>
                  {lead.nextActionAt && (
                    <span
                      className={cn(
                        'shrink-0 text-caption tabular-nums',
                        late ? 'font-semibold text-feedback-error' : 'text-text-brand',
                      )}
                    >
                      {relativeAge(lead.nextActionAt, nowMs)}
                    </span>
                  )}
                </span>

                <span className="min-w-0">
                  <span className="block truncate text-body-sm font-semibold text-text-primary">
                    {lead.fullName ?? 'Name not given'}
                  </span>
                  <span className="mt-0.5 block truncate text-caption text-text-secondary">
                    {[lead.projectName, lead.city].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>

                {lead.lastMessageBody && (
                  <span className="flex min-w-0 items-start gap-1.5">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 shrink-0"
                      style={{ color: WA_GREEN }}
                    >
                      <WhatsAppMark className="size-3.5" />
                    </span>
                    <span className="line-clamp-2 text-caption text-text-secondary">
                      {lead.lastMessageBody}
                    </span>
                  </span>
                )}

                {lead.nextAction && (
                  <span className="truncate text-caption text-text-secondary">
                    {lead.nextAction}
                  </span>
                )}

                <span className="mt-auto flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
                  <span className="truncate text-caption text-text-tertiary">
                    {lead.ownerName ?? 'Unassigned'}
                  </span>
                  {lead.noteCount > 0 && (
                    <span className="shrink-0 text-caption tabular-nums text-text-tertiary">
                      {lead.noteCount} note{lead.noteCount === 1 ? '' : 's'}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
function LeadTable({
  rows,
  nowMs,
  from,
}: {
  rows: readonly CrmLeadRow[];
  nowMs: number;
  from: string;
}) {
  /* ⚠️ REAL SELECTION, NO BULK ACTIONS YET. The boxes tick, "select all" works,
     and the count is honest. What does not exist is anything to DO with a
     selection — that arrives with the bulk bar, and drawing the bar now would be
     a row of buttons that refuse. Page-scoped on purpose: a selection that
     silently spans pages is how somebody reassigns 600 leads meaning 12. */
  const [ticked, setTicked] = React.useState<ReadonlySet<string>>(new Set());
  const shown = React.useMemo(() => rows.map((r) => r.id), [rows]);
  const allTicked = shown.length > 0 && shown.every((id) => ticked.has(id));

  const onTickAll = (on: boolean) => setTicked(on ? new Set(shown) : new Set());
  const onTick = (id: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

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
    /* ⚠️ NO `min-width`, SO NO SCROLLBAR. Owner, 2026-09-14: *"Why did you add a
       scrollbar in a table?"* It was 62rem of forced width across nine columns,
       which on a laptop pushed the Actions column — the one every row is
       actually worked from — off the right edge behind a scrollbar nobody
       noticed. Losing "Came from" took a column out, and the rest now lay out to
       the space available. `overflow-x-auto` stays as the floor: if somebody
       drops the sidebar to a phone width the table scrolls rather than the page
       going sideways with the nav. */
    <div className="overflow-x-auto rounded-xl border border-border-default bg-bg-surface">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border-default bg-bg-subtle">
            {/* ⚠️ SELECTION WORKS; THERE IS NOTHING TO DO WITH IT YET. Owner,
                2026-09-14: *"If the system doesn't have that thing but the UI is
                showing them, you have to show them. I will make them work
                definitely."* So the boxes tick and untick for real — what is
                missing is the bulk action bar they will one day raise, not the
                control. */}
            <th scope="col" className="w-9 px-3 py-2.5">
              <input
                type="checkbox"
                aria-label="Select every lead on this page"
                checked={allTicked}
                onChange={(e) => onTickAll(e.target.checked)}
                className="size-3.5 rounded border-border-default align-middle"
              />
            </th>
            <Th>Lead / project</Th>
            <Th>Stage</Th>
            <Th>Recent conversation</Th>
            <Th>Next follow-up</Th>
            <Th>Sequence</Th>
            <Th>Owner</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((lead) => (
            <Row
              key={lead.id}
              lead={lead}
              nowMs={nowMs}
              from={from}
              ticked={ticked.has(lead.id)}
              onTick={onTick}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  lead,
  nowMs,
  from,
  ticked,
  onTick,
}: {
  lead: CrmLeadRow;
  nowMs: number;
  from: string;
  ticked: boolean;
  onTick: (id: string, on: boolean) => void;
}) {
  const phone = displayPhone(lead.phoneE164, lead.phone);
  const wa = whatsAppDigits(lead.phoneE164 ?? lead.phone);

  return (
    <tr
      className={cn(
        /* ⚠️ THE WHOLE ROW LIGHTS UP, in the accent hue rather than grey —
           owner, 2026-09-14: *"the hover effect is a light blue whole row."* On
           a table this wide the eye loses its line between the name and the
           actions; a wash that crosses every cell is what keeps them together. */
        'border-b border-border-subtle transition-colors last:border-b-0',
        'hover:bg-[color-mix(in_oklab,var(--accent-primary)_7%,transparent)]',
        ticked && 'bg-[color-mix(in_oklab,var(--accent-primary)_10%,transparent)]',
      )}
    >
      <td className="px-3 py-2.5 align-top">
        <input
          type="checkbox"
          checked={ticked}
          onChange={(e) => onTick(lead.id, e.target.checked)}
          aria-label={`Select ${lead.fullName ?? 'this lead'}`}
          className="size-3.5 rounded border-border-default"
        />
      </td>

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
        {/* ⚠️ THE PROJECT, NOT THE PHONE NUMBER. The desk can be filtered to one
            project, but it does not have to be — and once it is not, "Chitral
            Royal Homes" is the difference between a plot enquiry and a frozen
            food enquiry sitting in the same list. The number moved to the hover
            title on the WhatsApp and call controls, where it is used rather than
            read. */}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-caption text-text-secondary">
          {lead.projectName && <span className="truncate">{lead.projectName}</span>}
          {lead.city && (
            <>
              {lead.projectName && (
                <span aria-hidden="true" className="text-text-disabled">
                  ·
                </span>
              )}
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

      <td className={TD}>
        <Badge token={stageToken(lead.stage)} size="sm">
          {stageLabel(lead.stage)}
        </Badge>
      </td>

      {/* ── ⚠️ THE CONVERSATION, NOT THE ACTIVITY LOG ────────────────────
          This column used to show the last logged OUTCOME ("Spoke to them · 2h
          ago"), which is what somebody remembered to press afterwards. Since
          migration 138 there is a real conversation, and what a salesperson
          scans for is the last thing actually SAID.

          ⚠️ AND WHO SAID IT IS THE WHOLE POINT. An inbound message means they
          are waiting on us and Meta's free reply window is running out; an
          outbound one means the ball is in their court. Same colour would make
          the two indistinguishable at a glance, which is the glance this column
          exists for. The activity log is still on the record, where there is
          room to read it. */}
      <td className={TD}>
        {lead.lastMessageAt ? (
          <span className="flex min-w-0 items-start gap-2">
            {/* ⚠️ A BARE GLYPH, NOT A TINTED BOX — corrected 2026-09-14 after
                seeing it beside the design. I had put every channel mark on its
                own filled square to make it findable; four filled squares per
                row is what turns a list into a grid of chips, and the owner's
                read was right: *"the reference image is looking very good but
                when I see my dashboard it's not as attractive."*

                The size stays (20px, not the 14px it started at) and the colour
                does all the work. That is how the design does it, and it is why
                the design breathes. */}
            <span
              aria-hidden="true"
              className="mt-0.5 shrink-0"
              style={{ color: WA_GREEN }}
            >
              <WhatsAppMark className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-body-sm text-text-primary">
                {lead.lastMessageBody?.trim() || 'An attachment'}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-caption text-text-secondary">
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
        ) : lead.lastActivityKind ? (
          /* No message, but something was logged — a call, a note. Still the
             most recent thing that happened to this lead. */
          <span className="flex min-w-0 items-start gap-2">
            {/* Same treatment for a logged step: bare, blue, 20px. */}
            <span
              aria-hidden="true"
              className="mt-0.5 shrink-0"
              style={{ color: 'var(--accent-primary)' }}
            >
              <Mail className="size-5" />
            </span>
            <span className="min-w-0">
            <span className="block truncate text-body-sm text-text-primary">
              {activityLabel(lead.lastActivityKind)}
            </span>
            <span className="mt-0.5 block text-caption text-text-secondary">
              {relativeAge(lead.lastActivityAt, nowMs)}
              {lead.noteCount > 0 && ` · ${lead.noteCount} note${lead.noteCount === 1 ? '' : 's'}`}
            </span>
            </span>
          </span>
        ) : (
          <Nothing>Nothing yet</Nothing>
        )}
      </td>

      {/* ── What is owed ───────────────────────────────────────────────── */}
      <td className={TD}>
        {lead.nextAction ? (
          <span className="flex min-w-0 items-start gap-2">
            {/* ⚠️ THE ICON CARRIES THE URGENCY, so the state is readable before
                the words are. Red calendar for overdue, plain for planned — the
                same two states the text says, said twice on purpose because this
                column is scanned down, not read across. */}
            <span
              aria-hidden="true"
              className="mt-0.5 shrink-0"
              style={{
                color:
                  lead.nextActionAt && Date.parse(lead.nextActionAt) < nowMs
                    ? 'var(--feedback-error)'
                    : 'var(--accent-primary)',
              }}
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
                    Date.parse(lead.nextActionAt) < nowMs
                      ? 'font-semibold text-feedback-error'
                      : 'text-text-brand',
                  )}
                >
                  {/* ⚠️ THE TIME, NOT ONLY THE DATE — owner, 2026-09-14: *"I want
                      the exact time, 10 am, mentioned."* And rightly: "today" on
                      its own tells a salesperson nothing about whether to ring
                      now or after lunch. Today and tomorrow are named rather
                      than dated, because that is how somebody says it out loud. */}
                  {followUpWhen(lead.nextActionAt, nowMs)}
                </span>
              )}
            </span>
          </span>
        ) : (
          /* ⚠️ AN INVITATION, NOT A SHRUG. "Not set" stated a fact and left the
              reader to work out where to change it; this is the one row state
              that always has an obvious next move. */
          <Link
            href={`/leads/${lead.id}${from ? `?from=${encodeURIComponent(from)}` : ''}` as Route}
            className="inline-flex items-center gap-1 text-caption font-medium text-text-brand underline-offset-2 hover:underline"
          >
            <CalendarPlus className="size-3.5" aria-hidden="true" />
            Add follow-up
          </Link>
        )}
      </td>

      {/* ── ⚠️ SEQUENCE — THE STATE IS REAL, THE ENGINE IS NOT ────────────
          Migration 147 stores where a lead sits; nothing advances it yet. So
          every pill on screen was put there by a person or a seed, and none of
          them claims an automation ran. When the scheduler lands it writes these
          same columns and this cell does not change.

          ⚠️ THE COLOURS CARRY THE STATE, because this column is glanced at
          rather than read: amber for paused (somebody stopped it on purpose),
          green for running, grey for never started, and the reason spelled out
          where one was given — "Stopped · Booked" says more than "Stopped". */}
      <td className={TD}>
        <SequencePill
          state={lead.sequenceState}
          step={lead.sequenceStep}
          total={lead.sequenceTotal}
          note={lead.sequenceNote}
        />
      </td>


      {/* ── ⚠️ WHO HOLDS IT, AND HOW WARM IT IS, IN ONE CELL ──────────────
          The temperature had a column of its own and no longer does — the design
          the owner supplied carries it as a line under the name, which is where
          it belongs: "hot" is a fact ABOUT this person's lead, not an
          independent axis to scan down. Nothing is lost; a `cold` lead still
          says so, and an unjudged one says nothing rather than guessing. */}
      <td className={TD}>
        {lead.ownerName ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={lead.ownerName} size="xs" />
            <span className="min-w-0">
              <span className="block truncate text-body-sm text-text-primary">
                {lead.ownerName}
              </span>
              {lead.temperature && (
                <span className="mt-0.5 flex items-center gap-1 text-caption text-text-secondary">
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: `var(--${temperatureToken(lead.temperature)})` }}
                  />
                  {temperatureLabel(lead.temperature)}
                </span>
              )}
            </span>
          </span>
        ) : (
          <Nothing>Unassigned</Nothing>
        )}
      </td>

      {/* ── ⚠️ THE SAME FOUR CONTROLS ON EVERY ROW ────────────────────────
          Owner, 2026-09-14: *"Where whose number is present, it's showing a
          whatsapp over there. Where whose number is not present, he's not
          showing. I want a sync UI: when you click on that button, if that
          specific row doesn't have that record, it will show that error or a
          message."*

          Right, and it was a real fault rather than a cosmetic one. A control
          that appears on some rows and not others makes the eye re-find the
          Follow-up button on every line, and — worse — it silently taught the
          reader that a missing icon means "nothing to do here" when what it
          really meant was "this one needs a number".

          So all four are always drawn, always in the same order and the same
          places. Where the data is missing the control stays and SAYS SO on
          click. ⚠️ It is a `button`, not a dead `span`: something a reader will
          click has to be reachable by keyboard and has to answer.

          `tel:` and `wa.me` still hand the number to the device and record
          nothing — logging the attempt is Step 6 — and that has not changed. */}
      <td className={TD}>
        <span className="flex items-center gap-1">
          {lead.phoneE164 ? (
            <ReachLink
              href={`tel:${lead.phoneE164}`}
              label={`Call ${lead.fullName ?? 'lead'} on ${phone}`}
            >
              <Phone className="size-4" aria-hidden="true" />
            </ReachLink>
          ) : (
            <ReachExplain
              label={`Call ${lead.fullName ?? 'this lead'}`}
              reason={
                lead.phone
                  ? `“${lead.phone}” could not be read as a mobile number, so there is no dialling link. Open the record to correct it.`
                  : 'This lead did not give a phone number, so there is nothing to dial.'
              }
            >
              <Phone className="size-4" aria-hidden="true" />
            </ReachExplain>
          )}

          {/* ⚠️ OUR CHAT FIRST, `wa.me` ONLY WHERE THE PROJECT CANNOT SEND.
              `wa.me` opens the SALESPERSON'S OWN WhatsApp — the message leaves
              from a personal handset and nothing is recorded. Once a project has
              a number of its own that link undoes the feature beside it. */}
          {lead.canWhatsApp && lead.phoneE164 ? (
            <ReachLink
              href={`/leads/${lead.id}?chat=1` as Route}
              label={`Open the WhatsApp chat with ${lead.fullName ?? 'lead'}`}
              tone="wa"
            >
              <WhatsAppMark className="size-5" />
            </ReachLink>
          ) : wa ? (
            <ReachLink
              href={`https://wa.me/${wa}`}
              external
              label={`WhatsApp ${lead.fullName ?? 'lead'} from your own phone`}
              tone="wa"
            >
              <WhatsAppMark className="size-5" />
            </ReachLink>
          ) : (
            <ReachExplain
              label={`WhatsApp ${lead.fullName ?? 'this lead'}`}
              reason={
                lead.phone
                  ? `“${lead.phone}” could not be read as a WhatsApp number. Open the record to correct it.`
                  : 'This lead has no WhatsApp number on record, so there is nothing to open.'
              }
            >
              <WhatsAppMark className="size-5" />
            </ReachExplain>
          )}

          {lead.email ? (
            <ReachLink
              href={`mailto:${lead.email}`}
              label={`Email ${lead.fullName ?? 'lead'} at ${lead.email}`}
            >
              <Mail className="size-4" aria-hidden="true" />
            </ReachLink>
          ) : (
            <ReachExplain
              label={`Email ${lead.fullName ?? 'this lead'}`}
              reason="This lead did not give an email address."
            >
              <Mail className="size-4" aria-hidden="true" />
            </ReachExplain>
          )}

          {/* ⚠️ THE ONE SOLID BUTTON ON THE ROW, and it is the thing a desk
              exists for: settling what happens next. It opens the record on its
              follow-up controls rather than acting here — a date needs a note
              beside it, and a one-click "done" with no note is how a timeline
              starts lying about work. */}
          <Link
            href={`/leads/${lead.id}${from ? `?from=${encodeURIComponent(from)}` : ''}` as Route}
            className="ml-0.5 inline-flex min-h-9 shrink-0 items-center rounded-lg bg-accent-primary px-3 text-body-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Follow-up
          </Link>

          <Link
            href={`/leads/${lead.id}${from ? `?from=${encodeURIComponent(from)}` : ''}` as Route}
            aria-label={`More for ${lead.fullName ?? 'this lead'}`}
            title="Open the record — stage, owner, notes"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <MoreVertical className="size-4" aria-hidden="true" />
          </Link>
        </span>
      </td>
    </tr>
  );
}

/**
 * A reach control whose data is missing.
 *
 * ⚠️ IT LOOKS EXACTLY LIKE `ReachLink` AND IT ANSWERS. The alternative — drawing
 * nothing — is what the owner caught on 2026-09-14: the actions column changed
 * width from row to row, and a reader learned that a missing icon meant
 * "nothing to do here" when it meant "this one needs a number".
 *
 * ⚠️ AND THE MESSAGE NAMES THE ROW'S OWN PROBLEM, not a generic one. "This lead
 * did not give a phone number" and "0300-ABC could not be read as a mobile" send
 * somebody to two different places, and only the second is worth opening the
 * record for.
 */
function ReachExplain({
  label,
  reason,
  children,
}: {
  label: string;
  reason: string;
  children: React.ReactNode;
}) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => toast({ tone: 'warn', text: reason })}
      aria-label={`${label} — not available`}
      title={reason}
      /* Dimmed, not disabled: a `disabled` button takes no click, gives no
         keyboard focus and so can never explain itself — which is the whole
         job here. */
      className="grid size-9 shrink-0 place-items-center rounded-lg border border-dashed border-border-default text-text-disabled transition-colors hover:bg-bg-subtle hover:text-text-secondary"
    >
      {children}
    </button>
  );
}

/**
 * When a follow-up is due, said the way somebody would say it.
 *
 * ⚠️ TODAY AND TOMORROW ARE NAMED, NOT DATED. "Today 3:00 PM" is actionable;
 * "14 Sept 3:00 PM" makes the reader work out what day it is. Anything further
 * out gets its date, because then the day is the point.
 *
 * ⚠️ AND EVERY PART IS RENDERED IN ASIA/KARACHI, never the reader's own zone.
 * For five hours each evening those are different days, and a follow-up that
 * moves to "tomorrow" because somebody's laptop is on UTC is a missed call.
 */
function followUpWhen(iso: string, nowMs: number): string {
  const KARACHI = 'Asia/Karachi' as const;
  const dayOf = (ms: number) =>
    new Date(ms).toLocaleDateString('en-CA', { timeZone: KARACHI });

  const at = Date.parse(iso);
  const time = new Date(at).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: KARACHI,
  });

  const today = dayOf(nowMs);
  const due = dayOf(at);
  const tomorrow = dayOf(nowMs + 86_400_000);

  if (due === today) return `Today ${time}`;
  if (due === tomorrow) return `Tomorrow ${time}`;

  const date = new Date(at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: KARACHI,
  });

  /* ⚠️ NO CLOCK TIME ON AN OVERDUE ONE. "Overdue · 12 Sep 7:34 PM" wrapped to
     two lines and the minute was worthless anyway — nobody rings a lead at the
     hour it went overdue three days ago. The date is the fact; the time only
     matters while it is still ahead of you, which is exactly the today and
     tomorrow cases above. */
  return at < nowMs ? `Overdue · ${date}` : `${date} ${time}`;
}

/* ⚠️ THE WHATSAPP CONTROL IS GREEN ON GREEN, and that is the point of it.
   Owner, 2026-09-14: *"Even the WhatsApp icon is not properly in green. The
   icons are still very small."* A brand mark drawn in secondary ink on a plain
   bordered box is a grey squiggle — it is recognised by its colour before it is
   recognised by its shape, and at that size the shape alone carries nothing.
   So the WhatsApp control gets #25D366 ink on a 12% wash of itself, which is
   what makes it findable in a row of four. */
const REACH_TONE = {
  plain: 'border-transparent bg-bg-subtle text-text-secondary hover:bg-border-subtle hover:text-text-primary',
  wa: 'border-transparent hover:brightness-95',
} as const;

/** The sequence column's pill. See migration 147 for what is and is not real. */
function SequencePill({
  state,
  step,
  total,
  note,
}: {
  state: string;
  step: number | null;
  total: number | null;
  note: string | null;
}) {
  if (state === 'not_started') {
    return (
      <span className="inline-flex items-center rounded-md border border-border-subtle bg-bg-surface px-2 py-0.5 text-caption text-text-secondary">
        Not started
      </span>
    );
  }

  const progress = step !== null && total !== null ? `${step}/${total}` : null;
  const look: Record<string, { label: string; token: string }> = {
    scheduled: { label: 'Scheduled', token: 'accent-primary' },
    active: { label: 'Active', token: 'feedback-success' },
    paused: { label: 'Paused', token: 'feedback-warning' },
    stopped: { label: 'Stopped', token: 'text-secondary' },
  };
  const it = look[state] ?? { label: state, token: 'text-secondary' };
  /* "Stopped · Booked" — the reason beats the progress once it has ended. */
  const tail = state === 'stopped' ? (note ?? progress) : progress;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-caption font-medium"
      style={{
        backgroundColor: `color-mix(in oklab, var(--${it.token}) 14%, transparent)`,
        color: `var(--${it.token})`,
      }}
    >
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full"
        style={{ backgroundColor: 'currentColor' }}
      />
      {it.label}
      {tail && <span className="tabular-nums opacity-80">· {tail}</span>}
    </span>
  );
}

function ReachLink({
  href,
  label,
  external,
  tone = 'plain',
  children,
}: {
  href: string;
  label: string;
  external?: boolean;
  tone?: keyof typeof REACH_TONE;
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
          ? {
              backgroundColor: `color-mix(in oklab, ${WA_GREEN} 14%, transparent)`,
              color: WA_GREEN,
            }
          : undefined
      }
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-lg border transition-colors',
        REACH_TONE[tone],
      )}
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
