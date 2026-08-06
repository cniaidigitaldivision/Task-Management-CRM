'use client';

import * as React from 'react';
import Link from 'next/link';
import { FolderPlus, Package, Pencil } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { ProgressBar } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { Toolbar, ToolbarGroup, ToolbarLabel, ToolbarSpacer } from '@/components/ui/toolbar';
import type { ProjectRow } from '@/lib/db/queries/types';
import {
  PROJECT_STATUSES,
  PROJECT_TYPES,
  PROJECT_TYPE_META,
  type ProjectStatus,
  type ProjectType,
} from '@/lib/domain/constants';

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
}: {
  projects: readonly ProjectRow[];
  people: ReadonlyArray<{ id: string; name: string }>;
  /** Admin and above — doc 03 §3.2. */
  canManage: boolean;
}) {
  const [type, setType] = React.useState<ProjectType | 'all'>('all');
  const [status, setStatus] = React.useState<ProjectStatus | 'all'>('all');
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<ProjectRow | null>(null);

  const visible = projects.filter((project) => {
    if (type !== 'all' && project.type !== type) return false;
    if (status !== 'all' && project.status !== status) return false;
    return true;
  });

  const totalOpen = visible.reduce((sum, p) => sum + p.openTaskCount, 0);
  const totalPoints = visible.reduce((sum, p) => sum + p.effortPoints, 0);

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
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => {
            const meta = PROJECT_TYPE_META[project.type];
            const donePct =
              project.taskCount > 0
                ? Math.round((project.doneTaskCount / project.taskCount) * 100)
                : 0;
            const isClosed = ['completed', 'archived', 'cancelled'].includes(project.status);

            return (
              <Card key={project.id} className={isClosed ? 'opacity-75' : undefined}>
                <CardBody className="space-y-3.5 p-4">
                  <div className="flex items-start gap-3">
                    <IconTile
                      icon={Package}
                      token={meta.token}
                      size="lg"
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-body font-semibold text-text-primary">
                        {project.name}
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
                    {canManage && (
                      <IconButton
                        label={`Edit ${project.name}`}
                        icon={Pencil}
                        size="sm"
                        onClick={() => setEditing(project)}
                      />
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
                    <Link
                      href={`/tasks?project=${project.id}`}
                      className="ml-auto text-micro font-semibold text-text-brand hover:underline"
                    >
                      Open tasks
                    </Link>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <ProjectDialog open={creating} onClose={() => setCreating(false)} people={people} />
      {editing && (
        <ProjectDialog
          open
          onClose={() => setEditing(null)}
          people={people}
          project={editing}
        />
      )}
    </div>
  );
}
