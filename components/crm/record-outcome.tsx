'use client';

import * as React from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  CalendarDays,
  CircleAlert,
  CircleCheck,
  Clock3,
  FileText,
  Info,
  Lightbulb,
  MapPin,
  MessageSquareText,
  PauseCircle,
  ThumbsDown,
  ThumbsUp,
  User,
  Workflow,
  X,
} from 'lucide-react';

import { recordOutcomeAction } from '@/app/actions/crm-leads';
import { WhatsAppMark, WA_GREEN } from '@/components/crm/whatsapp-mark';
import { formatWhen, fromInputValue, karachiAt, karachiParts, toInputValue } from '@/components/crm/when';
import { useToast } from '@/components/ui/toast';
import { LOST_REASONS, STAGE_ORDER, lostReasonLabel, stageLabel, stageToken } from '@/lib/domain/crm-stages';
import {
  OUTCOME_OPTIONS,
  outcomeImpact,
  outcomeLabel,
  outcomeProblems,
  outcomeRequires,
  suggestStage,
} from '@/lib/domain/crm-outcomes';
import type { PlannedThing } from '@/lib/domain/crm-planned';
import { cn } from '@/lib/utils';

/* ============================================================================
 * RECORD OUTCOME & UPDATE STAGE — the form behind every stage change
 * ----------------------------------------------------------------------------
 * Built to the owner's design of 2026-09-17: *"I want that to be exactly the
 * same: same colours, same icons, same styling."* Two columns — what happened on
 * the left, what saving will do on the right.
 *
 * ── ⚠️ THE OUTCOME IS THE FIRST QUESTION, NOT THE STAGE ────────────────────
 * The stage dropdown — on a row, and now in the drawer too — opens this, and it
 * is deliberately not a stage picker. "What happened?" is answerable straight
 * after a call; "which stage is this now?" is a question about a funnel nobody
 * on the phone designed. The outcome then RECOMMENDS a stage, overridable.
 *
 * ── ⚠️ AND IT NEVER RECOMMENDS GOING BACKWARDS ─────────────────────────────
 * A lead in negotiation who says "interested" stays in negotiation; the raw
 * suggestion, `qualified`, is behind them and taking it would undo recorded work.
 * `suggestStage` is where that lives.
 *
 * ── ⚠️ THE IMPACT SUMMARY IS COMPUTED, NOT WRITTEN ─────────────────────────
 * Every line on the right is read from the state of this form: the stage it will
 * leave behind, the follow-up it will create, whether the sequence pauses. A
 * panel that described a different form's behaviour would be worse than none.
 *
 * ── ⚠️ THE RULES ARE SHOWN, THEN ENFORCED AGAIN ON THE SERVER ──────────────
 * What is here is a courtesy, so nobody is refused after writing a paragraph.
 * The rule itself is `outcomeProblems` on the server, plus two database
 * constraints (155) that cannot be talked out of.
 * ========================================================================= */

const OUTCOME_ICON: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  client_replied: MessageSquareText,
  no_response: Clock3,
  interested: ThumbsUp,
  not_interested: ThumbsDown,
  wrong_contact: User,
  call_later: Clock3,
  site_visit_requested: CalendarDays,
  booking_confirmed: CircleCheck,
};

/** The icon's own colour, as the design draws them. */
const OUTCOME_INK: Record<string, string> = {
  interested: 'var(--feedback-success)',
  not_interested: 'var(--feedback-error)',
  booking_confirmed: 'var(--feedback-success)',
};

const CHANNELS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'call', label: 'WhatsApp call' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'site_visit', label: 'Site visit' },
  { value: 'task', label: 'Task' },
];

const MAX_NOTE = 1000;

export function RecordOutcome({
  leadId,
  leadName,
  currentStage,
  proposedStage,
  planned = null,
  onClose,
}: {
  leadId: string;
  leadName: string;
  /** Where the lead is NOW. The form opens from here and never rewrites it. */
  currentStage: string;
  /**
   * The stage the dropdown was set to, if any.
   *
   * ⚠️ A SEPARATE ARGUMENT FROM `currentStage`, and separate from the list's
   * `?stage=` filter, which is what it used to travel in. One parameter meaning
   * both "narrow the table to this stage" and "open the form on this stage"
   * meant choosing a stage for one lead filtered the whole table to it, hid the
   * lead being edited, and left the filter on after a cancel.
   */
  proposedStage?: string;
  /**
   * What this lead ALREADY has coming, from `plannedSummary`.
   *
   * ⚠️ NULL MEANS "NOTHING IS SCHEDULED", and the form asks for a next action
   * exactly as it always has. A caller that cannot work it out passes nothing and
   * gets the old behaviour, which is the safe direction to be wrong in.
   */
  planned?: PlannedThing | null;
  /** Hides the dialog at once; the caller owns whether it is on screen. */
  onClose: () => void;
}) {
  const toast = useToast();

  const [outcome, setOutcome] = React.useState<string>('client_replied');

  /* ⚠️ A STAGE PROPOSED FROM THE ROW COUNTS AS A CHOICE ALREADY MADE. Somebody
     who picked "Qualified" in the dropdown has said what they want; letting the
     outcome buttons then overrule it would silently undo the thing that opened
     this form. So it starts touched. */
  const [stage, setStage] = React.useState<string>(
    () => proposedStage ?? suggestStage('client_replied', currentStage),
  );
  const [stageTouched, setStageTouched] = React.useState(proposedStage !== undefined);
  const [plan, setPlan] = React.useState<'follow_up' | 'task'>('follow_up');
  const [nextAction, setNextAction] = React.useState('');
  const [nextActionType, setNextActionType] = React.useState('whatsapp');
  const [when, setWhen] = React.useState('');
  const [lostReason, setLostReason] = React.useState('');
  const [note, setNote] = React.useState('');
  const [contactConfirmed, setContactConfirmed] = React.useState(false);
  /* ⚠️ ON ONLY WHEN THE CLIENT ACTUALLY SPOKE. Owner, 2026-09-19: *"He is
     saying to add next action again, follow-up, and pause the second."* Pausing
     a running plan is a real decision, and defaulting it on for every outcome
     made a salesperson who merely moved a stage stop their own chase by
     accident. A reply is the one case where continuing would talk over somebody. */
  const [pauseSequence, setPauseSequence] = React.useState(outcome === 'client_replied');
  const [pauseTouched, setPauseTouched] = React.useState(false);
  const [visitLocation, setVisitLocation] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const pickOutcome = (next: string) => {
    setOutcome(next);
    if (!stageTouched) setStage(suggestStage(next, currentStage));
    if (!pauseTouched) setPauseSequence(next === 'client_replied');
  };

  const needs = outcomeRequires(outcome);
  const closing = stage === 'won' || stage === 'lost';
  const atMs = when ? fromInputValue(when) : null;
  const nextActionAt = atMs !== null ? new Date(atMs).toISOString() : '';

  const problems = outcomeProblems({
    outcome,
    stage,
    nextActionAt: nextActionAt || null,
    nextAction,
    lostReason: lostReason || null,
    contactConfirmed,
    alreadyPlanned: planned != null,
  });
  /* The owner's design marks Notes required, and it is right: an outcome with no
     words is a row in the timeline nobody can act on a week later. */
  const missingNote = note.trim().length === 0;

  const close = onClose;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  async function save() {
    setBusy(true);
    const result = await recordOutcomeAction(leadId, {
      outcome,
      stage,
      nextAction,
      nextActionType: closing || plan === 'task' ? null : nextActionType,
      nextActionAt: nextActionAt || null,
      lostReason: stage === 'lost' ? lostReason || null : null,
      note,
      contactConfirmed,
      pauseSequence,
      visitLocation,
    });
    setBusy(false);

    if (!result.ok) {
      /* ⚠️ The form stays open and keeps everything typed. The owner's standing
         rule since the team forms: *"I don't need to enter it again and again."* */
      toast({ tone: 'error', text: result.error ?? 'That did not save.' });
      return;
    }
    toast({
      tone: 'ok',
      text: result.booked
        ? `Recorded, and the visit is in your diary — ${leadName} is now ${stageLabel(stage)}.`
        : `Recorded — ${leadName} is now ${stageLabel(stage)}.`,
    });
    close();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" aria-label="Cancel" onClick={close} className="absolute inset-0 bg-black/40" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Record what happened with ${leadName}`}
        className="relative flex max-h-[94vh] w-full max-w-[54rem] flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <h2 className="text-h3 font-semibold text-text-primary">Record outcome &amp; update stage</h2>
            <p className="mt-0.5 text-caption text-text-secondary">
              Log the client response, update the stage and set the next action.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Cancel"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-[1.25fr_1fr]">
          {/* ── What happened ───────────────────────────────────────────── */}
          <div className="space-y-4 px-5 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body-sm font-semibold text-text-primary">Current stage</span>
              <span
                className="rounded-lg px-2.5 py-1 text-caption font-medium"
                style={{
                  backgroundColor: `color-mix(in oklab, var(--${stageToken(currentStage)}) 12%, transparent)`,
                  color: `var(--${stageToken(currentStage)})`,
                }}
              >
                {stageLabel(currentStage)}
              </span>
            </div>

            <fieldset>
              <legend className="mb-2 text-body-sm font-semibold text-text-primary">
                Client outcome <span className="text-feedback-error">*</span>
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {OUTCOME_OPTIONS.map((o) => {
                  const on = outcome === o.value;
                  const Icon = OUTCOME_ICON[o.value] ?? MessageSquareText;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => pickOutcome(o.value)}
                      aria-pressed={on}
                      className={cn(
                        'relative rounded-xl border px-2 py-3 text-center transition-colors',
                        on
                          ? 'border-[var(--pick-border)] bg-[var(--pick-bg)]'
                          : 'border-border-subtle bg-bg-surface hover:bg-bg-subtle',
                      )}
                    >
                      {on && (
                        <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-[var(--pick-mark)] text-white">
                          <CircleCheck className="size-3" aria-hidden="true" />
                        </span>
                      )}
                      <Icon className="mx-auto size-5" style={{ color: OUTCOME_INK[o.value] ?? 'var(--text-secondary)' }} />
                      <span className="mt-1.5 block text-caption font-medium leading-tight text-text-primary">
                        {o.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* ⚠️ WHAT THIS OUTCOME MEANS FOR THE STAGE, in the outcome's own
                words — `outcomeImpact`, which the server reads from too. */}
            <p className="flex items-start gap-2.5 rounded-xl border border-[var(--pick-border)] bg-[var(--pick-bg)] px-3 py-2.5">
              <Lightbulb className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--feedback-success)' }} aria-hidden="true" />
              <span className="min-w-0 text-caption leading-relaxed text-text-secondary">
                <span className="block font-semibold text-text-primary">
                  {outcomeLabel(outcome)}
                  {stage === currentStage ? ` · keep ${stageLabel(currentStage)}` : ` · move to ${stageLabel(stage)}`}
                </span>
                {outcomeImpact(outcome)}
              </span>
            </p>

            <label className="block">
              <span className="mb-1 block text-body-sm font-semibold text-text-primary">Next stage</span>
              <select
                value={stage}
                onChange={(e) => {
                  setStage(e.target.value);
                  setStageTouched(true);
                }}
                className="min-h-[2.4rem] w-full rounded-xl border border-border-default bg-bg-surface px-3 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
              >
                {STAGE_ORDER.map((st) => (
                  <option key={st} value={st}>
                    {stageLabel(st)}
                  </option>
                ))}
              </select>
            </label>

            {stage === 'lost' && (
              <label className="block">
                <span className="mb-1 block text-body-sm font-semibold text-text-primary">
                  Why was it lost? <span className="text-feedback-error">*</span>
                </span>
                <select
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  className="min-h-[2.4rem] w-full rounded-xl border border-border-default bg-bg-surface px-3 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
                >
                  <option value="">Choose a reason…</option>
                  {LOST_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {lostReasonLabel(r)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {needs.includes('contact_check') && (
              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-feedback-warning/40 bg-feedback-warning/10 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={contactConfirmed}
                  onChange={(e) => setContactConfirmed(e.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--pick-mark)]"
                />
                <span className="text-caption leading-relaxed text-text-primary">
                  I checked the number against what they typed. ⚠️ A mistyped digit looks exactly like a wrong
                  number, and closing the lead hides a real person.
                </span>
              </label>
            )}

            <label className="block">
              <span className="mb-1 flex items-center justify-between gap-2">
                <span className="text-body-sm font-semibold text-text-primary">
                  Notes <span className="text-feedback-error">*</span>
                </span>
                <span className={cn('text-caption tabular-nums', missingNote ? 'text-text-tertiary' : 'text-text-secondary')}>
                  {note.length}/{MAX_NOTE}
                </span>
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
                rows={3}
                placeholder="What was said, in your own words."
                className="w-full resize-y rounded-xl border border-border-default bg-bg-surface px-3 py-2 text-body-sm leading-relaxed text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
              />
            </label>

            {/* ── What happens next ─────────────────────────────────────── */}
            {!closing && (
              <div>
                <span className="mb-1.5 block text-body-sm font-semibold text-text-primary">
                  Next action{planned ? ' (optional)' : ''}
                </span>
                {/* ⚠️ SAID, NOT SILENTLY RELAXED. A field that stops being required
                    with no explanation reads as a bug; and naming what is already
                    coming is itself the answer to "do I need another one?" */}
                {planned && (
                  <p className="mb-2 rounded-lg bg-bg-subtle px-3 py-2 text-caption leading-relaxed text-text-secondary">
                    Already scheduled:{' '}
                    <span className="font-medium text-text-primary">{planned.what}</span>
                    {planned.at ? ' · ' + formatWhen(planned.at) : ''}. Add another only if you want one.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-4">
                  {([
                    ['follow_up', 'Schedule follow-up'],
                    ['task', 'Add task only'],
                  ] as const).map(([value, label]) => (
                    <label key={value} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="next-action-kind"
                        checked={plan === value}
                        onChange={() => setPlan(value)}
                        className="size-4 accent-[var(--pick-mark)]"
                      />
                      <span className="text-body-sm text-text-primary">{label}</span>
                    </label>
                  ))}
                </div>

                <input
                  type="text"
                  value={nextAction}
                  onChange={(e) => setNextAction(e.target.value)}
                  placeholder={plan === 'task' ? 'What do you have to do?' : 'Call back about the corner plot'}
                  className="mt-2 min-h-[2.4rem] w-full rounded-xl border border-border-default bg-bg-surface px-3 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
                />

                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <Field icon={CalendarDays} label="Date">
                    <input
                      type="date"
                      value={when ? when.slice(0, 10) : ''}
                      onChange={(e) => setWhen(mergeDate(when, e.target.value))}
                      aria-label="Date"
                      className="w-full bg-transparent text-body-sm text-text-primary focus:outline-none"
                    />
                  </Field>
                  <Field icon={Clock3} label="Time">
                    <input
                      type="time"
                      value={when ? when.slice(11, 16) : '10:00'}
                      onChange={(e) => setWhen(mergeTime(when, e.target.value))}
                      aria-label="Time"
                      className="w-full bg-transparent text-body-sm text-text-primary focus:outline-none"
                    />
                  </Field>
                  <Field
                    icon={nextActionType === 'whatsapp' ? undefined : undefined}
                    label="How"
                    mark={nextActionType === 'whatsapp'}
                  >
                    <select
                      value={nextActionType}
                      onChange={(e) => setNextActionType(e.target.value)}
                      aria-label="How"
                      disabled={plan === 'task'}
                      className="w-full bg-transparent text-body-sm text-text-primary focus:outline-none disabled:opacity-50"
                    >
                      {CHANNELS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            )}

            {outcome === 'site_visit_requested' && (
              <label className="block">
                <span className="mb-1 block text-body-sm font-semibold text-text-primary">Where are they visiting?</span>
                <span className="flex items-center gap-2 rounded-xl border border-border-default bg-bg-surface px-3 py-2">
                  <MapPin className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                  <input
                    type="text"
                    value={visitLocation}
                    onChange={(e) => setVisitLocation(e.target.value)}
                    placeholder="Plot A-101, Block A — or the site office"
                    className="min-w-0 flex-1 bg-transparent text-body-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
                  />
                </span>
                <span className="mt-1 block text-caption leading-relaxed text-text-secondary">
                  The time above goes in your diary as a one-hour visit. You can change the length and the place
                  afterwards.
                </span>
              </label>
            )}

            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={pauseSequence}
                onChange={(e) => {
                  setPauseTouched(true);
                  setPauseSequence(e.target.checked);
                }}
                className="mt-0.5 size-4 accent-[var(--pick-mark)]"
              />
              <span className="min-w-0">
                <span className="block text-body-sm text-text-primary">Pause active sequence</span>
                <span className="block text-caption text-text-secondary">
                  This will stop automated follow-ups for this lead.
                </span>
              </span>
            </label>

            {problems.length > 0 && (
              <ul className="space-y-1 rounded-xl border border-feedback-error/40 bg-feedback-error/5 px-3 py-2">
                {problems.map((p) => (
                  <li key={p} className="flex items-start gap-1.5 text-caption text-text-primary">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-feedback-error" aria-hidden="true" />
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── What saving will do ─────────────────────────────────────── */}
          <aside className="space-y-3 border-border-subtle bg-bg-subtle/40 px-5 py-4 lg:border-l">
            <div>
              <h3 className="text-body font-semibold text-text-primary">Impact summary</h3>
              <p className="mt-0.5 text-caption text-text-secondary">These changes will be applied when you save.</p>
            </div>

            <Impact icon={FileText} title="Activity logged">
              {outcomeLabel(outcome)} will be recorded in the timeline.
            </Impact>
            <Impact icon={Workflow} title="Stage">
              {stage === currentStage
                ? `Will remain ${stageLabel(currentStage)}.`
                : `Moves from ${stageLabel(currentStage)} to ${stageLabel(stage)}.`}
            </Impact>
            {!closing && (
              <Impact icon={CalendarCheck} title={plan === 'task' ? 'Task created' : 'Next action created'}>
                {atMs === null
                  ? 'Choose a date and time below and it will be scheduled.'
                  : plan === 'task'
                    ? `${nextAction.trim() || 'A task'} on ${formatWhen(new Date(atMs).toISOString())}.`
                    : `${nextAction.trim() || 'Follow-up'} on ${formatWhen(new Date(atMs).toISOString())} via ${
                        CHANNELS.find((c) => c.value === nextActionType)?.label ?? nextActionType
                      }.`}
              </Impact>
            )}
            <Impact icon={PauseCircle} title={pauseSequence ? 'Sequence paused' : 'Sequence untouched'}>
              {pauseSequence
                ? 'Automated follow-ups will be paused for this lead.'
                : 'Any running sequence carries on as it is.'}
            </Impact>

            {/* ⚠️ THE TWO RULES THAT REFUSE A SAVE, said before it is pressed —
                155's constraints, which cannot be talked out of. */}
            <Note tone="info" icon={Info} title="To close as Won, please confirm booking first.">
              A booking confirmation is required before marking a lead as Won.
            </Note>
            <Note tone="warn" icon={CircleAlert} title="To close as Lost, please select a loss reason.">
              A reason is required before marking a lead as Lost.
            </Note>
          </aside>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <button
            type="button"
            onClick={close}
            className="min-h-[2.4rem] rounded-xl border border-border-default px-4 text-body-sm font-medium text-text-primary transition-colors hover:bg-bg-subtle"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || problems.length > 0 || missingNote}
            title={missingNote ? 'Write a note first — it is what the timeline shows a week from now.' : undefined}
            className={cn(
              'min-h-[2.4rem] rounded-xl bg-accent-primary px-4 text-body-sm font-semibold text-white transition-opacity',
              (busy || problems.length > 0 || missingNote) && 'opacity-40',
            )}
          >
            {busy ? 'Saving…' : 'Save outcome'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

function Field({
  icon: Icon,
  label,
  mark = false,
  children,
}: {
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  label: string;
  /** The WhatsApp mark, which is not a lucide icon. */
  mark?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="sr-only">{label}</span>
      <span className="flex items-center gap-2 rounded-xl border border-border-default bg-bg-surface px-3 py-2">
        {mark ? (
          <span className="shrink-0" style={{ color: WA_GREEN }}>
            <WhatsAppMark className="size-4" />
          </span>
        ) : Icon ? (
          <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        ) : null}
        <span className="min-w-0 flex-1">{children}</span>
      </span>
    </label>
  );
}

function Impact({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties; 'aria-hidden'?: boolean | 'true' }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-bg-surface text-text-secondary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-body-sm font-semibold text-text-primary">{title}</p>
        <p className="text-caption leading-relaxed text-text-secondary">{children}</p>
      </div>
    </div>
  );
}

function Note({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: 'info' | 'warn';
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties; 'aria-hidden'?: boolean | 'true' }>;
  title: string;
  children: React.ReactNode;
}) {
  const ink = tone === 'info' ? 'var(--channel-email)' : 'var(--feedback-warning)';
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
      style={{ background: `color-mix(in oklab, ${ink} 9%, transparent)` }}
    >
      <Icon className="mt-0.5 size-4 shrink-0" style={{ color: ink }} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-caption font-semibold" style={{ color: ink }}>
          {title}
        </p>
        <p className="text-caption leading-relaxed text-text-secondary">{children}</p>
      </div>
    </div>
  );
}

/* ── The date and the time, kept as one Karachi wall-clock value ─────────── */

function mergeDate(current: string, date: string): string {
  if (!date) return '';
  const time = current ? current.slice(11, 16) : '10:00';
  return `${date}T${time}`;
}

function mergeTime(current: string, time: string): string {
  if (!time) return current;
  const date = current ? current.slice(0, 10) : todayInKarachi();
  return `${date}T${time}`;
}

function todayInKarachi(): string {
  const p = karachiParts(Date.now());
  return toInputValue(karachiAt(p.y, p.m, p.d, 10)).slice(0, 10);
}
