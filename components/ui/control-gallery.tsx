'use client';

import * as React from 'react';
import { CheckCircle2, Filter, Flag, Plus, Trash2, User, XCircle } from 'lucide-react';

import { Button, ButtonGroup, IconButton } from './button';
import { CONTROL_HEIGHT, type ControlSize } from './control';
import { Field, Input, SearchInput } from './input';
import { FilterChip } from './page-header';
import { Select } from './select';
import { ToggleButton, ToggleGroup, Toolbar, ToolbarGroup, ToolbarLabel } from './toolbar';

/* ============================================================================
 * CONTROL GALLERY — every interactive element, side by side
 * ----------------------------------------------------------------------------
 * ── WHY THIS PAGE SECTION EXISTS ─────────────────────────────────────────────
 * The owner's report was "some buttons are big and some are small". They were
 * right, and the reason it took a person to notice is that nothing ever showed
 * the controls TOGETHER — each looked fine on the screen it lived on.
 *
 * This puts one of everything in a row, at each size, over a ruled line. A
 * control that is two pixels short of its neighbours is invisible in isolation
 * and obvious here. It is a regression test that happens to be readable.
 * ========================================================================= */

const SIZES: readonly ControlSize[] = ['sm', 'md', 'lg'];

const SIZE_NOTE: Readonly<Record<ControlSize, string>> = {
  sm: '32px — dense toolbars, where controls sit in a row together',
  md: '36px — the default for anything aimed at with a mouse',
  lg: '44px — the primary action on an empty screen, and every touch target',
};

/** A ruled line behind a row. Any control off the scale breaks the line. */
function AlignmentRow({ size, children }: { size: ControlSize; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <code className="rounded bg-bg-active px-1.5 py-0.5 text-micro font-semibold text-text-primary">
          {size}
        </code>
        <span className="text-micro text-text-tertiary">{SIZE_NOTE[size]}</span>
      </div>

      <div className="relative rounded-lg border border-dashed border-border-default px-3 py-4">
        {/* The guide: every control's top and bottom edge should touch these. */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute top-1/2 left-0 w-full -translate-y-1/2 ${CONTROL_HEIGHT[size]}`}
          style={{
            borderTop: '1px dashed color-mix(in oklab, var(--accent-primary) 40%, transparent)',
            borderBottom: '1px dashed color-mix(in oklab, var(--accent-primary) 40%, transparent)',
          }}
        />
        <div className="relative flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </div>
  );
}

export function ControlGallery() {
  const [group, setGroup] = React.useState<'list' | 'board'>('list');
  const [pressed, setPressed] = React.useState(false);
  const [priority, setPriority] = React.useState('all');

  return (
    <div className="space-y-8">
      {/* ---- One row per size ---- */}
      <div className="space-y-5">
        {SIZES.map((size) => (
          <AlignmentRow key={size} size={size}>
            <Button variant="primary" size={size}>
              <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
              Primary
            </Button>
            <Button variant="secondary" size={size}>
              Secondary
            </Button>
            <Button variant="subtle" size={size}>
              Subtle
            </Button>
            <Button variant="ghost" size={size}>
              Ghost
            </Button>
            <Button variant="gold" size={size}>
              Gold
            </Button>
            <Button variant="danger" size={size}>
              Danger
            </Button>
            {/* The three semantic ghosts, shown together because their whole
                purpose is that they are used consistently: green approves,
                orange refuses, red deletes, everywhere in the application. */}
            <IconButton label="Approve" icon={CheckCircle2} size={size} variant="approveGhost" />
            <IconButton label="Refuse" icon={XCircle} size={size} variant="refuseGhost" />
            <IconButton label="Delete" icon={Trash2} size={size} variant="deleteGhost" />
            <Select
              label="Example select"
              size={size}
              icon={Flag}
              options={[
                { value: 'all', label: 'Any priority' },
                { value: 'urgent', label: 'Urgent' },
              ]}
              className="w-[9.5rem]"
            />
            <Input size={size} placeholder="Text field" className="w-40" />
            <FilterChip label="Period" value="Week 32" size={size} />
          </AlignmentRow>
        ))}
      </div>

      {/* ---- Composite controls ---- */}
      <div className="space-y-3">
        <h3 className="text-h3 text-text-primary">Composite controls</h3>
        <p className="max-w-2xl text-body-sm text-text-secondary">
          A toggle group, a toggle button and a button group all take their height from the same
          scale, so a toolbar built from them is one straight line rather than four.
        </p>
        <div className="rounded-lg border border-dashed border-border-default px-3 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              label="View"
              value={group}
              onChange={setGroup}
              options={[
                { key: 'list', label: 'List' },
                { key: 'board', label: 'Board' },
              ]}
            />
            <ToggleButton pressed={pressed} onChange={setPressed} icon={Filter}>
              {pressed ? 'Filtered' : 'No filter'}
            </ToggleButton>
            <ButtonGroup>
              <Button variant="secondary" size="sm">
                Day
              </Button>
              <Button variant="secondary" size="sm">
                Week
              </Button>
              <Button variant="secondary" size="sm">
                Month
              </Button>
            </ButtonGroup>
            <SearchInput label="Search" placeholder="Search…" shortcut="⌘K" size="sm" className="w-56" />
          </div>
        </div>
      </div>

      {/* ---- A real toolbar ---- */}
      <div className="space-y-3">
        <h3 className="text-h3 text-text-primary">A toolbar, as it appears on Tasks</h3>
        <p className="max-w-2xl text-body-sm text-text-secondary">
          The row wraps rather than pushing the page sideways. Narrow this window and it folds onto
          a second line — it never produces a horizontal scrollbar on the page.
        </p>
        <div className="rounded-lg border border-border-default bg-bg-surface p-3 shadow-xs">
          <Toolbar aria-label="Example filters">
            <ToolbarGroup>
              <ToolbarLabel>Group</ToolbarLabel>
              <ToggleGroup
                label="Group by"
                value={group}
                onChange={setGroup}
                options={[
                  { key: 'list', label: 'Status' },
                  { key: 'board', label: 'Project' },
                ]}
              />
            </ToolbarGroup>
            <ToolbarGroup>
              <ToolbarLabel>Priority</ToolbarLabel>
              <Select
                label="Priority"
                icon={Flag}
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                options={[
                  { value: 'all', label: 'Any priority' },
                  { value: 'urgent', label: 'Urgent' },
                  { value: 'high', label: 'High' },
                ]}
                className="w-[9.5rem]"
              />
            </ToolbarGroup>
            <ToolbarGroup>
              <ToolbarLabel>Assignee</ToolbarLabel>
              <Select
                label="Assignee"
                icon={User}
                options={[{ value: 'all', label: 'Everyone' }]}
                className="w-[11rem]"
              />
            </ToolbarGroup>
            <ToggleButton pressed={pressed} onChange={setPressed} icon={Filter}>
              Closed hidden
            </ToggleButton>
          </Toolbar>
        </div>
      </div>

      {/* ---- Form fields ---- */}
      <div className="space-y-3">
        <h3 className="text-h3 text-text-primary">Form fields</h3>
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Field label="Task title" hint="Short and specific — it appears on the board card.">
            <Input placeholder="Edit the launch reel" />
          </Field>
          <Field label="Time limit" error="Only an Admin may change this once work has started.">
            <Input placeholder="4h" invalid />
          </Field>
        </div>
      </div>
    </div>
  );
}
