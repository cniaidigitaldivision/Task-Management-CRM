'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, FolderPlus, LayoutGrid, Package, Pencil, Rows3 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { Pagination, usePagination } from '@/components/ui/pagination';
import { ProgressBar } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
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
  PROJECT_TYPES,
  PROJECT_TYPE_META,
  type ProjectStatus,
  type ProjectType,
} from '@/lib/domain/constants';

import { cn } from '@/lib/utils';

import { ProjectDialog } from './project-dialog';

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

/**
 * Read one type-specific field as text.
 *
 * `type_fields` is jsonb, so every value arrives as `unknown` — deliberately: the
 * shape depends on the project's type and the database does not police it. This
 * is the single narrowing point, so no `unknown` reaches JSX and no card can
 * render `[object Object]` because somebody stored a nested value.
 */
function field(project: ProjectRow, key: string): string | null {
  const value = project.typeFields?.[key];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return null;
  return String(value);
}

export function ProjectsWorkspace({
  projects,
  people,
  canManage,
  canSeeFinance,
}: {
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

  /* The totals below count the whole filtered set, not the page — a footer that
     said "18 open tasks" while showing page 2 of 3 would be describing nothing. */
  const totalOpen = visible.reduce((sum, p) => sum + p.openTaskCount, 0);
  const totalPoints = visible.reduce((sum, p) => sum + p.effortPoints, 0);

  const pager = usePagination(visible);

  return (
    <div className="space-y-4">
      <Toolbar aria-label="Project filters">
        <ToolbarGroup>
          <ToolbarLabel>Type</ToolbarLabel>
          <Select
            label="Filter by project type"
            value={type}
            onChange={(event) => setType(event.target.value as ProjectType | 'all')}
            options={[
              { value: 'all', label: 'Every type' },
              ...PROJECT_TYPES.map((t) => ({ value: t, label: PROJECT_TYPE_META[t].label })),
            ]}
            className="w-[11rem]"
          />
        </ToolbarGroup>

        <ToolbarGroup>
          <ToolbarLabel>Status</ToolbarLabel>
          <Select
            label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value as ProjectStatus | 'all')}
            options={[
              { value: 'all', label: 'Any status' },
              ...PROJECT_STATUSES.map((s) => ({
                value: s,
                label: s.replace('_', ' ').replace(/^./, (c) => c.toUpperCase()),
              })),
            ]}
            className="w-[10rem]"
          />
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

        <span className="text-caption text-text-secondary">
          <span className="tabular font-semibold text-text-primary">{totalOpen}</span> open ·{' '}
          <span className="tabular font-semibold text-text-primary">{totalPoints}</span> pts
        </span>

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
            const donePct =
              project.taskCount > 0
                ? Math.round((project.doneTaskCount / project.taskCount) * 100)
                : 0;
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
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge token={meta.token} size="sm">
                          {meta.label}
                        </Badge>
                        <span className="tabular font-mono text-micro font-semibold text-text-tertiary">
                          {project.code}
                        </span>
                        {project.status !== 'active' && (
                          <Badge
                            token={project.status === 'on_hold' ? 'feedback-warning' : 'neutral-500'}
                            size="sm"
                            variant="outline"
                          >
                            {project.status.replace('_', ' ')}
                          </Badge>
                        )}
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

                  {project.description && (
                    <p className="line-clamp-2 text-caption text-text-secondary">
                      {project.description}
                    </p>
                  )}

                  {/* The type-specific line: the client contact on a client card,
                      the date and venue on an event, nothing on the rest.
                      `field()` narrows `unknown` to a string in one place, so no
                      untyped jsonb value reaches JSX. */}
                  {project.type === 'client' && field(project, 'client_name') && (
                    <p className="text-micro text-text-tertiary">
                      {field(project, 'client_name')}
                      {field(project, 'contact_person') && <> · {field(project, 'contact_person')}</>}
                      {field(project, 'retainer_hours_per_month') && (
                        <> · {field(project, 'retainer_hours_per_month')}h retainer</>
                      )}
                    </p>
                  )}
                  {project.type === 'event' && field(project, 'event_date') && (
                    <p className="text-micro text-text-tertiary">
                      {field(project, 'event_date')}
                      {field(project, 'venue') && <> · {field(project, 'venue')}</>}
                    </p>
                  )}

                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-micro text-text-tertiary">
                        <span className="tabular font-semibold text-text-primary">
                          {project.doneTaskCount}
                        </span>{' '}
                        of {project.taskCount} done
                      </span>
                      <span className="tabular text-caption font-semibold text-text-primary">
                        {donePct}%
                      </span>
                    </div>
                    <ProgressBar
                      value={donePct}
                      token="accent-primary"
                      size="md"
                      label={`${project.name}: ${donePct}% complete`}
                    />
                  </div>

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
              <th scope="col" className={thLeft}>Project</th>
              <th scope="col" className={thLeft}>Type</th>
              <th scope="col" className={thLeft}>Status</th>
              <th scope="col" className={thRight}>Done</th>
              <th scope="col" className={thRight}>Open</th>
              <th scope="col" className={thRight}>Late</th>
              <th scope="col" className={thRight}>Points</th>
              <th scope="col" className={thRight}>Complete</th>
              <th scope="col" className="w-px" />
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => {
              const meta = PROJECT_TYPE_META[project.type];
              const donePct =
                project.taskCount > 0
                  ? Math.round((project.doneTaskCount / project.taskCount) * 100)
                  : 0;
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
                    <Badge token={meta.token} size="sm" variant="outline">
                      {meta.label}
                    </Badge>
                  </td>

                  <td className="px-3 py-2.5">
                    {project.status === 'active' ? (
                      <span className="text-caption text-text-secondary">Active</span>
                    ) : (
                      <Badge
                        token={project.status === 'on_hold' ? 'feedback-warning' : 'neutral-500'}
                        size="sm"
                        variant="outline"
                      >
                        {project.status.replace(/_/g, ' ')}
                      </Badge>
                    )}
                  </td>

                  <td className={tdNum}>
                    {project.doneTaskCount}
                    <span className="text-text-tertiary"> / {project.taskCount}</span>
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

                  {/* A bar this narrow cannot be read as a proportion, so the
                      number leads and the bar is a hint beside it. */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <span className="tabular text-caption font-semibold text-text-primary">
                        {donePct}%
                      </span>
                      <span className="w-16 shrink-0">
                        <ProgressBar
                          value={donePct}
                          token="accent-primary"
                          size="sm"
                          label={`${project.name}: ${donePct}% complete`}
                        />
                      </span>
                    </div>
                  </td>

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
