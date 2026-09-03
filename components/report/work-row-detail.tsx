'use client';

import * as React from 'react';
import { ExternalLink } from 'lucide-react';

import { PLATFORM_MARKS, PlatformIcon } from '@/components/brand/platform-icon';
import { Avatar } from '@/components/ui/avatar';
import { Dialog } from '@/components/ui/dialog';
import { STATUS_META } from '@/lib/domain/constants';
import { WORK_STATUS_META, type WorkRow } from '@/lib/domain/work-report';

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
 * Nothing here is fetched and nothing is invented. `WorkRow.tasks` was added
 * for this panel and carries the title, the reference, the description, the
 * category, the status and the live links; `ReportTask` gained `description`
 * and `links` in the same change because neither existed and a panel built
 * without them could only have repeated what the row already showed.
 *
 * ── WHY A DIALOG AND NOT AN EXPANDING ROW ───────────────────────────────────
 * The table is twelve columns wide and already scrolls sideways. An expanding
 * row would put the detail inside that scroll, so reading a description would
 * mean scrolling horizontally to find where it starts. A dialog is the full
 * width of the screen and does not disturb the row somebody wants to go back to.
 * ========================================================================= */

export function WorkRowDetail({ row, onClose }: { row: WorkRow; onClose: () => void }) {
  const status = WORK_STATUS_META[row.status];

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={row.personName}
      description={`${row.projectName} — ${row.tasks.length} ${row.tasks.length === 1 ? 'task' : 'tasks'} in this period`}
    >
      <div className="space-y-4">
        {/* ── Who, where, and how it stands ──────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border-default bg-bg-subtle px-3.5 py-3">
          <Avatar name={row.personName} src={row.avatarUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-sm font-semibold text-text-primary">
              {row.personName}
            </p>
            <p className="truncate text-caption text-text-secondary">{row.projectName}</p>
          </div>

          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-micro font-semibold"
            style={{
              backgroundColor: `color-mix(in oklab, var(--${status.token}) 14%, transparent)`,
              color: `var(--${status.token})`,
            }}
          >
            {status.label}
          </span>
        </div>

        {/* ── The four counts the row shows, so the panel agrees with it ─── */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Count label="Assigned" value={row.tasksAssigned} />
          <Count label="Done" value={row.tasksDone} />
          <Count label="Pending" value={row.tasksPending} />
          <Count label="Posts published" value={row.postsPublished} />
        </div>

        {/* ── Every platform the row reached ─────────────────────────────── */}
        {row.platforms.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-micro font-semibold uppercase tracking-wide text-text-tertiary">
              Platforms reached
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {row.platforms.map((slug) => (
                <span
                  key={slug}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-2 py-1 text-caption text-text-secondary"
                >
                  <PlatformIcon slug={slug} size={14} />
                  {/* ⚠️ THE MARK'S OWN LABEL, NOT THE SLUG CAPITALISED. That is
                      what the first version did, and it printed "Tiktok" beside
                      a TikTok logo — visibly wrong on screen, and wrong the same
                      way for "Youtube", "Whatsapp" and "Linkedin". The slug is a
                      database key; only the catalogue knows where the capitals
                      go. Falls back to the slug for a platform the marks do not
                      carry, which is better than an empty chip. */}
                  {PLATFORM_MARKS[slug]?.label ?? slug}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── The work itself ────────────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-micro font-semibold uppercase tracking-wide text-text-tertiary">
            The work
          </p>

          {row.tasks.length === 0 ? (
            <p className="text-caption text-text-tertiary">
              Nothing is recorded against {row.personName} on this project in this period.
            </p>
          ) : (
            <div className="space-y-2">
              {row.tasks.map((task) => {
                const meta = STATUS_META[task.status];
                /* Only placements that actually have a link. A destination with
                   no URL is a plan, and listing it as a link somebody can open
                   is the "dummy data" the owner asked not to see. */
                const live = task.links.filter((link) => link.url);

                return (
                  <article
                    key={task.reference}
                    className="space-y-1.5 rounded-xl border border-border-default bg-bg-surface px-3.5 py-3"
                  >
                    <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="min-w-0 flex-1 text-body-sm font-semibold text-text-primary">
                        {task.title}
                      </span>
                      <span className="font-mono text-micro text-text-tertiary">
                        {task.reference}
                      </span>
                      <span
                        className="rounded-full px-2 py-0.5 text-micro font-semibold"
                        style={{
                          backgroundColor: `color-mix(in oklab, var(--${meta.token}) 14%, transparent)`,
                          color: `var(--${meta.token})`,
                        }}
                      >
                        {task.statusLabel}
                      </span>
                    </header>

                    <p className="text-micro text-text-tertiary">
                      {task.category}
                      {task.publishedOn && ` · published ${task.publishedOn}`}
                      {!task.publishedOn && task.dueDate && ` · due ${task.dueDate}`}
                    </p>

                    {/* ⚠️ The description in full, not truncated. It is often the
                        only place the actual brief is written, and this panel is
                        where somebody comes to read it. */}
                    {task.description && (
                      <p className="whitespace-pre-line text-caption text-text-secondary">
                        {task.description}
                      </p>
                    )}

                    {live.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {live.map((link) => (
                          <a
                            key={`${link.slug}-${link.url}`}
                            href={link.url ?? '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-bg-subtle px-2 py-1 text-micro text-text-brand hover:underline"
                          >
                            <PlatformIcon slug={link.slug} size={13} />
                            {link.platformName}
                            <ExternalLink className="size-3" aria-hidden="true" />
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Said rather than left blank: a post with no link is a real
                        state, and one the report elsewhere asks somebody to fix. */}
                    {task.links.length > 0 && live.length === 0 && (
                      <p className="text-micro text-text-tertiary">
                        Destinations recorded, no live link yet.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border-default bg-bg-surface px-3 py-2">
      <p className="text-h3 font-semibold tabular-nums text-text-primary">{value}</p>
      <p className="text-micro text-text-secondary">{label}</p>
    </div>
  );
}
