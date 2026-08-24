'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CalendarX2, Check, CircleSlash, ExternalLink, FolderOpen, Loader2 } from 'lucide-react';

import { changeStatusAction } from '@/app/actions/tasks';
import { savePlacementAction } from '@/app/actions/placements';
import { PlatformIcon } from '@/components/brand/platform-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { PlacementRow } from '@/lib/db/queries/placements';
import type { TaskRow } from '@/lib/db/queries/types';
import { dailyBoard, type DailyTask } from '@/lib/domain/daily';
import { CONTENT_KIND_LABEL, type ContentKind } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE DAILY BOARD — ONE DAY OF POSTING, DONE IN ONE PLACE
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-22, describing what a social media manager actually does:
 *
 *   *"When he clicks on Daily, it shows some beautiful interactive UI with Done
 *   and To Do… their task name, platform, and URLs have to be copied. Once he
 *   copies it and clicks Done, then he considers it done."*
 *
 * ── WHY THIS IS NOT THE TASK LIST WITH A FILTER ─────────────────────────────
 * The task list answers "what is outstanding". This answers a narrower question
 * — "did today's posts go out, and where are the links" — and the difference is
 * what makes it usable by somebody who is not a project manager. There is one
 * verb on this screen. Everything else is the information needed to do it.
 *
 * ── ONE TASK, A ROW PER PLATFORM ────────────────────────────────────────────
 * The owner chose this over one task per platform. A post is one piece of work
 * that lands in several places, and `task_placements` already models exactly
 * that — a row per platform, each with its own URL. So the board writes through
 * the same table the reports read, rather than inventing a parallel store.
 *
 * ── ⚠️ DONE IS FINAL, AND A BLANK DAY STAYS BLANK ───────────────────────────
 * Both rules live in `lib/domain/daily.ts` and are enforced in
 * `changeStatusAction`. This component only renders them: a published post has
 * no controls except its links, and a missed day has none at all. The UI is not
 * the boundary — the server refuses either way — but a control that cannot work
 * should not be on screen.
 * ========================================================================= */

export interface DailyPlatform {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export function DailyBoard({
  tasks,
  placements,
  platforms,
  driveFolders,
  projectId,
  today,
  lookbackFrom,
}: {
  tasks: readonly TaskRow[];
  placements: readonly PlacementRow[];
  /** The project's own platforms — where its posts go. */
  platforms: readonly DailyPlatform[];
  driveFolders: readonly { id: string; name: string; projectId: string | null; driveFolderId: string }[];
  projectId: string;
  today: string;
  lookbackFrom: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [flash, setFlash] = React.useState<{ ok: boolean; text: string } | null>(null);

  const board = React.useMemo(
    () => dailyBoard(tasks as unknown as DailyTask[], today, lookbackFrom),
    [tasks, today, lookbackFrom],
  );

  const byTask = React.useMemo(() => {
    const map = new Map<string, PlacementRow[]>();
    for (const p of placements) {
      const list = map.get(p.taskId) ?? [];
      list.push(p);
      map.set(p.taskId, list);
    }
    return map;
  }, [placements]);

  const full = React.useMemo(() => {
    const map = new Map<string, TaskRow>();
    for (const t of tasks) map.set(t.id, t);
    return map;
  }, [tasks]);

  /* ── ⚠️ THE PROJECT'S OWN FOLDERS FIRST, THE REST STILL REACHABLE ──────────
     Owner: *"only the folders that are linked to that project should be opened.
     That's a good option but he can go back and see other things as well if he
     wants."* So this is a short list with an escape hatch, not a filter that
     hides things — the common case is two clicks and the rare one is possible. */
  const folderOptions = React.useMemo(() => {
    const mine = driveFolders.filter((f) => f.projectId === projectId);
    const others = driveFolders.filter((f) => f.projectId !== projectId);
    return [
      { value: '', label: 'Not set' },
      ...mine.map((f) => ({ value: f.driveFolderId, label: f.name })),
      ...(others.length > 0
        ? [{ value: '__sep', label: `── other projects (${others.length}) ──`, disabled: true }]
        : []),
      ...others.map((f) => ({ value: f.driveFolderId, label: f.name })),
    ];
  }, [driveFolders, projectId]);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setFlash(null);
    try {
      const result = await fn();
      setFlash({ ok: result.ok, text: result.ok ? 'Saved.' : (result.error ?? 'That did not work.') });
      if (result.ok) router.refresh();
    } catch {
      setFlash({ ok: false, text: 'The server did not answer. Nothing was changed.' });
    } finally {
      setBusy(null);
    }
  };

  const nothingAtAll =
    board.pending.length === 0 && board.done.length === 0 && board.missed.length === 0;

  if (nothingAtAll) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
        <div
          className="flex size-11 items-center justify-center rounded-full"
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--feedback-success) var(--tint-soft), var(--bg-surface))',
          }}
        >
          <Check className="size-5" style={{ color: 'var(--feedback-success)' }} aria-hidden="true" />
        </div>
        <p className="text-body-sm font-semibold text-text-primary">Nothing due today</p>
        <p className="max-w-[32rem] text-caption text-text-secondary">
          Either today is a rest day for this project, or the month&rsquo;s schedule has not been
          generated yet — that is the <span className="font-semibold text-text-primary">Generate
          schedule</span> button on the Overview tab.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {flash && (
        <p
          role="status"
          className={cn('text-caption', flash.ok ? 'text-text-secondary' : 'text-feedback-error')}
        >
          {flash.text}
        </p>
      )}

      {/* ══ MISSED ══════════════════════════════════════════════════════════
          Shown FIRST and shown at all, which is the point. A blank day that
          scrolls off the bottom is a blank day nobody learns from. */}
      {board.missed.length > 0 && (
        <section className="space-y-2">
          <SectionHead
            icon={CalendarX2}
            tone="var(--feedback-error)"
            title={`${board.missed.length} blank ${board.missed.length === 1 ? 'day' : 'days'}`}
            note="Not posted on the day. These can no longer be filled in."
          />
          <div className="space-y-1.5">
            {board.missed.map((t) => {
              const task = full.get(t.id);
              if (!task) return null;
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-2.5 rounded-lg border border-border-subtle bg-bg-subtle px-3 py-2 opacity-80"
                >
                  <CircleSlash className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-body-sm text-text-secondary line-through">
                    {task.title}
                  </span>
                  <span className="shrink-0 text-micro text-text-tertiary">{task.dueDate}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ══ TO POST TODAY ═══════════════════════════════════════════════════ */}
      {board.pending.length > 0 && (
        <section className="space-y-2">
          <SectionHead
            icon={CalendarX2}
            tone="var(--accent-primary)"
            title={`${board.pending.length} to post today`}
            note="Paste each live link, then mark it published."
          />
          <div className="space-y-2.5">
            {board.pending.map((t) => {
              const task = full.get(t.id);
              if (!task) return null;
              const rows = byTask.get(t.id) ?? [];

              return (
                <article
                  key={t.id}
                  className="rounded-xl border border-border-default bg-bg-surface p-3 shadow-xs"
                >
                  <header className="flex flex-wrap items-center gap-2">
                    {task.contentKind && (
                      <Badge token="accent-primary" size="sm">
                        {CONTENT_KIND_LABEL[task.contentKind as ContentKind]}
                      </Badge>
                    )}
                    <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-text-primary">
                      {task.title}
                    </span>
                    <span className="font-mono text-micro text-text-tertiary">{task.reference}</span>
                  </header>

                  <div className="mt-2.5 space-y-1.5">
                    {platforms.length === 0 ? (
                      <p className="text-caption text-text-tertiary">
                        No platforms set for this project — add them under Edit project.
                      </p>
                    ) : (
                      platforms.map((platform) => {
                        const existing = rows.find((r) => r.platformId === platform.id);
                        const key = `${t.id}:${platform.id}`;
                        return (
                          <PlatformRow
                            key={key}
                            busy={busy === key}
                            platform={platform}
                            initialUrl={existing?.url ?? ''}
                            onSave={(url) =>
                              run(key, async () => {
                                const data = new FormData();
                                data.set('taskId', t.id);
                                data.set('platformId', platform.id);
                                data.set('contentKind', task.contentKind ?? 'static');
                                data.set('url', url);
                                data.set('publishedOn', today);
                                return savePlacementAction({ ok: false }, data);
                              })
                            }
                          />
                        );
                      })
                    )}
                  </div>

                  <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                    <FolderPicker
                      label="Raw material"
                      options={folderOptions}
                      defaultValue={driveIdFromUrl(task.sourceDriveUrl)}
                    />
                    <FolderPicker
                      label="Finished file"
                      options={folderOptions}
                      defaultValue={driveIdFromUrl(task.assetDriveUrl)}
                    />
                  </div>

                  <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-border-subtle pt-2.5">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy !== null}
                      onClick={() =>
                        run(`${t.id}:done`, () => changeStatusAction(t.id, 'done'))
                      }
                    >
                      {busy === `${t.id}:done` ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Check className="size-4" aria-hidden="true" />
                      )}
                      Mark as published
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* ══ PUBLISHED ═══════════════════════════════════════════════════════ */}
      {board.done.length > 0 && (
        <section className="space-y-2">
          <SectionHead
            icon={Check}
            tone="var(--feedback-success)"
            title={`${board.done.length} published today`}
            note="Final. Only a wrong link can still be corrected, on the task itself."
          />
          <div className="space-y-1.5">
            {board.done.map((t) => {
              const task = full.get(t.id);
              if (!task) return null;
              const rows = (byTask.get(t.id) ?? []).filter((r) => r.url);

              return (
                <div
                  key={t.id}
                  className="rounded-lg border px-3 py-2"
                  style={{
                    borderColor: 'color-mix(in oklab, var(--feedback-success) 30%, transparent)',
                    backgroundColor:
                      'color-mix(in oklab, var(--feedback-success) var(--tint-soft), var(--bg-surface))',
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Check
                      className="size-4 shrink-0"
                      style={{ color: 'var(--feedback-success)' }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-body-sm text-text-primary">
                      {task.title}
                    </span>
                    {/* Owner: *"if someone else is also working on that project
                        then I should know who filled this — that name should
                        appear over there."* */}
                    <span className="shrink-0 text-micro text-text-secondary">
                      {task.assigneeName ?? 'unattributed'}
                    </span>
                  </div>

                  {rows.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5 pl-6">
                      {rows.map((r) => (
                        <a
                          key={r.id}
                          href={r.url ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded bg-bg-surface px-1.5 py-0.5 text-micro text-text-brand hover:underline"
                        >
                          <PlatformIcon slug={r.platformSlug} className="size-3" />
                          {r.platformName}
                          <ExternalLink className="size-2.5" aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SectionHead({
  icon: Icon,
  tone,
  title,
  note,
}: {
  icon: typeof Check;
  tone: string;
  title: string;
  note: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="inline-flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0" style={{ color: tone }} aria-hidden="true" />
        <span className="text-body-sm font-semibold text-text-primary">{title}</span>
      </span>
      <span className="text-micro text-text-tertiary">{note}</span>
    </div>
  );
}

function PlatformRow({
  platform,
  initialUrl,
  busy,
  onSave,
}: {
  platform: DailyPlatform;
  initialUrl: string;
  busy: boolean;
  onSave: (url: string) => void;
}) {
  const [url, setUrl] = React.useState(initialUrl);
  const dirty = url.trim() !== initialUrl.trim();

  return (
    <div className="flex items-center gap-2">
      <span className="flex w-[7.5rem] shrink-0 items-center gap-1.5">
        <PlatformIcon slug={platform.slug} className="size-4 shrink-0" />
        <span className="truncate text-caption text-text-secondary">{platform.name}</span>
      </span>
      <Input
        aria-label={`Live link on ${platform.name}`}
        placeholder="Paste the live link…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="h-8 flex-1 text-caption"
      />
      <Button
        size="sm"
        variant="secondary"
        /* Only offered once there is something to save. A row of always-active
           Save buttons invites clicking one that does nothing. */
        disabled={!dirty || busy}
        onClick={() => onSave(url.trim())}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : 'Save'}
      </Button>
    </div>
  );
}

function FolderPicker({
  label,
  options,
  defaultValue,
}: {
  label: string;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  defaultValue: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-micro font-semibold tracking-[0.04em] text-text-tertiary uppercase">
        <FolderOpen className="size-3" aria-hidden="true" />
        {label}
      </span>
      <Select size="sm" defaultValue={defaultValue} options={options} label={label} />
    </label>
  );
}

/** Pull the Drive id back out of a stored folder URL, so an already-set folder
 *  shows as selected rather than as "Not set". */
function driveIdFromUrl(url: string | null): string {
  if (!url) return '';
  const match = url.match(/\/folders\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? '';
}
