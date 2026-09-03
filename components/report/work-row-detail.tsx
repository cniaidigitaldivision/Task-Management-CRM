'use client';

import * as React from 'react';
import { ExternalLink } from 'lucide-react';

import { PLATFORM_MARKS, PlatformIcon } from '@/components/brand/platform-icon';
import { Avatar } from '@/components/ui/avatar';
import { Dialog } from '@/components/ui/dialog';
import { STATUS_META } from '@/lib/domain/constants';
import { WORK_STATUS_META, type WorkRow, type WorkTaskLine } from '@/lib/domain/work-report';

/* ============================================================================
 * ONE ROW, OPENED
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-03: *"when I click on any row it will pop up in a proper sleek
 * way. Display all related to that task, like this project, this person, he done
 * this, these are the platforms, these are the platform URLs, these are the
 * total tasks over this row. It's a summary. The task description must display
 * over there. Don't just put dummy data in the pop-up."*
 *
 * ── ⚠️ EVERY FIELD COMES FROM THE ROW THAT WAS CLICKED ──────────────────────
 * Nothing here is fetched and nothing is invented. `WorkRow.tasks` was added for
 * this panel and carries the title, the reference, the description, the
 * category, the status and the live links; `ReportTask` gained `description` and
 * `links` in the same change because neither existed, and a panel built without
 * them could only have repeated what the row already showed.
 *
 * ── WHY A DIALOG AND NOT AN EXPANDING ROW ───────────────────────────────────
 * The table is twelve columns wide and already scrolls sideways. An expanding
 * row would put the detail inside that scroll, so reading a description would
 * mean scrolling horizontally to find where it starts.
 *
 * ── ⚠️ REWORKED AFTER THE OWNER SAW IT, THE SAME DAY ────────────────────────
 * Two faults, both fixed here.
 *
 * 1. THE PROJECT WAS NOT PROMINENT. *"the project in which this task is
 *    mentioned is not made prominent… ETEMAAD100 GROUP is a project so make it
 *    prominent."* It was the small grey subtitle under the person's name — and
 *    the card directly beneath then printed BOTH names again, so the panel
 *    opened by saying the same two facts twice and emphasising neither. The
 *    project is now the heading, that duplicate card is gone, and an eyebrow
 *    labels it "Project", because part of the complaint was that nothing said
 *    which of the two names was which.
 *
 * 2. THE DESCRIPTION VANISHED WHEN THERE WAS NONE. *"The description must show
 *    because some person maybe added some description and the reason… That's the
 *    main purpose of this modal: to display their description exactly here."*
 *    It rendered only when present, so a task without one showed no trace of the
 *    field at all. It is now ALWAYS in the same place — see `Description`.
 * ========================================================================= */

export function WorkRowDetail({ row, onClose }: { row: WorkRow; onClose: () => void }) {
  const status = WORK_STATUS_META[row.status];
  const taskCount = row.tasks.length;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      /* The accessible name. Both halves, because a screen reader is given this
         instead of the layout that separates them. */
      title={`${row.projectName} — ${row.personName}`}
      header={
        <div className="min-w-0">
          <p className="text-micro font-semibold uppercase tracking-[0.08em] text-text-tertiary">
            Project
          </p>

          {/* ⚠️ THE HEADING, and deliberately not truncated. The project name is
              what the reader opened this for; "ETEMAAD100 GRO…" is the fault
              being fixed, not a tidier form of it. It wraps instead. */}
          <h2 className="mt-0.5 text-h2 font-semibold leading-tight text-text-primary [text-wrap:balance]">
            {row.projectName}
          </h2>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="inline-flex min-w-0 items-center gap-2">
              <Avatar name={row.personName} src={row.avatarUrl} size="xs" />
              <span className="truncate text-body-sm font-medium text-text-primary">
                {row.personName}
              </span>
            </span>

            <span aria-hidden="true" className="text-text-disabled">
              ·
            </span>

            <span className="text-caption text-text-secondary">
              {taskCount} {taskCount === 1 ? 'task' : 'tasks'} in this period
            </span>

            <span
              className="ml-auto shrink-0 rounded-full px-2.5 py-1 text-micro font-semibold"
              style={{
                backgroundColor: `color-mix(in oklab, var(--${status.token}) 14%, transparent)`,
                color: `var(--${status.token})`,
              }}
            >
              {status.label}
            </span>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* ── The four counts the row itself showed ───────────────────────── */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Count label="Assigned" value={row.tasksAssigned} />
          {/* Colour only where a figure carries a meaning: finished work reads as
              success, outstanding work as a warning. A zero stays neutral, so a
              clean row is not decorated for having nothing in it. */}
          <Count label="Done" value={row.tasksDone} tone="feedback-success" />
          <Count label="Pending" value={row.tasksPending} tone="feedback-warning" />
          <Count label="Posts published" value={row.postsPublished} tone="text-brand" />
        </div>

        {/* ── Every platform the row reached ─────────────────────────────── */}
        {row.platforms.length > 0 && (
          <section className="space-y-2">
            <SectionLabel>Platforms reached</SectionLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {row.platforms.map((slug) => (
                <span
                  key={slug}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-surface px-2 py-1 text-caption text-text-secondary"
                >
                  <PlatformIcon slug={slug} size={14} />
                  {/* The mark's own label, never the slug capitalised — that
                      printed "Tiktok" beside a TikTok logo. */}
                  {PLATFORM_MARKS[slug]?.label ?? slug}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ── The work itself ────────────────────────────────────────────── */}
        <section className="space-y-2">
          <SectionLabel>
            The work
            {taskCount > 0 && (
              <span className="ml-1.5 font-normal normal-case tracking-normal text-text-tertiary">
                ({taskCount})
              </span>
            )}
          </SectionLabel>

          {taskCount === 0 ? (
            <p className="rounded-xl border border-dashed border-border-default px-3.5 py-4 text-caption text-text-tertiary">
              Nothing is recorded against {row.personName} on this project in this period.
            </p>
          ) : (
            <ul className="space-y-2">
              {row.tasks.map((task) => (
                <TaskCard key={task.reference} task={task} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Dialog>
  );
}

/* ---- One task ------------------------------------------------------------ */

function TaskCard({ task }: { task: WorkTaskLine }) {
  const meta = STATUS_META[task.status];
  /* Only placements that actually have a link. A destination with no URL is a
     plan, and listing it as something to open is the "dummy data" the owner
     asked not to see. */
  const live = task.links.filter((link) => link.url);

  return (
    <li className="space-y-2.5 rounded-xl border border-border-default bg-bg-surface px-3.5 py-3">
      <header className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5">
        <h4 className="min-w-0 flex-1 text-body-sm font-semibold leading-snug text-text-primary">
          {task.title}
        </h4>
        <span className="shrink-0 font-mono text-micro text-text-tertiary">{task.reference}</span>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-micro font-semibold"
          style={{
            backgroundColor: `color-mix(in oklab, var(--${meta.token}) 14%, transparent)`,
            color: `var(--${meta.token})`,
          }}
        >
          {task.statusLabel}
        </span>
      </header>

      <p className="flex flex-wrap items-center gap-x-1.5 text-micro text-text-tertiary">
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: `var(--${meta.token})` }}
        />
        <span>{task.category}</span>
        {task.publishedOn && <span>· published {task.publishedOn}</span>}
        {!task.publishedOn && task.dueDate && <span>· due {task.dueDate}</span>}
      </p>

      <Description text={task.description} />

      {live.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {live.map((link) => (
            <a
              key={`${link.slug}-${link.url}`}
              href={link.url ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-subtle px-2 py-1 text-micro font-medium text-text-brand transition-colors hover:border-border-default"
            >
              <PlatformIcon slug={link.slug} size={13} />
              {link.platformName}
              <ExternalLink className="size-3 opacity-70" aria-hidden="true" />
            </a>
          ))}
        </div>
      )}

      {/* Said rather than left blank: a post with no link is a real state, and one
          the report elsewhere asks somebody to fix. */}
      {task.links.length > 0 && live.length === 0 && (
        <p className="text-micro text-text-tertiary">Destinations recorded, no live link yet.</p>
      )}
    </li>
  );
}

/**
 * The task's description — ALWAYS, present or not.
 *
 * ── ⚠️ WHY THE EMPTY CASE IS DRAWN RATHER THAN SKIPPED ──────────────────────
 * Owner: *"The description must show… If there is no description then show no
 * description."* Rendering it only when present leaves a reader unable to tell
 * "nobody wrote anything here" from "this panel does not show descriptions" —
 * and it is the second reading that makes somebody stop trusting the panel. A
 * fixed position answers the question either way.
 *
 * ── ⚠️ "BEYOND THE TITLE", BECAUSE THAT IS TRUE IN BOTH CASES ───────────────
 * `null` arrives here for two different reasons: the description really is
 * empty, or `buildWorkReport` dropped one that repeated the title word for word.
 * The second is common — people paste the same sentence into both boxes, and
 * CLI-1556 does exactly that. "No description was added" would be a lie about
 * that task, so neither is claimed: what the reader needs to know is that there
 * is nothing here the title has not already told them.
 */
function Description({ text }: { text: string | null }) {
  if (!text) {
    return (
      <p className="rounded-lg border border-dashed border-border-subtle px-2.5 py-2 text-micro text-text-tertiary">
        No description beyond the title.
      </p>
    );
  }

  return (
    /* ⚠️ `whitespace-pre-line`, and untruncated. These are typed by hand and
       arrive with real line breaks — BIZ-806 is a list of the day's work, one
       item per line, which collapses into a single paragraph without this. This
       panel is where somebody comes to read the brief, so it is shown in full. */
    <p className="whitespace-pre-line rounded-lg bg-bg-surface-sunken px-2.5 py-2 text-caption leading-relaxed text-text-secondary">
      {text}
    </p>
  );
}

/* ---- Small parts --------------------------------------------------------- */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-micro font-semibold uppercase tracking-[0.08em] text-text-tertiary">
      {children}
    </h3>
  );
}

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  /** A token name, applied only when the figure is non-zero. See the call site. */
  tone?: string;
}) {
  const coloured = tone !== undefined && value > 0;

  return (
    <div className="rounded-xl border border-border-default bg-bg-surface px-3 py-2">
      <p
        className="text-h3 font-semibold leading-none tabular-nums text-text-primary"
        style={coloured ? { color: `var(--${tone})` } : undefined}
      >
        {value}
      </p>
      <p className="mt-1 text-micro text-text-secondary">{label}</p>
    </div>
  );
}
