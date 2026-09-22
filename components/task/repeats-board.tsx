'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { Ban, CalendarClock, Repeat, Search, User } from 'lucide-react';

import { stopTaskSeriesAction } from '@/app/actions/tasks';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import type { SeriesCard } from '@/lib/db/queries/task-series';
import { describeRecurrence, nextOccurrence, parseRecurrence } from '@/lib/domain/recurrence';

/* ============================================================================
 * REPEATING TASKS — one place that answers "what keeps coming back?"
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-22: *"Can you please exactly tell me where Najmulah, in his
 * dashboard, will go to turn off this repeating task or where he can see which
 * tasks are repeating?"*
 *
 * Before this the answer was "spot the ↻ on a card" — and if every copy of a
 * series happened to be finished, as all nine of Najamullah's were, there was no
 * card to spot. This is the answer: every repeat he is part of, in one list,
 * each with the button.
 *
 * ── ⚠️ WHAT IS ON SCREEN IS WHAT HE MAY STOP ──────────────────────────────
 * `app.task_series_board()` returns a series only to somebody who raised it, is
 * assigned it, or sees all work — so a member's list is their own, and an admin
 * sees the division's. Nothing here filters by role; the read already did.
 *
 * ── RULE ZERO ──────────────────────────────────────────────────────────────
 * One query on the server. Search, the "whose" filter and the confirmation are
 * client state; stopping moves the row in its own frame and reconciles after.
 * ========================================================================= */

export function RepeatsBoard({
  series,
  viewerId,
  today,
}: {
  series: readonly SeriesCard[];
  viewerId: string;
  /** The division's day, so "next copy" means the same day the runner means. */
  today: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = React.useState('');
  const [whose, setWhose] = React.useState<'all' | 'mine'>('all');
  const [asking, setAsking] = React.useState<SeriesCard | null>(null);
  const [alsoRemove, setAlsoRemove] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  /* Stopped in this browser, before the server's rows catch up. */
  const [stopped, setStopped] = React.useState<ReadonlySet<string>>(new Set());

  const people = React.useMemo(() => {
    const names = new Map<string, string>();
    for (const s of series) if (s.assigneeId && s.assigneeName) names.set(s.assigneeId, s.assigneeName);
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [series]);

  const [who, setWho] = React.useState<string>('all');

  const shown = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return series.filter((s) => {
      if (whose === 'mine' && s.assigneeId !== viewerId && s.createdById !== viewerId) return false;
      if (who !== 'all' && s.assigneeId !== who) return false;
      if (needle && !s.title.toLowerCase().includes(needle) && !s.projectName.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [series, q, who, whose, viewerId]);

  const isStopped = (s: SeriesCard) => stopped.has(s.id) || Boolean(s.stoppedAt);
  const live = shown.filter((s) => !isStopped(s));
  const ended = shown.filter((s) => isStopped(s));

  const stop = async (s: SeriesCard, removeUntouched: boolean) => {
    setBusy(true);
    setStopped((prev) => new Set(prev).add(s.id));
    setAsking(null);
    const r = await stopTaskSeriesAction(s.id, { removeUntouched });
    setBusy(false);
    if (!r.ok) {
      setStopped((prev) => {
        const next = new Set(prev);
        next.delete(s.id);
        return next;
      });
      toast({ tone: 'error', text: r.error ?? 'That repeat could not be stopped.' });
      return;
    }
    toast({
      tone: 'ok',
      strong: s.title,
      text: r.removed
        ? `Stopped. ${r.removed} copy nobody had started ${r.removed === 1 ? 'was' : 'were'} removed.`
        : 'Stopped. No new copies will be created.',
    });
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-[16rem] flex-1 items-center gap-2 rounded-xl border border-border-default bg-bg-surface px-3">
          <Search className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search a repeating task or a project…"
            aria-label="Search repeating tasks"
            className="border-0 bg-transparent px-0 focus:ring-0"
          />
        </label>
        {people.length > 1 && (
          <Select
            aria-label="Whose repeat"
            value={who}
            onChange={(event) => setWho(event.target.value)}
            size="md"
            className="w-[12rem]"
          >
            <option value="all">Everybody</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {id === viewerId ? `${name} (you)` : name}
              </option>
            ))}
          </Select>
        )}
        <Select
          aria-label="Which repeats"
          value={whose}
          onChange={(event) => setWhose(event.target.value as 'all' | 'mine')}
          size="md"
          className="w-[11rem]"
        >
          <option value="all">All I can see</option>
          <option value="mine">Mine only</option>
        </Select>
      </div>

      {shown.length === 0 && (
        <div className="grid place-items-center rounded-2xl border border-border-subtle bg-bg-surface px-6 py-14 text-center">
          <Repeat className="size-7 text-text-tertiary" aria-hidden="true" />
          <p className="mt-2 text-body-sm font-medium text-text-primary">
            {series.length === 0 ? 'Nothing repeats yet.' : 'No repeat matches that.'}
          </p>
          <p className="mt-1 max-w-md text-caption text-text-secondary">
            A task repeats when somebody chooses Daily, Weekly or Monthly on it. A copy is then created
            automatically at midnight, and it keeps coming until somebody stops it here.
          </p>
        </div>
      )}

      {live.length > 0 && (
        <Section title="Running" count={live.length}>
          {live.map((s) => (
            <Row
              key={s.id}
              s={s}
              today={today}
              viewerId={viewerId}
              busy={busy}
              onStop={() => {
                setAlsoRemove(true);
                setAsking(s);
              }}
              onOpen={() => router.push(`/tasks?q=${encodeURIComponent(s.title.slice(0, 40))}` as Route)}
            />
          ))}
        </Section>
      )}

      {ended.length > 0 && (
        <Section title="Stopped" count={ended.length}>
          {ended.map((s) => (
            <Row key={s.id} s={s} today={today} viewerId={viewerId} busy={busy} stopped />
          ))}
        </Section>
      )}

      {/* ── The one question stopping asks ──────────────────────────────── */}
      {asking && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-bg-scrim p-4" role="dialog" aria-label="Stop repeating">
          <div className="w-full max-w-lg rounded-2xl border border-border-subtle bg-bg-surface p-5 shadow-xl">
            <h2 className="text-h3 font-semibold text-text-primary">Stop “{asking.title}” repeating?</h2>
            <p className="mt-1.5 text-body-sm text-text-secondary">
              No copy will be created again. The ones already here stay exactly where they are.
            </p>
            {asking.untouchedCopies > 0 && (
              <label className="mt-3 flex items-start gap-2 rounded-lg border border-border-default px-3 py-2.5 text-caption text-text-primary">
                <input
                  type="checkbox"
                  checked={alsoRemove}
                  onChange={(event) => setAlsoRemove(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Also remove the {asking.untouchedCopies}{' '}
                  {asking.untouchedCopies === 1 ? 'copy' : 'copies'} nobody has started.{' '}
                  <span className="text-text-secondary">
                    Anything started, finished or commented on is left alone.
                  </span>
                </span>
              </label>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="md" onClick={() => setAsking(null)} disabled={busy}>
                Keep it
              </Button>
              <Button variant="danger" size="md" disabled={busy} onClick={() => void stop(asking, alsoRemove)}>
                Stop repeating
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-body-sm font-semibold text-text-secondary">
        {title} <span className="tabular text-text-tertiary">· {count}</span>
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({
  s,
  today,
  viewerId,
  busy,
  stopped = false,
  onStop,
  onOpen,
}: {
  s: SeriesCard;
  today: string;
  viewerId: string;
  busy: boolean;
  stopped?: boolean;
  onStop?: () => void;
  onOpen?: () => void;
}) {
  const parsed = parseRecurrence(s.rule);
  const said = parsed.ok ? describeRecurrence(parsed.rule) : s.rule;
  /* When the next copy is due — counted from the last one made, exactly as the
     nightly runner counts it. */
  const next = parsed.ok ? nextOccurrence(parsed.rule, s.lastGeneratedOn ?? s.anchorDate ?? today) : null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle bg-bg-surface px-3.5 py-3">
      <Repeat
        className={`size-4 shrink-0 ${stopped ? 'text-text-tertiary' : 'text-text-brand'}`}
        strokeWidth={2.25}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-body-sm font-medium ${stopped ? 'text-text-secondary line-through decoration-text-disabled' : 'text-text-primary'}`}>
          {s.title}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-text-secondary">
          <span className="font-semibold text-text-brand">{said}</span>
          <span className="truncate">{s.projectName}</span>
          {!stopped && next && (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3" aria-hidden="true" /> next copy {next === today ? 'today' : next}
            </span>
          )}
          {stopped && s.stoppedByName && <span>stopped by {s.stoppedByName}</span>}
        </p>
      </div>

      <span className="flex items-center gap-1.5">
        {s.assigneeId ? (
          <>
            <Avatar name={s.assigneeName ?? 'Somebody'} size="xs" />
            <span className="text-micro text-text-secondary">
              {s.assigneeId === viewerId ? 'You' : s.assigneeName}
            </span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1 text-micro text-text-tertiary">
            <User className="size-3" aria-hidden="true" /> Nobody
          </span>
        )}
      </span>

      {!stopped && (
        <Badge token={s.openCopies > 1 ? 'status-blocked' : 'status-todo'} size="sm" variant="outline">
          {s.openCopies} open
        </Badge>
      )}

      {!stopped && onStop && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={onStop}>
          <Ban className="size-3.5" aria-hidden="true" /> Stop
        </Button>
      )}
      {!stopped && onOpen && (
        <Button size="sm" variant="ghost" onClick={onOpen}>
          Find the copies
        </Button>
      )}
    </div>
  );
}
