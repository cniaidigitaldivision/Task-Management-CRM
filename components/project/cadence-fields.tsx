'use client';

import * as React from 'react';
import { AlertTriangle, CalendarCheck, Clapperboard, ImageIcon } from 'lucide-react';

import {
  WEEKDAYS,
  WEEKDAY_LABEL,
  cadenceProblem,
  contractTargets,
  type Cadence,
  type Weekday,
} from '@/lib/domain/cadence';
import { Field, Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE POSTING RHYTHM — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"Daily Static Post: that should be mentioned, right? Daily 1 post or 2 posts or
 * reels. If 1 reel then show a month, show a week, and on which days you want."*
 * *"if it's, say, 2 reels in a week, then only 2 days of the week should be
 * selectable."*
 * *"If that task is not completed, make it empty, like a Sunday for example: there
 * is no post. Mention that this is Sunday."*
 *
 * ── ⚠️ THIS REPLACED THREE MONTHLY BOXES, AND THAT IS THE POINT ───────────────
 * The form used to ask for "assets a month — minimum", "…and the ceiling" and
 * "reels a month". Nobody agrees a month; they agree a rhythm. So the rhythm is
 * what is typed, and the monthly figures are shown UNDERNEATH as a computed
 * consequence — visible, so the commercial promise is never a mystery, but not
 * editable, because two editable places for one fact is how they start disagreeing.
 *
 * `contractTargets()` does that arithmetic and is tested exhaustively. This file
 * only renders it.
 *
 * ── THE REEL DAY LIMIT IS ENFORCED, NOT SUGGESTED ─────────────────────────────
 * Ticking a third day when the client bought two swaps out the oldest rather than
 * showing an error. That is the owner's "only 2 days should be selectable" read as
 * a behaviour rather than as a disabled state: disabling the other five would leave
 * somebody unable to change their mind without first un-ticking, which is worse.
 * ========================================================================= */

export function CadenceFields({
  initial,
  canSeeFinance,
  monthlyFeePkr,
}: {
  initial: Cadence;
  /** `project.view_finance` — Admin and above. Owner: money is theirs only. */
  canSeeFinance: boolean;
  monthlyFeePkr: number | null;
}) {
  const [staticPerDay, setStaticPerDay] = React.useState(
    initial.staticPostsPerDay?.toString() ?? '',
  );
  const [reelsPerWeek, setReelsPerWeek] = React.useState(initial.reelsPerWeek?.toString() ?? '');
  const [reelDays, setReelDays] = React.useState<readonly Weekday[]>(initial.reelDays);
  const [postingDays, setPostingDays] = React.useState<readonly Weekday[]>(
    /* Mon–Sat unless this project already said otherwise. The division's own week,
       and the same default migration 036 backfilled. */
    initial.postingDays.length > 0 ? initial.postingDays : [1, 2, 3, 4, 5, 6],
  );
  const [fee, setFee] = React.useState(monthlyFeePkr?.toString() ?? '');

  const reelTarget = reelsPerWeek === '' ? null : Number(reelsPerWeek);

  const cadence: Cadence = {
    staticPostsPerDay: staticPerDay === '' ? null : Number(staticPerDay),
    reelsPerWeek: reelTarget,
    reelDays,
    postingDays,
  };

  const targets = contractTargets(cadence);
  const problem = cadenceProblem(cadence);

  function togglePosting(day: Weekday) {
    setPostingDays((current) => {
      const next = current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort((a, b) => a - b);
      /* A reel cannot sit on a day the project has stopped posting — the database
         refuses it, so the form must not be able to describe it. Dropping the reel
         day silently is right here: the person is editing the working week, and
         being told off about reels is not what they asked about. */
      setReelDays((reels) => reels.filter((d) => next.includes(d)));
      return next;
    });
  }

  function toggleReel(day: Weekday) {
    setReelDays((current) => {
      if (current.includes(day)) return current.filter((d) => d !== day);
      const limit = reelTarget ?? 0;
      /* At the limit, the oldest choice makes way. See the header. */
      const kept = limit > 0 && current.length >= limit ? current.slice(1 - limit) : current;
      return [...kept, day].sort((a, b) => a - b);
    });
  }

  return (
    <div className="space-y-4">
      {/* ---- The rhythm ---- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Static posts a day"
          htmlFor="staticPostsPerDay"
          hint="On each posting day. 1 is the usual."
        >
          <Input
            id="staticPostsPerDay"
            name="staticPostsPerDay"
            type="number"
            min="0"
            max="20"
            inputMode="numeric"
            placeholder="1"
            value={staticPerDay}
            onChange={(event) => setStaticPerDay(event.target.value)}
          />
        </Field>

        <Field
          label="Reels a week"
          htmlFor="reelsPerWeek"
          hint="Pick that many days below."
        >
          <Input
            id="reelsPerWeek"
            name="reelsPerWeek"
            type="number"
            min="0"
            max="21"
            inputMode="numeric"
            placeholder="2"
            value={reelsPerWeek}
            onChange={(event) => {
              setReelsPerWeek(event.target.value);
              /* Lowering the count has to drop the surplus days, or the form sits
                 in a state the database will refuse. Trimmed from the front so the
                 most recent choices survive. */
              const next = event.target.value === '' ? null : Number(event.target.value);
              if (next !== null) setReelDays((current) => current.slice(-Math.max(0, next)));
            }}
          />
        </Field>
      </div>

      {/* ---- Which days ---- */}
      <DayPicker
        legend="Posting days"
        hint="Days left off are shown as off days on the schedule and the calendar."
        name="postingDays"
        selected={postingDays}
        onToggle={togglePosting}
        tone="accent-primary"
      />

      {reelTarget !== null && reelTarget > 0 && (
        <DayPicker
          legend={`Reel days — pick ${reelTarget}`}
          hint={
            reelDays.length === reelTarget
              ? 'Full. Ticking another swaps the earliest one out.'
              : `${reelTarget - reelDays.length} still to pick.`
          }
          name="reelDays"
          selected={reelDays}
          onToggle={toggleReel}
          tone="accent-gold"
          /* Off days are not offered at all here — the constraint refuses a reel on
             one, so presenting it as a choice would be a lie. */
          allowed={postingDays}
        />
      )}

      {problem && (
        <p
          className="flex items-start gap-2 text-micro font-medium"
          style={{ color: 'var(--feedback-warning)' }}
        >
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          {problem}
        </p>
      )}

      {/* ---- What that adds up to ----
          ⚠️ Read-only, and stated as derived. These three figures are what every
          report judges the project against, so showing them is not decoration —
          it is the difference between agreeing a rhythm and knowing what you have
          just promised. They are computed server-side again on save; nothing here
          is submitted. */}
      <div
        className="rounded-xl p-3.5"
        style={{
          backgroundColor:
            'color-mix(in oklab, var(--accent-primary) var(--tint-soft), var(--bg-surface))',
          border: '1px solid color-mix(in oklab, var(--accent-primary) 22%, transparent)',
        }}
      >
        <p className="flex items-center gap-1.5 text-caption font-semibold text-text-primary">
          <CalendarCheck
            className="h-3.5 w-3.5"
            strokeWidth={2.25}
            aria-hidden="true"
            style={{ color: 'var(--accent-primary)' }}
          />
          What that promises each month
        </p>

        {targets.assetsMin === null ? (
          <p className="mt-1.5 text-micro text-text-secondary">
            Nothing yet — set a daily or weekly figure above and the monthly promise appears here.
          </p>
        ) : (
          <>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              <Derived
                icon={ImageIcon}
                value={targets.staticPerMonthMin ?? 0}
                label="static posts"
              />
              <Derived icon={Clapperboard} value={targets.reelsPerMonthMin ?? 0} label="reels" />
              <Derived
                icon={CalendarCheck}
                value={targets.assetsMin}
                label="assets in total"
                strong
              />
            </div>
            <p className="mt-2 text-micro text-text-tertiary">
              Counted on four weeks, because every month has at least four of each weekday — so
              this is the figure that holds even in February. A long month reaches up to{' '}
              <span className="font-semibold text-text-secondary">{targets.assetsMax}</span>.
            </p>
          </>
        )}
      </div>

      {/* ---- Money ----
          ⚠️ Owner, 2026-08-19: *"any financial thing should only be visible to super
          admin and admin only."* Gated on `project.view_finance`, and the field is
          not rendered at all rather than disabled — a disabled input still ships the
          value to the browser. */}
      {canSeeFinance && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Monthly fee (PKR)"
            htmlFor="monthlyFeePkr"
            hint="What was agreed, not the list price. Admin and above only."
          >
            <Input
              id="monthlyFeePkr"
              name="monthlyFeePkr"
              type="number"
              min="0"
              inputMode="numeric"
              value={fee}
              onChange={(event) => setFee(event.target.value)}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function Derived({
  icon: Icon,
  value,
  label,
  strong,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  value: number;
  label: string;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-baseline gap-1">
        <span
          className={cn(
            'tabular-nums font-semibold',
            strong ? 'text-h3 text-text-primary' : 'text-body text-text-primary',
          )}
        >
          {value}
        </span>
      </p>
      <p className="flex items-center gap-1 text-micro text-text-secondary">
        <Icon className="h-3 w-3 shrink-0" strokeWidth={2.25} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * A WEEK OF CHECKBOXES
 * ----------------------------------------------------------------------------
 * Real `sr-only` checkboxes inside labels, sharing one name — so the set posts
 * itself with the form, Space toggles, and Tab reaches every day. Same reasoning as
 * the platform picker: the drawn chip is a picture over a working control.
 * ------------------------------------------------------------------------- */
function DayPicker({
  legend,
  hint,
  name,
  selected,
  onToggle,
  tone,
  allowed,
}: {
  legend: string;
  hint: string;
  name: string;
  selected: readonly Weekday[];
  onToggle: (day: Weekday) => void;
  tone: string;
  /** When given, days outside it are not offered. */
  allowed?: readonly Weekday[];
}) {
  const days = allowed ? WEEKDAYS.filter((d) => allowed.includes(d)) : WEEKDAYS;
  const accent = `var(--${tone})`;

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-caption font-semibold text-text-primary">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {days.map((day) => {
          const on = selected.includes(day);
          return (
            <label
              key={day}
              className={cn(
                'relative cursor-pointer rounded-lg border px-2.5 py-1.5 text-micro font-semibold',
                'transition-[background-color,border-color,transform] duration-[140ms]',
                'hover:-translate-y-px',
                'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2',
                on ? 'border-transparent' : 'border-border-subtle text-text-secondary hover:bg-bg-hover',
              )}
              style={{
                outlineColor: 'var(--focus-ring)',
                ...(on
                  ? { backgroundColor: accent, color: 'var(--text-on-brand)' }
                  : {}),
              }}
            >
              <input
                type="checkbox"
                name={name}
                value={day}
                checked={on}
                onChange={() => onToggle(day)}
                className="sr-only"
              />
              {WEEKDAY_LABEL[day]}
            </label>
          );
        })}
      </div>
      <p className="text-micro text-text-tertiary">{hint}</p>
    </fieldset>
  );
}
