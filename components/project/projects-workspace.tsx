'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, FolderPlus, LayoutGrid, Package, Pencil, Rows3 } from 'lucide-react';

import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { Pagination, usePagination } from '@/components/ui/pagination';
import {
  ToggleGroup,
  Toolbar,
  ToolbarGroup,
  ToolbarLabel,
  ToolbarSpacer,
} from '@/components/ui/toolbar';
import type { ProjectRow } from '@/lib/db/queries/types';
import {
  PROJECT_STATUSES,
  PROJECT_TYPE_META,
  type ProjectStatus,
  type ProjectType,
} from '@/lib/domain/constants';

import { cn } from '@/lib/utils';

import { ProjectDelivery, PlatformStrip } from './project-delivery';
import { ProjectDialog } from './project-dialog';
import { ProjectFilterCards, type TypeMix } from './project-filter-cards';
import { IncludesPills, KindPill, PackagePill, StatusPill } from './project-pills';

/* ============================================================================
 * PROJECTS — doc 15, doc 10 §4
 * ----------------------------------------------------------------------------
 * A card per project, with the four numbers that answer "is this in trouble":
 * how much is open, how much is done, how much is late, and how many points are
 * committed. Those come back with the row (lib/db/queries/projects.ts) rather
 * than as four queries per card.
 *
 * ── THE CATCH-ALL SITS LAST, AND LOOKS DIFFERENT ─────────────────────────────
 * "Misc / Ad-hoc" is not a project anybody planned; it is where work with no home
 * lands so that it can be counted (doc 15 §6). Sorting it into the middle
 * alphabetically would disguise that. It is last, and it says what it is.
 * ========================================================================= */

/** Which colour each status chip lights up in. Mirrors `StatusPill`. */
const STATUS_FILTER_TOKEN: Readonly<Record<ProjectStatus, string>> = {
  planning: 'feedback-info',
  active: 'feedback-success',
  on_hold: 'feedback-warning',
  completed: 'accent-primary',
  archived: 'text-tertiary',
  cancelled: 'feedback-error',
};

export function ProjectsWorkspace({
  projects,
  people,
  canManage,
  canSeeFinance,
  mix,
  otherPct,
  otherIsHigh,
  otherWarningPct,
}: {
  mix: readonly TypeMix[];
  otherPct: number;
  otherIsHigh: boolean;
  otherWarningPct: number;
  projects: readonly ProjectRow[];
  people: ReadonlyArray<{ id: string; name: string }>;
  /** Admin and above — doc 03 §3.2. */
  canManage: boolean;
  /** `project.view_finance`. Owner: the monthly fee is Admin-and-above only. */
  canSeeFinance: boolean;
}) {
  const [type, setType] = React.useState<ProjectType | 'all'>('all');
  const [status, setStatus] = React.useState<ProjectStatus | 'all'>('all');
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<ProjectRow | null>(null);

  /* CHANGE-PLAN 6.3, owner: *"It should be the current projects in lists and
     grids."* Cards default, because a project's shape — how much is done, how
     much is late — reads better as a card than as a row of numbers. The list is
     for comparing many projects on one figure, which cards are bad at. */
  const [view, setView] = React.useState<'grid' | 'list'>('grid');

  const visible = projects.filter((project) => {
    if (type !== 'all' && project.type !== type) return false;
    if (status !== 'all' && project.status !== status) return false;
    return true;
  });

  const pager = usePagination(visible);

  return (
    <div className="space-y-4">
      {/* ── The cards ARE the type filter ─────────────────────────────────────
          They used to sit on the page above this component, counting projects while
          a separate dropdown did the filtering. Owner: *"use a good interactive
          UI."* One control now. */}
      <ProjectFilterCards
        mix={mix}
        active={type}
        onPick={setType}
        total={projects.length}
        otherPct={otherPct}
        otherIsHigh={otherIsHigh}
        otherWarningPct={otherWarningPct}
      />

      <Toolbar aria-label="Project filters">
        {/* Status stays chips rather than a dropdown for the same reason the types
            did: *"I want all filters… status, active, planning, this one, or any
            other status."* Six states fit on a line, and a chip shows which one is
            on without being opened. */}
        <ToolbarGroup>
          <ToolbarLabel>Status</ToolbarLabel>
          <div className="flex flex-wrap gap-1">
            {(['all', ...PROJECT_STATUSES] as const).map((key) => {
              const on = status === key;
              const token =
                key === 'all' ? 'accent-primary' : STATUS_FILTER_TOKEN[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setStatus(on && key !== 'all' ? 'all' : key)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-micro font-semibold',
                    'transition-[background-color,color] duration-[140ms]',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                    on ? '' : 'text-text-secondary hover:bg-bg-hover',
                  )}
                  style={{
                    outlineColor: 'var(--focus-ring)',
                    ...(on
                      ? {
                          backgroundColor: `color-mix(in oklab, var(--${token}) var(--tint-strong), var(--bg-surface))`,
                          color: `color-mix(in oklab, var(--${token}) 84%, var(--text-primary))`,
                        }
                      : {}),
                  }}
                >
                  {key === 'all'
                    ? 'Any'
                    : key.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}
                </button>
              );
            })}
          </div>
        </ToolbarGroup>

        <ToolbarSpacer />

        <ToggleGroup
          label="How to show projects"
          value={view}
          onChange={setView}
          options={[
            { key: 'grid', label: 'Grid', icon: LayoutGrid },
            { key: 'list', label: 'List', icon: Rows3 },
          ]}
        />

        {canManage && (
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            <FolderPlus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            New project
          </Button>
        )}
      </Toolbar>

      {visible.length === 0 ? (
        <Card>
          <CardBody className="px-6 py-14 text-center">
            <p className="text-body-sm font-semibold text-text-primary">No projects match that</p>
            <p className="mt-1 text-caption text-text-secondary">Clear a filter to see the rest.</p>
          </CardBody>
        </Card>
      ) : view === 'list' ? (
        <ProjectTable
          projects={pager.visible}
          canManage={canManage}
          onEdit={setEditing}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pager.visible.map((project) => {
            const meta = PROJECT_TYPE_META[project.type];
            const isClosed = ['completed', 'archived', 'cancelled'].includes(project.status);

            return (
              <Card
                key={project.id}
                /* `group/card` + `relative` so the stretched link below can cover the
                   whole card and the hover state can respond to it. */
                className={cn(
                  'group/card relative transition-[border-color,box-shadow,transform] duration-[160ms]',
                  'hover:-translate-y-px hover:border-border-strong hover:shadow-md',
                  'focus-within:border-border-strong',
                  isClosed && 'opacity-75',
                )}
              >
                <CardBody className="space-y-3.5 p-4">
                  <div className="flex items-start gap-3">
                    <IconTile
                      icon={Package}
                      token={meta.token}
                      size="lg"
                    />
                    <div className="min-w-0 flex-1">
                      {/* ── ⚠️ THE WHOLE CARD IS THE TARGET, VIA ONE REAL LINK ─────
                          Owner, 2026-08-19 (second report): *"the project detail is
                          still not clickable… How can I view their details?"*

                          The name alone was already a link, and that was the bug: a
                          14px run of text is not a discoverable target, and the only
                          PROMINENT link on the card said "Open tasks" and went to the
                          task list — so clicking a project reliably landed somewhere
                          that was not the project.

                          `after:absolute after:inset-0` stretches this one anchor over
                          the entire card. Not a wrapping <a> and not an onClick on the
                          Card: one anchor keeps middle-click, ⌘-click and "copy link"
                          working, keeps the accessible name as the project's name
                          rather than the whole card's text, and leaves exactly one
                          tab stop. Controls that must stay clickable sit above it on
                          `relative z-10` — see the edit button and the footer links. */}
                      <h3 className="truncate text-body font-semibold text-text-primary">
                        <Link
                          href={`/projects/${project.id}`}
                          className={cn(
                            'after:absolute after:inset-0 after:rounded-[inherit] after:content-[""]',
                            'group-hover/card:text-text-brand focus-visible:outline-none',
                          )}
                        >
                          {project.name}
                        </Link>
                      </h3>
                      {/* ── ⚠️ THE PILLS, AND WHAT LEFT ─────────────────────────
                          Owner, 2026-08-19: *"The pills you are using for active and
                          starter are not looking good"* and *"Client name is not
                          necessary."*

                          Gone: the type Badge (the card already sits under a coloured
                          type filter and carries that type's icon tile), and the
                          client name row further down. What is left answers "is this
                          running, is it ours or a client's, and what did they buy" —
                          which is what the owner listed. Status now shows in EVERY
                          state, not only when it is not active: "Active" with a live
                          dot is information, and hiding it made the common case the
                          one with no answer. */}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <StatusPill status={project.status} size="sm" />
                        <KindPill kind={project.clientKind} />
                        <PackagePill name={project.packageName} />
                        <span className="tabular font-mono text-micro font-semibold text-text-tertiary">
                          {project.code}
                        </span>
                      </div>
                    </div>
                    {/* Above the stretched link, or the card swallows the click. */}
                    {canManage && (
                      <span className="relative z-10 shrink-0">
                        <IconButton
                          label={`Edit ${project.name}`}
                          icon={Pencil}
                          size="sm"
                          onClick={() => setEditing(project)}
                        />
                      </span>
                    )}
                  </div>

                  {project.statusReason && (
                    <p
                      className="rounded-md px-2 py-1.5 text-micro"
                      style={{
                        backgroundColor:
                          'color-mix(in oklab, var(--feedback-warning) var(--tint-soft), var(--bg-surface))',
                        color: 'color-mix(in oklab, var(--feedback-warning) 72%, var(--text-primary))',
                      }}
                    >
                      {project.statusReason}
                    </p>
                  )}

                  {/* ── ⚠️ WHAT THE CARD SAYS NOW ────────────────────────────────
                      Owner, 2026-08-19: *"Client name is not necessary. Daniyal
                      Marketing project, that's perfect. How many posts are in this
                      project? How many posts, how many reels, and website: this
                      short information should be displayed in a grid view."*

                      Gone: the description (two lines of prose on every card is the
                      "too much text" being objected to), the client-contact line, and
                      the event date/venue line. The `field()` helper that read them
                      went with them — nothing else used it.

                      What replaced them is the month's delivery against what was
                      promised — which is the question a project card should answer
                      and previously could not. */}
                  <ProjectDelivery project={project} />

                  <PlatformStrip platforms={project.platforms} />

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-subtle pt-3">
                    <span className="tabular text-micro text-text-secondary">
                      <span className="font-semibold text-text-primary">
                        {project.openTaskCount}
                      </span>{' '}
                      open
                    </span>
                    <span className="tabular text-micro text-text-secondary">
                      <span className="font-semibold text-text-primary">{project.effortPoints}</span>{' '}
                      pts committed
                    </span>
                    {project.overdueTaskCount > 0 && (
                      <span
                        className="tabular text-micro font-semibold"
                        style={{ color: 'var(--feedback-error)' }}
                      >
                        {project.overdueTaskCount} late
                      </span>
                    )}
                    {/* ⚠️ "Open tasks" used to sit here alone, on `ml-auto`, as the
                        only prominent link on the card — so the obvious thing to
                        click took you to the task list and never to the project.
                        It stays, because jumping straight to a project's tasks is
                        genuinely useful, but it is now clearly the SECOND action and
                        the primary one names its destination. Both need `z-10` to
                        sit above the card's stretched link. */}
                    <span className="relative z-10 ml-auto flex items-center gap-3">
                      <Link
                        href={`/tasks?project=${project.id}`}
                        className="text-micro font-medium text-text-secondary hover:text-text-primary hover:underline"
                      >
                        Tasks
                      </Link>
                      <Link
                        href={`/projects/${project.id}`}
                        className="inline-flex items-center gap-0.5 text-micro font-semibold text-text-brand hover:underline"
                      >
                        View details
                        <ChevronRight
                          className="h-3.5 w-3.5 transition-transform duration-150 group-hover/card:translate-x-0.5"
                          strokeWidth={2.5}
                          aria-hidden="true"
                        />
                      </Link>
                    </span>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <Pagination
        page={pager.page}
        pageCount={pager.pageCount}
        onPage={pager.setPage}
        from={pager.from}
        to={pager.to}
        total={pager.total}
        label="projects"
      />

      <ProjectDialog
        open={creating}
        onClose={() => setCreating(false)}
        people={people}
        canSeeFinance={canSeeFinance}
      />
      {editing && (
        <ProjectDialog
          open
          onClose={() => setEditing(null)}
          people={people}
          project={editing}
          canSeeFinance={canSeeFinance}
        />
      )}
    </div>
  );
}

/* ============================================================================
 * THE LIST VIEW — CHANGE-PLAN 6.3
 * ----------------------------------------------------------------------------
 * ── WHY THIS IS NOT THE SAME INFORMATION IN A NARROWER SHAPE ──────────────────
 * A card answers *"how is this project doing?"* — one project at a time, with a
 * progress bar and the type-specific line that only makes sense in context.
 * A list answers a different question: *"which of these is furthest behind?"*
 * That is a comparison, and comparison needs the numbers in aligned columns
 * where the eye can run down one of them.
 *
 * So the list is not a squashed card. It drops the description, the status
 * reason and the progress bar — none of which compare usefully — and shows the
 * counts as right-aligned tabular figures instead.
 *
 * The toggle deliberately does not persist. A view is a momentary intent ("let
 * me compare these"), not a preference, and coming back tomorrow to a list you
 * chose once is a small surprise every time.
 * ========================================================================= */

function ProjectTable({
  projects,
  canManage,
  onEdit,
}: {
  projects: readonly ProjectRow[];
  canManage: boolean;
  onEdit: (project: ProjectRow) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr className="border-b border-border-default bg-bg-surface-sunken">
              {/* ── ⚠️ THE COLUMNS CHANGED, FOR THE SAME REASON THE CARD DID ─────
                  Owner, 2026-08-19: *"The grid view and the list view of a project
                  are not good."* and *"How many posts, how many reels, and website."*

                  Out: Type (the filter cards above say it, in colour), and
                  Done/Complete — both measured TASK completion, which is a fact about
                  the CRM rather than about the client. A project can close every task
                  and have published nothing.

                  In: Posts and Reels published this month against what was promised,
                  Platforms as brand marks, and Includes. Open/Late/Points stay
                  because comparing many projects on one figure is what a list is for
                  and cards are bad at. */}
              <th scope="col" className={thLeft}>Project</th>
              <th scope="col" className={thLeft}>Status</th>
              <th scope="col" className={thRight}>Posts</th>
              <th scope="col" className={thRight}>Reels</th>
              <th scope="col" className={thLeft}>Platforms</th>
              <th scope="col" className={thLeft}>Includes</th>
              <th scope="col" className={thRight}>Open</th>
              <th scope="col" className={thRight}>Late</th>
              <th scope="col" className={thRight}>Points</th>
              <th scope="col" className="w-px" />
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => {
              const meta = PROJECT_TYPE_META[project.type];
              const isClosed = ['completed', 'archived', 'cancelled'].includes(project.status);

              return (
                <tr
                  key={project.id}
                  className={cn(
                    'border-b border-border-subtle last:border-0 hover:bg-bg-hover',
                    isClosed && 'opacity-70',
                  )}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="h-3.5 w-[3px] shrink-0 rounded-full"
                        style={{ backgroundColor: `var(--${meta.token})` }}
                      />
                      <div className="min-w-0">
                        {/* ⚠️ The list view had NO link to the project at all — the
                            name was a plain <p>. Owner, 2026-08-19: *"In Project
                            Blogs or a project card, it is not clickable."* The grid
                            at least linked the name; this did not, so switching to
                            List made a project unreachable.

                            A link on the name rather than a stretched overlay across
                            the row: `position: relative` on a <tr> is unreliable
                            across browsers, and the trailing chevron below gives the
                            row a second, larger target without betting on it. */}
                        <p className="truncate text-body-sm font-medium">
                          <Link
                            href={`/projects/${project.id}`}
                            className="text-text-primary hover:text-text-brand hover:underline"
                          >
                            {project.name}
                          </Link>
                        </p>
                        <p className="tabular font-mono text-micro text-text-tertiary">
                          {project.code}
                        </p>
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-2.5">
                    <StatusPill status={project.status} size="sm" />
                  </td>

                  {/* Posts and reels published THIS MONTH against what was promised.
                      The bare done/total task counts they replaced described the CRM,
                      not the client. */}
                  <td className={tdNum}>
                    <span className="font-semibold text-text-primary">
                      {project.assetsPublishedThisMonth}
                    </span>
                    {project.assetsTargetMin !== null && (
                      <span className="text-text-tertiary"> / {project.assetsTargetMin}</span>
                    )}
                  </td>
                  <td className={tdNum}>
                    <span className="font-semibold text-text-primary">
                      {project.reelsPublishedThisMonth}
                    </span>
                    {project.reelsTargetMin !== null && (
                      <span className="text-text-tertiary"> / {project.reelsTargetMin}</span>
                    )}
                  </td>

                  <td className="px-3 py-2.5">
                    <PlatformStrip platforms={project.platforms} size={16} />
                  </td>

                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1">
                      <IncludesPills
                        website={project.packageIncludesWebsite}
                        crm={project.packageIncludesCrm}
                      />
                    </div>
                  </td>
                  <td className={tdNum}>{project.openTaskCount}</td>
                  <td className={tdNum}>
                    {project.overdueTaskCount > 0 ? (
                      <span className="font-semibold" style={{ color: 'var(--feedback-error)' }}>
                        {project.overdueTaskCount}
                      </span>
                    ) : (
                      <span className="text-text-disabled">—</span>
                    )}
                  </td>
                  <td className={tdNum}>{project.effortPoints}</td>

                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/tasks?project=${project.id}`}
                        className="inline-flex h-8 items-center rounded-md px-2.5 text-micro font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                      >
                        Tasks
                      </Link>
                      {canManage && (
                        <IconButton
                          label={`Edit ${project.name}`}
                          icon={Pencil}
                          size="sm"
                          onClick={() => onEdit(project)}
                        />
                      )}
                      {/* The row's own way in. An icon-sized target at a predictable
                          position beats hoping the reader finds the name. */}
                      <Link
                        href={`/projects/${project.id}`}
                        aria-label={`Open ${project.name}`}
                        title={`Open ${project.name}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-bg-hover hover:text-text-brand"
                      >
                        <ChevronRight className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thBase =
  'py-2 text-micro font-semibold tracking-[0.07em] text-text-tertiary uppercase';
const thLeft = `px-3 text-left ${thBase}`;
const thRight = `px-3 text-right ${thBase}`;
const tdNum = 'tabular px-3 py-2.5 text-right text-caption text-text-secondary';
