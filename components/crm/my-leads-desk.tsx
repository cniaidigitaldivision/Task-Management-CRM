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
import { SourceMark } from './source-mark';
import { Pagination } from '@/components/ui/pagination';
import { useToast } from '@/components/ui/toast';
import type { CrmDueCounts, CrmLeadRow, CrmProjectOption } from '@/lib/db/queries/crm-leads';
import { STAGE_ORDER, stageLabel, stageToken } from '@/lib/domain/crm-stages';
import { leadPriority, priorityLabel, priorityToken } from '@/lib/domain/lead-priority';
import { sourceDetail, sourceLabel } from '@/lib/domain/lead-source';
import { displayPhone, whatsAppDigits } from '@/lib/domain/phone';
import { relativeAge } from '@/lib/view/relative-age';
import { cn } from '@/lib/utils';
import { leadsPageAction } from '@/app/actions/crm-leads';
import { AddLead, type AddLeadProject, type AddLeadProperty } from './add-lead';
import { LeadDrawer } from './lead-drawer';
import { RecordOutcome } from './record-outcome';
import type { CrmLeadFull, CrmLeadRelated, CrmMessage } from '@/lib/db/queries/crm-leads';
import { LeadDrawerShell } from './lead-drawer-shell';

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
  record,
  messages,
  related,
  initialTab,
  addProjects,
  addProperties,
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
  /** The lead the URL asked for, once the server has it. Null while none is open. */
  record: CrmLeadFull | null;
  messages: readonly CrmMessage[];
  related: CrmLeadRelated | null;
  initialTab: string;
  /** ⚠️ The projects this person may ADD to — a different question from the
      picker above the list, and the one the write actually asks (migration 159). */
  addProjects: readonly AddLeadProject[];
  addProperties: readonly AddLeadProperty[];
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

  /* ── ⚠️ EVERY CONTROL ON THIS PAGE IS A SERVER NAVIGATION ─────────────────
     A filter, a tab, a page number: each one re-runs the whole render in
     Singapore before anything on screen moves. There is no way around the
     round trip — the rows genuinely come from the database — but there IS a way
     around the SILENCE, and the silence is what reads as "nothing happened, let
     me click it again".

     `useTransition` gives the answer the interface was missing: `pending` is
     true from the click until the new rows arrive, so the table can dim and say
     it is working instead of sitting there looking broken. */
  const [pending, startTransition] = React.useTransition();

  /* ── ⚠️ A SECOND TRANSITION, BECAUSE THEY MEAN DIFFERENT THINGS ──────────
     Owner, on the published test run: *"when I click its close button, the
     drawer is closed and finished. The table in the background remains in a fade
     and is rendering. After some time it starts showing in a real position."*

     Exactly right, and the cause was mine. ONE `pending` flag drove seven
     different `startTransition` calls, and the table dims whenever it is true.
     Closing a drawer only syncs the URL — not one row changes — but it went
     through the same transition, so the table faded for the whole round trip to
     Singapore and snapped back when the navigation landed.

     ⚠️ `pending` MUST MEAN ONE THING: "the rows on screen are about to be
     replaced". A filter means that. Opening or closing a panel does not.

     So URL housekeeping gets its own transition with nothing hanging off it.
     React still batches and interrupts it properly; it simply stops claiming the
     table is stale when nothing about the table has changed. */
  const [, startSync] = React.useTransition();

  /* True only while a page of rows is actually being fetched. */
  const [paging, setPaging] = React.useState(false);

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
      startTransition(() => {
        router.push(`/my-leads?${next.toString()}` as Route);
      });
    },
    [router, search],
  );

  /* ── ⚠️ THE ADD-LEAD MODAL IS CLIENT STATE, NOT A URL ROUND TRIP ──────────
     Owner, 2026-09-15: *"if I add the add lead modal popup, that's also taking
     time."* It was: the button pushed `?action=add` and the dialog did not
     appear until the server had re-rendered the entire page — the list, the
     counts, every query — none of which the dialog uses.

     It is a form. Everything it needs is already on this page. So it opens in
     the click's own frame, and the URL follows behind for the refresh and the
     shared link. */
  /* Same shape as the drawer's `wish`, and for the same back-button reason. */
  const urlAdd = search.get('action') === 'add';
  const [addWish, setAddWish] = React.useState<boolean | undefined>(undefined);
  if (addWish !== undefined && addWish === urlAdd) setAddWish(undefined);
  const addOpen = addWish === undefined ? urlAdd : addWish;

  /* ── ⚠️ TURNING A PAGE FETCHES THE ROWS, NOT THE PAGE ────────────────────
     Owner, 2026-09-15: *"Why is the pagination taking time to render? Why is it
     not on the client side?"*

     Measured before answering. A page number lives in the URL, so changing it
     re-rendered the whole route — nine queries, of which eight cannot be altered
     by a page change at all:

         the whole page re-rendering    1477 ms
         only the rows that change       486 ms   (67% of it was waste)

     Page 2's rows genuinely are not on the client and have to be asked for.
     Everything else was already here. So the pager calls an action that returns
     ROWS ONLY, drops them into state, and lets the URL catch up behind — so a
     reload and the back button still land on the right page.

     ⚠️ THE SERVER'S ROWS WIN AGAIN THE MOMENT A FILTER CHANGES. `signature`
     below is what this local copy was fetched under; when the props arrive with
     a different one — a new filter, a new project, a recorded outcome — the
     local copy is dropped rather than shown against the wrong question. Without
     that, filtering to Overdue would keep showing the page of rows fetched
     before it. */
  const pageCount = Math.max(1, Math.ceil(total / perPage));

  const signature = JSON.stringify([
    selectedProjectId,
    filters.stage,
    filters.search,
    filters.due,
    total,
  ]);
  /* ── ⚠️ EVERY PAGE VISITED IS KEPT, NOT JUST THE CURRENT ONE ─────────────
     Owner, on the test run: *"When I swap from one page to another it is
     rendering again, taking time to load. When I even switch back to page 1
     again, it is taking time to load."*

     Both halves were true and they had different causes. Forward was a real
     fetch — page 2 is not on the client and cannot be. BACK was inexcusable:
     page 1's rows had already been fetched, twice over (the server rendered
     them, then we had them in hand), and the old shape held exactly ONE page,
     so returning threw them away and asked again.

     A map keyed by page number means a page is fetched at most once per filter
     set. Going back is now a paint. */
  const [local, setLocal] = React.useState<{
    sig: string;
    page: number;
    pages: Readonly<Record<number, readonly CrmLeadRow[]>>;
  } | null>(null);

  if (local && local.sig !== signature) setLocal(null);

  /* The server's own rows are page `page` — seed the cache with them rather than
     re-fetching what this render already carries. */
  /* ⚠️ THE SERVER'S ROWS FOR THE CURRENT PAGE WIN — the spread comes FIRST and
     `[page]: rows` overrides it. Written the other way round, a cached copy of
     page 1 outranked the fresh one the server had just sent, so recording an
     outcome revalidated the page and the table went on showing the OLD stage.
     A cache that outranks fresh data is not a cache, it is a bug with a fast
     read. Other pages keep their cached copies; only the one the server just
     rendered is replaced. */
  const cache: Record<number, readonly CrmLeadRow[]> = { ...(local?.pages ?? {}), [page]: rows };
  const shownPage = local?.page ?? page;
  const shownRows = cache[shownPage] ?? rows;

  const goToPage = React.useCallback(
    (n: number) => {
      const next = new URLSearchParams(search.toString());
      if (n <= 1) next.delete('page');
      else next.set('page', String(n));

      /* ⚠️ THE DIM LASTS ONLY WHILE THE ROWS ARE IN FLIGHT, not for the whole
         navigation. Wrapped in a transition alongside `router.replace`, it kept
         the table faded until the URL finished catching up — long after the new
         rows had already been swapped in and were sitting there greyed out. Same
         fault as the drawer's close, one step smaller. */
      /* ⚠️ ALREADY IN HAND — SHOW IT AND ASK FOR NOTHING. This is the whole of
         "instant on the way back". */
      const held = cache[n];
      if (held) {
        setLocal({ sig: signature, page: n, pages: { ...(local?.pages ?? {}), [n]: held } });
        startSync(() => {
          router.replace(`/my-leads?${next.toString()}` as Route);
        });
        return;
      }

      setPaging(true);
      void leadsPageAction(
        selectedProjectId,
        {
          stage: filters.stage,
          temperature: null,
          formId: null,
          search: filters.search,
          due: filters.due,
        },
        n,
        perPage,
      )
        .then((got) => {
          /* ⚠️ NULL MEANS THE ACTION FAILED, AND THE TABLE KEEPS WHAT IT HAS.
             The URL still moves, so the ordinary navigation renders the right
             page a moment later — slower, and always correct. */
          if (got) {
            setLocal((prev) => ({
              sig: signature,
              page: n,
              pages: { ...(prev?.sig === signature ? prev.pages : {}), [n]: got.rows },
            }));
          }
        })
        .finally(() => setPaging(false));

      /* ⚠️ `replace`, NOT `push`. Ten pages of a list should not put ten
          entries in the history for Back to walk through one at a time. */
      startSync(() => {
        router.replace(`/my-leads?${next.toString()}` as Route);
      });
    },
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
    [router, search, selectedProjectId, filters.stage, filters.search, filters.due, perPage,
     signature, rows, page, local],
  );

  /* ── ⚠️ THE NEXT PAGE IS FETCHED BEFORE IT IS ASKED FOR ─────────────────
     Caching makes going BACK instant. This is what makes going FORWARD instant:
     while somebody reads page 1, page 2 is already on its way.

     ⚠️ ONE PAGE AHEAD, NOT ALL OF THEM. Prefetching the whole list would be the
     obvious next step and the wrong one — it turns a 10-row read into a 650-row
     one for a person who will look at eight. One page is the only one they can
     reach in a single click.

     ⚠️ AND IT NEVER RUNS WHILE A REAL FETCH IS IN FLIGHT. The pool is three
     connections in production; a speculative read competing with the one
     somebody is waiting for would make the visible thing slower to make an
     invisible thing faster. */
  React.useEffect(() => {
    const ahead = shownPage + 1;
    if (paging || pending) return;
    if (ahead > pageCount) return;
    if (cache[ahead]) return;

    let live = true;
    const timer = setTimeout(() => {
      void leadsPageAction(
        selectedProjectId,
        {
          stage: filters.stage,
          temperature: null,
          formId: null,
          search: filters.search,
          due: filters.due,
        },
        ahead,
        perPage,
      ).then((got) => {
        if (!live || !got) return;
        setLocal((prev) => ({
          sig: signature,
          page: prev?.sig === signature ? (prev?.page ?? shownPage) : shownPage,
          pages: { ...(prev?.sig === signature ? prev.pages : {}), [ahead]: got.rows },
        }));
      });
      /* A beat after the page settles, so it never competes with the render
         somebody is actually looking at. */
    }, 400);

    return () => {
      live = false;
      clearTimeout(timer);
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [shownPage, signature, pageCount, paging, pending]);

  /* ── ⚠️ THE PROPOSED STAGE IS THE DESK'S STATE, NOT A URL PARAMETER ──────
     It used to ride in `?stage=`, which is the list's own filter — see
     `StageChooser`. Holding it here means it cannot collide with anything, it
     cannot survive a cancel, and the form opens in the click's own frame because
     everything it needs (the lead's id, name and current stage) is on the row
     that was clicked. */
  const [outcomeFor, setOutcomeFor] = React.useState<{ id: string; stage: string } | null>(null);

  const proposeStage = React.useCallback((leadId: string, stage: string) => {
    setOutcomeFor({ id: leadId, stage });
  }, []);

  /* ⚠️ CANCELLING LEAVES NOTHING BEHIND — not a filter, not a drawer, not a
     parameter. The lead keeps the stage it had; the desk keeps the view it had. */
  const closeOutcome = React.useCallback(() => setOutcomeFor(null), []);

  const closeAdd = React.useCallback(() => {
    setAddWish(false);
    startSync(() => {
      const next = new URLSearchParams(search.toString());
      next.delete('action');
      const qs = next.toString();
      router.replace((qs ? `/my-leads?${qs}` : '/my-leads') as Route);
    });
  }, [router, search]);

  /* ── ⚠️ THE DRAWER OPENS FROM THE ROW, NOT FROM SINGAPORE ────────────────
     Owner, 2026-09-15: *"if I click on a row, the drawer should open instantly
     instead of it rendering."*

     `openLead` is the id the person just clicked. The panel appears in that same
     frame, drawn from the row — which already holds the name, project, stage,
     phone, email and city. The URL follows in a transition, the server sends the
     notes, thread, activity and related records, and `record` below takes over
     the moment they land.

     ⚠️ THE SHELL IS SHOWN ONLY WHILE THE SERVER'S ANSWER IS FOR A DIFFERENT
     LEAD. Comparing ids rather than tracking a boolean means a stale record from
     the previous lead can never be mistaken for this one's — which would put
     somebody else's details under this person's name. */
  /* ⚠️ THE URL REMAINS THE SOURCE OF TRUTH; THE WISH ONLY RUNS AHEAD OF IT.
     A plain piece of state here would have been a bug with the back button:
     state does not rewind, so going Back would drop `?lead=` from the URL while
     the component still believed a drawer was open — leaving a loading shell on
     screen with nothing ever coming to replace it.

     So `wish` is what the person just asked for, and it applies only until the
     URL agrees. `undefined` means "follow the URL", which is what Back, Forward
     and a pasted link all need. */
  const urlLead = search.get('lead');
  const [wish, setWish] = React.useState<string | null | undefined>(undefined);

  /* Adjusting state during render rather than in an effect — React's own pattern
     for deriving from props. It re-renders before committing, so nothing flashes
     and no cascade is queued. */
  if (wish !== undefined && wish === urlLead) setWish(undefined);

  const openLead = wish === undefined ? urlLead : wish;
  const [openTab, setOpenTab] = React.useState<string>(initialTab);

  /* ⚠️ ONE OWNER FOR "WHICH TAB IS OPEN". The shell and the real drawer both
     render from this; neither keeps a copy. Two copies could disagree at the
     moment one replaced the other, which is what the owner saw as the panel
     switching tabs by itself while it loaded. */
  const setTab = React.useCallback((t: string) => setOpenTab(t), []);

  const onOpen = React.useCallback(
    (leadId: string, tab: string) => {
      setWish(leadId);
      setOpenTab(tab);
      startSync(() => {
        const next = new URLSearchParams(search.toString());
        next.set('lead', leadId);
        next.set('tab', tab);
        router.replace(`/my-leads?${next.toString()}` as Route);
      });
    },
    [router, search],
  );

  const closeLead = React.useCallback(() => {
    setWish(null);
    /* ⚠️ THE ONE THE OWNER CAUGHT. Closing a drawer changes no row, so it must
       not put the table into its "rows are coming" state for a round trip. */
    startSync(() => {
      const next = new URLSearchParams(search.toString());
      next.delete('lead');
      next.delete('tab');
      const qs = next.toString();
      router.replace((qs ? `/my-leads?${qs}` : '/my-leads') as Route);
    });
  }, [router, search]);

  const shellRow = openLead && record?.lead.id !== openLead
    ? shownRows.find((r) => r.id === openLead)
    : undefined;

  const openAdd = () => {
    setAddWish(true);
    startSync(() => {
      const next = new URLSearchParams(search.toString());
      next.set('action', 'add');
      router.replace(`/my-leads?${next.toString()}` as Route);
    });
  };

  /* ⚠️ PAGE-SCOPED SELECTION, and deliberately. A selection that silently spans
     pages is how somebody bulk-changes 600 leads meaning 10. Nothing acts on it
     yet — the bulk bar is the next phase — but the control is real, because the
     owner asked for it and a checkbox that does not tick is worse than none. */
  const [ticked, setTicked] = React.useState<ReadonlySet<string>>(new Set());
  /* ⚠️ THE IDS ON SCREEN, not the server's last set. After a client-side page
     turn these differ, and "select every lead on this page" reading the stale
     list would tick rows the person cannot see — which is how somebody
     bulk-changes the wrong eight leads. */
  const shown = React.useMemo(() => shownRows.map((r) => r.id), [shownRows]);
  const allTicked = shown.length > 0 && shown.every((id) => ticked.has(id));
  const onTick = (id: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const assigned = counts.assigned ?? total;
  /* "Showing 9–16 of 21" has to follow the page actually on screen, not the one
     the URL is still catching up to. */
  const shownFrom = total === 0 ? 0 : (shownPage - 1) * perPage + 1;

  return (
    <>
      {/* ── ⚠️ THE OVERLAYS LIVE OUTSIDE THE CONTENT COLUMN ──────────────────
          They were briefly children of the `space-y-4` container below, and that
          is a real layout bug even though every one of them is `position:
          fixed`. Tailwind's `space-y-*` is `> * + *` — a SIBLING selector, which
          does not care whether the element it matched is in the flow. An opening
          panel became child one, the header became child two, and the header
          inherited a 1rem margin it never had before. The whole page shifted 16px
          and grew a scrollbar the moment a drawer opened.

          Owner spotted it immediately: *"why did you add a scrollbar to it? I
          have seen that it's adding a scrollbar to it when it's open."*

          A fixed overlay is not part of the column it covers, so it does not
          belong among its children. */}
      {/* ⚠️ THE OUTCOME FORM WINS OVER THE DRAWER when both are open — they are
          two panels on one screen, and stacking them leaves the drawer visible
          and unreachable behind a dialog. */}
      {outcomeFor && (
        <RecordOutcome
          key={outcomeFor.id}
          leadId={outcomeFor.id}
          leadName={shownRows.find((r) => r.id === outcomeFor.id)?.fullName ?? 'this lead'}
          currentStage={shownRows.find((r) => r.id === outcomeFor.id)?.stage ?? 'new'}
          proposedStage={outcomeFor.stage}
          onClose={closeOutcome}
        />
      )}

      {/* ⚠️ THE REAL DRAWER WINS THE MOMENT ITS DATA MATCHES THIS LEAD. */}
      {!outcomeFor && openLead && record && related && record.lead.id === openLead && (
        <LeadDrawer
          key={record.lead.id}
          lead={record.lead}
          notes={record.notes}
          activity={record.activity}
          messages={messages}
          related={related}
          tab={openTab as never}
          viewerName={fullName}
          nowMs={nowMs}
          onTab={setTab}
          onClose={closeLead}
        />
      )}
      {!outcomeFor && shellRow && (
        <LeadDrawerShell
          row={shellRow}
          tab={openTab}
          nowMs={nowMs}
          onTab={setTab}
          onClose={closeLead}
        />
      )}

      {addOpen && (
        <AddLead
          projects={addProjects}
          properties={addProperties}
          defaultProjectId={selectedProjectId}
          onClose={closeAdd}
        />
      )}

    <div
      className="mx-auto max-w-[var(--content-max)] space-y-4"
      style={pending || paging ? { cursor: 'progress' } : undefined}
    >
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
            onClick={openAdd}
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
          <table
            className={cn(
              'w-full border-collapse text-left transition-opacity',
              /* ⚠️ DIMMED, NOT REPLACED BY A SKELETON. The rows on screen are
                 still the truthful answer to the previous question, and swapping
                 them for grey bars throws away something readable in exchange for
                 something that is not. Dimming says "these are going" without
                 blanking the page somebody is reading. */
              (pending || paging) && 'pointer-events-none opacity-50',
            )}
            aria-busy={pending || paging}
          >
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
              {shownRows.map((lead) => (
                <Row
                  key={lead.id}
                  lead={lead}
                  nowMs={nowMs}
                  fullName={fullName}
                  ticked={ticked.has(lead.id)}
                  onTick={onTick}
                  onOpen={onOpen}
                  onPropose={proposeStage}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Pagination
          page={shownPage}
          pageCount={pageCount}
          onPage={goToPage}
          from={shownFrom}
          to={shownFrom === 0 ? 0 : shownFrom + shownRows.length - 1}
          total={total}
          label="leads"
        />
        <p className="text-caption text-text-secondary">
          Everything here is assigned to you, {firstName}.
        </p>
      </div>
    </div>
    </>
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

/* ── ⚠️ TWO CELL ALIGNMENTS, AND THE ROW IS WHY ───────────────────────────
   Owner, 2026-09-15: *"Hina and Sahad have a lot of things to display so they
   start from the top of the row. While Property, Priority, Sources and Quick
   Actions should be in the centre of the row. What do you think about that?"*

   Agreed, and it is the ordinary rule for a table whose rows vary in height.
   Three columns here are STACKS — the person (name, project, city), the
   conversation (message, time, quotation) and the next action. Those read top
   down and must start at the top, or the first line of each stops lining up
   with the first line of its neighbours.

   The rest are single objects: one dropdown, one dot, one logo, one row of
   buttons. A single object pinned to the top of a three-line row hangs from the
   ceiling with a gap under it, and the eye reads the gap as a missing value. */
const TD = 'px-3 py-3 align-top';
const TD_MID = 'px-3 py-3 align-middle';

function Row({
  lead,
  nowMs,
  fullName,
  ticked,
  onTick,
  onOpen,
  onPropose,
}: {
  lead: CrmLeadRow;
  nowMs: number;
  fullName: string;
  ticked: boolean;
  onTick: (id: string, on: boolean) => void;
  /** Opens the drawer in this click's own frame. See `lead-drawer-shell.tsx`. */
  onOpen: (leadId: string, tab: string) => void;
  onPropose: (leadId: string, stage: string) => void;
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
  /* ⚠️ A BUTTON, NOT A LINK, AND THAT IS THE WHOLE POINT. A `<Link>` here meant
     a full server navigation before the panel appeared — a round trip to
     Singapore to show details that are already on this page. `onOpen` draws the
     drawer from THIS ROW, now, and lets the URL and the remaining detail catch
     up behind it. */
  const open = (tab: string) => () => onOpen(lead.id, tab);
  const href = `/leads/${lead.id}` as Route;

  return (
    <tr
      /* ── ⚠️ THE WHOLE ROW OPENS IT ────────────────────────────────────────
         Owner, 2026-09-15: *"wherever I click on a hovered-over row, it should
         open a drawer."* The row already highlights under the cursor, which
         promises the whole strip is the target; three small islands inside it
         were not that.

         ⚠️ THE GUARD IS THE WHOLE TRICK. A row full of controls that also
         handles its own clicks will swallow them: ticking the checkbox would
         open the drawer, choosing a stage would open the drawer, and the name
         would navigate AND open one. `closest` asks whether the click already
         landed on something that has its own job, and steps aside if it did. */
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest('a, button, input, select, textarea, label, [role="button"]')) return;
        onOpen(lead.id, 'overview');
      }}
      className={cn(
        'cursor-pointer border-b border-border-subtle transition-colors last:border-b-0',
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
            {/* ⚠️ ONE FACT PER LINE — owner, 2026-09-15: *"the name Hina Shahzad,
                then the project name. On the next line it should display
                Islamabad, Lahore, Karachi, whatever the city is."* Project and
                city used to share a line separated by a dot; at this column
                width that truncated the city away on every long project name,
                so the one fact a salesperson scans for was the one that
                disappeared. */}
            <span className="mt-0.5 block truncate text-caption text-text-secondary">
              {lead.projectName ?? 'No project'}
            </span>
            {lead.city && (
              <span className="mt-0.5 block truncate text-caption text-text-secondary">
                {lead.city}
              </span>
            )}
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
      <td className={TD_MID}>
        <StageChooser lead={lead} onPropose={onPropose} />
      </td>

      {/* ── What was last said ──────────────────────────────────────────── */}
      <td className={TD}>
        {/* ── ⚠️ ONE ICON COLUMN, ONE TEXT COLUMN ──────────────────────────
            Owner, 2026-09-15: *"the last conversation icon should be on the
            leftmost side with proper padding… these quotation things should also
            be parallel to or aligned with the proposal request text, not to the
            logo or the icon."*

            The quotation used to be a SIBLING of the message button, so it began
            at the cell's left edge — level with the icon, while the message text
            sat 1.75rem further in. Two left edges in one cell, and the eye had
            to find the second one.

            Now the icon is one flex child and EVERYTHING that is text is in the
            other, so the message, the time and the quotation all share a single
            left edge. ⚠️ The icon column keeps its width even when there is no
            message — an absent icon would pull that row's text back to the cell
            edge and break the column the moment one lead had no conversation. */}
        <span className="flex min-w-0 items-start gap-2">
          <span
            aria-hidden="true"
            /* ⚠️ 24px, matching the source column. These two marks are the
               only logos in the row and they were the smallest things in it. */
            className="mt-px flex size-6 shrink-0 items-center justify-center"
            style={{
              color: !lead.lastMessageAt
                ? 'var(--border-default)'
                : lead.lastMessageDirection === 'inbound'
                  ? WA_GREEN
                  : 'var(--text-tertiary)',
            }}
          >
            <WhatsAppMark className="size-6" />
          </span>

          <span className="min-w-0 flex-1">
            {lead.lastMessageAt ? (
              <button
                type="button"
                onClick={open('conversations')}
                className="block w-full min-w-0 text-left"
              >
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
              </button>
            ) : (
              <span className="block text-caption text-text-tertiary">Nothing yet</span>
            )}

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
          </span>
        </span>
      </td>

      {/* ── What is owed ────────────────────────────────────────────────── */}
      <td className={TD}>
        {lead.nextAction ? (
          <button type="button" onClick={open('followups')} className="flex min-w-0 items-start gap-2 text-left">
            {/* The icon says which state this is before the words do — owner,
                2026-09-15: overdue red, WhatsApp green, a reminder blue.

                ⚠️ OVERDUE IS A WARNING TRIANGLE, NOT A RED CALENDAR. At 20px a
                calendar and a clock are the same grey rectangle, so the SHAPE
                has to carry the meaning for anybody who cannot separate the
                hues — colour alone is not a state. A paused sequence gets amber
                and its own glyph for the same reason. */}
            {/* ── ⚠️ 20px GLYPH IN A 24px BOX, AND THE MISMATCH IS THE POINT ──
                Owner, 2026-09-15: *"these sizes of exclamation marks and the
                calendar-like ball icon are a little bigger so it's looking
                awkward now."* Right, and the reason is worth keeping:

                A brand tile is a FILLED shape — ink to its own edges, reading at
                roughly its nominal size. A lucide glyph is an OUTLINE on a
                transparent square, and its strokes push to the very corners, so
                at the same nominal size it occupies visibly more room and shouts.
                Setting both to 24 made the line glyphs the loudest thing in a row
                whose logos were supposed to lead.

                So: filled marks (source, WhatsApp) stay 24. Line glyphs sit at 20
                INSIDE a 24px box — the box keeps every row's text starting at the
                same offset, which is what the column alignment depends on. */}
            <span
              aria-hidden="true"
              className="mt-px flex size-6 shrink-0 items-center justify-center"
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
          </button>
        ) : (
          <button
            type="button"
            onClick={open('followups')}
            className="inline-flex items-center gap-1 text-caption font-medium text-text-brand underline-offset-2 hover:underline"
          >
            <CalendarPlus className="size-4" aria-hidden="true" />
            Add follow-up
          </button>
        )}
      </td>

      {/* ── How urgent ──────────────────────────────────────────────────── */}
      <td className={TD_MID}>
        <span
          className="inline-flex items-center gap-1.5 text-caption text-text-secondary"
          title={priority.reason}
        >
          {/* ⚠️ 10px WITH A HALO, not an 8px speck. This is the only mark in
              the row that encodes a LEVEL rather than a brand, and beside 24px
              logos it had stopped registering at all. The ring gives it presence
              without making it compete with the logos for size. */}
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{
              backgroundColor: `var(--${priorityToken(priority.level)})`,
              boxShadow: `0 0 0 3px color-mix(in oklab, var(--${priorityToken(priority.level)}) 22%, transparent)`,
            }}
          />
          <span className="text-body-sm text-text-primary">{priorityLabel(priority.level)}</span>
        </span>
      </td>

      {/* ── Where they came from ────────────────────────────────────────── */}
      <td className={TD_MID}>
        {/* ⚠️ THE REAL LOGO, not a coloured dot. `components/brand/platform-icon`
            has drawn these tiles since August and this column was rendering a
            2px circle beside a word — owner: *"Proper icons are given and these
            icons are also present in my system."* */}
        <span className="flex min-w-0 items-start gap-2">
          <span className="mt-px shrink-0">
            <SourceMark source={lead.source} />
          </span>
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
      <td className={TD_MID}>
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
              tone="wa"
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
              tone="mail"
            >
              <Mail className="size-4" aria-hidden="true" />
            </Explain>
          )}

          <button
            type="button"
            onClick={open('followups')}
            title={`Plan the next action for ${lead.fullName ?? 'this lead'} · ${phone}`}
            className="ml-0.5 inline-flex min-h-9 shrink-0 items-center rounded-lg bg-accent-primary px-3 text-body-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Follow-up
          </button>

          <button
            type="button"
            onClick={open('overview')}
            aria-label={`Open ${lead.fullName ?? 'this lead'}`}
            title={`Open ${lead.fullName ?? 'this lead'} — ${fullName}'s lead`}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <MoreVertical className="size-4" aria-hidden="true" />
          </button>
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
function StageChooser({
  lead,
  onPropose,
}: {
  lead: CrmLeadRow;
  onPropose: (leadId: string, stage: string) => void;
}) {
  const token = stageToken(lead.stage);

  /* ⚠️ IT OPENS THE OUTCOME FORM, IT DOES NOT WRITE. Picking a stage here and
     saving it silently would leave a timeline saying WHAT changed and never WHY
     — and "why" is the question the log exists to answer.

     ⚠️ AND IT NO LONGER TOUCHES THE URL ITSELF. It used to carry the chosen
     stage in `?stage=`, which is the LIST'S OWN FILTER — so choosing "Qualified"
     for one contacted lead filtered the whole table to Qualified, the lead being
     edited disappeared from behind the form, and cancelling left the filter
     stuck on a stage nobody had asked to filter by. Owner found it in a minute.

     One parameter cannot mean two things. The proposal now goes to the desk,
     which holds it as its own state. */
  const open = (stage: string) => onPropose(lead.id, stage);

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
                backgroundColor: 'color-mix(in oklab, var(--channel-email) 12%, transparent)',
                color: 'var(--channel-email)',
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
  tone = 'plain',
  children,
}: {
  toast: ReturnType<typeof useToast>;
  label: string;
  reason: string;
  /** Matches `Reach`, so a control looks the same whether its data is there. */
  tone?: 'plain' | 'wa' | 'mail';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => toast({ tone: 'warn', text: reason })}
      /* ⚠️ THE COLOUR STAYS; ONLY THE ANSWER CHANGES. Owner, 2026-09-15:
         *"Whether the email is present or not, please use this blue colour. If
         email is not present then I click on it, it will show me a message…
         but keep the colour the same."*

         It used to go grey and dashed, which read as DISABLED — and a row of
         controls where some are grey teaches the eye to skip them, so the one
         lead actually missing an address became the one nobody clicked to find
         out. The channel keeps its colour; pressing it says what is missing.

         ⚠️ The border stays dashed and `aria-label` still says "not available",
         so the difference is not carried by colour alone — somebody who cannot
         separate teal from blue, and anybody on a screen reader, still gets it. */
      style={
        tone === 'wa'
          ? { backgroundColor: `color-mix(in oklab, ${WA_GREEN} 10%, transparent)`, color: WA_GREEN }
          : tone === 'mail'
            ? {
                backgroundColor: 'color-mix(in oklab, var(--channel-email) 10%, transparent)',
                color: 'var(--channel-email)',
              }
            : undefined
      }
      aria-label={`${label} — not available`}
      title={reason}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-lg border border-dashed transition-colors',
        tone === 'plain'
          ? 'border-border-default text-text-disabled hover:bg-bg-subtle hover:text-text-secondary'
          : 'border-current/35 hover:brightness-95',
      )}
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
