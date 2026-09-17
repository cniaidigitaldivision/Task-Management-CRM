'use client';

import * as React from 'react';
import {
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CircleSlash,
  Clock3,
  Info,
  Mail,
  MessageSquareText,
  PauseCircle,
  Phone,
  Play,
  Send,
  Square,
  Workflow,
  X,
} from 'lucide-react';

import {
  cancelFollowUpAction,
  completeFollowUpAction,
  createFollowUpAction,
  discardDraftAction,
  pauseSequenceAction,
  rescheduleSequenceAction,
  startDraftAction,
  startSequenceAction,
  stopSequenceAction,
} from '@/app/actions/crm-followups';
import { FollowUpWizard, optimisticSteps, type PlanCreated } from '@/components/crm/follow-up-wizard';
import { MAIL_BLUE, PAUSED_ORANGE, WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { formatWhen, fromInputValue, QUICK_TIMES, QuickTimes, toInputValue } from '@/components/crm/when';
import { useToast } from '@/components/ui/toast';
import type { CrmFollowUpRow, CrmLeadRecord, CrmLeadRelated } from '@/lib/db/queries/crm-leads';
import {
  appointmentKindLabel,
  appointmentStatusLabel,
  appointmentStatusToken,
} from '@/lib/domain/crm-appointments';
import { fillTokens, leadFactsFrom, planTokens } from '@/lib/domain/crm-followup-plans';
import {
  channelLabel,
  followUpCounts,
  followUpState,
  sequenceTimeline,
  type FollowUpState,
  type StepStatus,
  type TimelineStep,
} from '@/lib/domain/crm-followups';
import { cn } from '@/lib/utils';

/* ============================================================================
 * FOLLOW-UPS — the drawer tab, built to the owner's reference of 2026-09-17
 * ----------------------------------------------------------------------------
 * Three counts, the lead's sequence step by step with Review reply · Reschedule
 * · Stop, the follow-ups a person set, and Add reminder / New follow-up at the
 * foot (rendered by the drawer, opening the composer here).
 *
 * ⚠️ EVERYTHING ON IT IS A ROW. The steps are the sequence template joined to
 * the follow-ups the engine queued for it (170); the counts and states are
 * decided in `lib/domain/crm-followups.ts`, where they are tested. Nothing on
 * this tab is a number somebody typed into the design.
 *
 * ⚠️ AND EVERY BUTTON ANSWERS IN ITS OWN FRAME. The change is drawn at once from
 * local state; the server confirms it, the page re-renders, the desk re-reads
 * this lead, and the local overlay is dropped the moment the real rows arrive.
 * ========================================================================= */

export type FollowUpComposer = 'follow_up' | 'reminder' | null;

type Sequence = NonNullable<CrmLeadRelated['sequence']>;

/* ── The tab ──────────────────────────────────────────────────────────────── */

export function LeadFollowUpsTab({
  lead,
  related,
  viewerName,
  nowMs,
  loading,
  composer,
  onComposer,
  onReviewReply,
}: {
  lead: CrmLeadRecord;
  related: CrmLeadRelated;
  viewerName: string;
  nowMs: number;
  loading: boolean;
  composer: FollowUpComposer;
  onComposer: (next: FollowUpComposer) => void;
  onReviewReply: () => void;
}) {
  const toast = useToast();

  /* ⚠️ THE OPTIMISTIC OVERLAY, dropped the moment fresh rows arrive. */
  const [patches, setPatches] = React.useState<Record<string, Partial<CrmFollowUpRow>>>({});
  const [added, setAdded] = React.useState<CrmFollowUpRow[]>([]);
  const [sequencePatch, setSequencePatch] = React.useState<Partial<Sequence> | null>(null);
  /* A plan created here, drawn before the server render carrying it arrives. */
  const [madePlan, setMadePlan] = React.useState<Sequence | null>(null);
  const [discarded, setDiscarded] = React.useState(false);
  const [composerHidden, setComposerHidden] = React.useState(false);
  const [seen, setSeen] = React.useState(related);
  if (seen !== related) {
    setSeen(related);
    setPatches({});
    setAdded([]);
    setSequencePatch(null);
    setMadePlan(null);
    setDiscarded(false);
  }

  const followUps = React.useMemo(
    () => [...added, ...related.followUps.map((f) => ({ ...f, ...patches[f.id] }))],
    [added, related.followUps, patches],
  );
  const sequence = React.useMemo(
    () => (related.sequence ? { ...related.sequence, ...sequencePatch } : madePlan),
    [related.sequence, sequencePatch, madePlan],
  );

  const timeline = React.useMemo(
    () =>
      sequence
        ? sequenceTimeline(
            {
              id: sequence.id,
              state: sequence.state,
              currentStep: sequence.step,
              nextStepAt: sequence.nextStepAt,
              steps: sequence.steps,
            },
            followUps,
          )
        : [],
    [sequence, followUps],
  );
  const counts = followUpCounts(followUps, timeline, nowMs);

  /* ⚠️ A PLAN IS STORED IN PLACEHOLDERS AND READ AS WORDS. The step keeps
     `{{lead_first_name}}` so it is still right if the lead changes hands; every
     screen fills it for the person reading. */
  const tokens = React.useMemo(() => {
    const facts = leadFactsFrom(lead, related, viewerName, nowMs);
    return planTokens(facts, facts.visit ? formatWhen(facts.visit.at) : null);
  }, [lead, related, viewerName, nowMs]);

  /* The rows a person set — and anything left from an earlier sequence run. */
  const history = followUps
    .filter((f) => !sequence || f.leadSequenceId !== sequence.id)
    .sort((a, b) => Date.parse(b.doneAt ?? b.dueAt) - Date.parse(a.doneAt ?? a.dueAt));

  /* ⚠️ DRAWN FROM WHAT WAS JUST SAVED, not from a re-read. The dialog closes,
     the plan is on screen in the same frame, and the server render that follows
     replaces it — Rule Zero's first law on a screen that writes. */
  const onPlanned = (plan: PlanCreated) => {
    if (plan.kind === 'single') {
      const step = plan.steps[0];
      setAdded((v) => [
        {
          id: `saved-${Date.now()}`,
          title: step.title,
          purpose: plan.purpose,
          channel: step.channel,
          status: 'planned',
          dueAt: plan.firstAt,
          doneAt: null,
          outcomeNote: null,
          mode: step.mode,
          body: step.body.trim() || null,
          leadSequenceId: null,
          sequenceStepNo: null,
          doneByName: null,
          createdByName: 'You',
        },
        ...v,
      ]);
      return;
    }
    setMadePlan({
      id: plan.leadSequenceId ?? `new-${Date.now()}`,
      name: plan.name,
      purpose: plan.purpose,
      state: 'scheduled',
      step: 0,
      total: plan.steps.length,
      pauseReason: null,
      startedAt: new Date().toISOString(),
      nextStepAt: plan.firstAt,
      quotationId: null,
      steps: optimisticSteps(plan.steps, plan.purpose),
    });
  };

  const top = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (composer) top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [composer]);

  if (loading) {
    return <p className="py-6 text-center text-caption text-text-secondary">Loading…</p>;
  }

  return (
    <div ref={top} className="space-y-3">
      {/* ⚠️ THE ROW APPEARS WHEN THE BUTTON IS PRESSED, not when the server
          answers. The composer is hidden — not unmounted — while the save is in
          flight, so a refusal brings it straight back with what was typed. */}
      {composer === 'follow_up' && (
        <FollowUpWizard
          lead={lead}
          related={related}
          viewerName={viewerName}
          nowMs={nowMs}
          onClose={() => onComposer(null)}
          onCreated={(plan) => onPlanned(plan)}
        />
      )}

      {composer === 'reminder' && (
        <div hidden={composerHidden}>
          <Composer
            key={composer}
            kind={composer}
            lead={lead}
            onClose={() => onComposer(null)}
            onSubmit={(row) => {
              setAdded((v) => [row, ...v]);
              setComposerHidden(true);
            }}
            onSaved={(rowId) => {
              setAdded((v) => v.map((r) => (r.id === rowId ? { ...r, id: rowId.replace('new-', 'saved-') } : r)));
              setComposerHidden(false);
              onComposer(null);
              toast({ tone: 'ok', text: 'Reminder added.' });
            }}
            onFailed={(rowId) => {
              setAdded((v) => v.filter((r) => r.id !== rowId));
              setComposerHidden(false);
            }}
          />
        </div>
      )}

      {/* ── The three counts ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2.5">
        <Count
          label="Active"
          value={counts.active}
          hint="Due today or already late — waiting on somebody now."
          icon={<Play className="size-4 translate-x-px" aria-hidden="true" />}
          tone="var(--feedback-success)"
        />
        <Count
          label="Scheduled"
          value={counts.scheduled}
          hint="Planned for later, including sequence steps still to run."
          icon={<CalendarDays className="size-4" aria-hidden="true" />}
          tone="var(--channel-email)"
        />
        <Count
          label="Completed"
          value={counts.completed}
          hint="Done."
          icon={<Check className="size-4" strokeWidth={2.5} aria-hidden="true" />}
          tone="var(--feedback-success)"
        />
      </div>

      {/* ── A plan saved and not started ─────────────────────────────────── */}
      {related.draft && !discarded && <DraftCard lead={lead} draft={related.draft} onGone={() => setDiscarded(true)} />}

      {/* ── The sequence ─────────────────────────────────────────────────── */}
      {sequence ? (
        <SequenceCard
          lead={lead}
          related={related}
          sequence={sequence}
          timeline={timeline}
          tokens={tokens}
          onPatch={setSequencePatch}
          onReviewReply={onReviewReply}
        />
      ) : (
        <StartSequence lead={lead} options={related.sequenceOptions} />
      )}

      {/* ── Visits — kept from the old tab: somebody else's afternoon ────── */}
      {related.appointments.length > 0 && (
        <section className="rounded-xl border border-border-subtle bg-bg-surface p-3.5">
          <h3 className="text-body-sm font-semibold text-text-primary">Visits and meetings</h3>
          <ul className="mt-2 space-y-2">
            {related.appointments.map((a) => (
              <li key={a.id} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-bg-subtle text-text-secondary">
                  <CalendarClock className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-sm font-medium text-text-primary">
                    {appointmentKindLabel(a.kind)}
                    {a.location ? <span className="font-normal text-text-secondary"> · {a.location}</span> : null}
                  </p>
                  {a.outcome && <p className="truncate text-caption text-text-secondary">{a.outcome}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <Pill color={`var(--${appointmentStatusToken(a.status)})`}>{appointmentStatusLabel(a.status)}</Pill>
                  <p className="mt-1 text-caption tabular-nums text-text-secondary">{formatWhen(a.scheduledAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── What a person set ────────────────────────────────────────────── */}
      <History
        rows={history}
        nowMs={nowMs}
        tokens={tokens}
        planRunning={sequence !== null && ['scheduled', 'active', 'paused'].includes(sequence.state)}
        onPatch={(id, patch) => setPatches((p) => ({ ...p, [id]: { ...p[id], ...patch } }))}
      />
    </div>
  );
}

/* ── Counts ───────────────────────────────────────────────────────────────── */

function Count({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div
      title={hint}
      className="flex items-center gap-3 rounded-xl border border-border-subtle bg-bg-surface px-3 py-2.5"
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full border"
        style={{
          color: tone,
          borderColor: `color-mix(in oklab, ${tone} 45%, transparent)`,
          background: `color-mix(in oklab, ${tone} 8%, transparent)`,
        }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-caption text-text-secondary">{label}</p>
        <p className="text-h3 font-semibold leading-tight tabular-nums text-text-primary">{value}</p>
      </div>
    </div>
  );
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-caption font-medium"
      style={{
        color,
        borderColor: `color-mix(in oklab, ${color} 35%, transparent)`,
        background: `color-mix(in oklab, ${color} 10%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

/* ── The sequence card ────────────────────────────────────────────────────── */

const STEP_LOOK: Record<StepStatus, { label: (channel: string) => string; color: string }> = {
  sent: { label: (c) => (c === 'call' || c === 'task' ? 'Done' : 'Sent'), color: 'var(--feedback-success)' },
  queued: { label: () => 'Queued', color: 'var(--channel-email)' },
  needs_you: { label: () => 'Needs you', color: PAUSED_ORANGE },
  failed: { label: () => 'Failed', color: 'var(--feedback-error)' },
  skipped: { label: () => 'Skipped', color: 'var(--text-secondary)' },
  cancelled: { label: () => 'Cancelled', color: 'var(--text-secondary)' },
  upcoming: { label: () => 'Upcoming', color: 'var(--channel-email)' },
  paused: { label: () => 'Paused', color: PAUSED_ORANGE },
  stopped: { label: () => 'Not sent', color: 'var(--text-secondary)' },
};

function StepIcon({ status }: { status: StepStatus }) {
  const c = STEP_LOOK[status].color;
  if (status === 'sent') {
    return (
      <span className="grid size-7 place-items-center rounded-full text-white" style={{ background: c }}>
        <Check className="size-4" strokeWidth={3} aria-hidden="true" />
      </span>
    );
  }
  const Icon =
    status === 'paused' ? PauseCircle
      : status === 'queued' ? Send
        : status === 'needs_you' ? CircleAlert
          : status === 'failed' ? CircleAlert
            : status === 'stopped' ? CircleSlash
              : status === 'upcoming' ? Clock3
                : CircleMinus;
  return (
    <span className="grid size-7 place-items-center rounded-full bg-bg-surface" style={{ color: c }}>
      <Icon className="size-6" strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}

function stepWhen(step: TimelineStep): string {
  if (step.at) return formatWhen(step.at);
  if (step.status === 'paused') {
    return step.daysAfterResume === 0
      ? 'When resumed'
      : `${step.daysAfterResume} day${step.daysAfterResume === 1 ? '' : 's'} after resuming`;
  }
  return '—';
}

/** "client replied", "by Sahad", "the quotation is no longer live" — short enough for a pill. */
function shortReason(reason: string | null): string | null {
  if (!reason) return null;
  if (reason === 'the client replied') return 'client replied';
  return reason.replace(/^(paused|stopped) /, '');
}

function SequenceCard({
  lead,
  related,
  sequence,
  timeline,
  tokens,
  onPatch,
  onReviewReply,
}: {
  lead: CrmLeadRecord;
  related: CrmLeadRelated;
  sequence: Sequence;
  timeline: readonly TimelineStep[];
  tokens: Record<string, string>;
  onPatch: (patch: Partial<Sequence> | null) => void;
  onReviewReply: () => void;
}) {
  const toast = useToast();
  const [panel, setPanel] = React.useState<'reschedule' | 'stop' | null>(null);
  const [busy, setBusy] = React.useState(false);

  const live = sequence.state !== 'stopped';
  const paused = sequence.state === 'paused';
  const replied = paused && sequence.pauseReason === 'the client replied';
  const reason = shortReason(sequence.pauseReason);

  const quotation =
    related.quotations.find((q) => q.id === sequence.quotationId) ??
    related.quotations.find((q) => !['superseded', 'rejected', 'expired'].includes(q.status)) ??
    null;
  const description =
    sequence.purpose === 'quotation' && quotation
      ? `Follow up on quotation ${quotation.number}${lead.propertyLabel ? ` for ${lead.propertyLabel.replace(' · ', ' ')}` : ''}.`
      : `${sequence.total} step${sequence.total === 1 ? '' : 's'}, started ${formatWhen(sequence.startedAt)}.`;

  const state =
    sequence.state === 'active'
      ? { text: 'Running', color: 'var(--feedback-success)', Icon: Play }
      : sequence.state === 'scheduled'
        ? { text: 'Scheduled', color: 'var(--channel-email)', Icon: CalendarDays }
        : paused
          ? { text: `Paused${reason ? ` — ${reason}` : ''}`, color: PAUSED_ORANGE, Icon: PauseCircle }
          : { text: `Stopped${reason ? ` — ${reason}` : ''}`, color: 'var(--text-secondary)', Icon: CircleSlash };

  const act = async (
    optimistic: Partial<Sequence>,
    call: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done: string,
  ) => {
    if (busy) return;
    setBusy(true);
    setPanel(null);
    onPatch(optimistic);
    try {
      const result = await call();
      if (result.ok) toast({ tone: 'ok', text: done });
      else {
        onPatch(null);
        toast({ tone: 'error', text: result.error });
      }
    } catch {
      onPatch(null);
      toast({ tone: 'error', text: 'That did not save — the connection dropped.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-border-subtle bg-bg-surface p-4">
      <header className="flex items-start gap-3">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-xl"
          style={{ background: 'color-mix(in oklab, #7c3aed 12%, transparent)', color: '#7c3aed' }}
        >
          <Workflow className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-caption text-text-secondary">{live ? 'Current sequence' : 'Last sequence'}</p>
          <h3 className="truncate text-body font-semibold text-text-primary">{sequence.name}</h3>
          <p className="mt-0.5 text-caption text-text-secondary">{description}</p>
        </div>
        <span className="shrink-0">
          <Pill color={state.color}>
            <state.Icon className="size-3.5" aria-hidden="true" />
            {state.text}
          </Pill>
        </span>
      </header>

      {/* ── The steps ── */}
      <ol className="relative mt-4 space-y-3">
        {timeline.map((step, i) => {
          const look = STEP_LOOK[step.status];
          return (
            <li key={step.stepNo} className="relative flex items-start gap-3">
              {i < timeline.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute left-3.5 top-8 h-[calc(100%_-_1.25rem)] w-px -translate-x-1/2 bg-border-subtle"
                />
              )}
              <span className="relative shrink-0">
                <StepIcon status={step.status} />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="truncate text-body-sm font-semibold text-text-primary">
                  {step.stepNo}. {step.title}
                </p>
                {step.detail && (
                  <p className="truncate text-caption text-text-secondary">{fillTokens(step.detail, tokens)}</p>
                )}
              </div>
              <div className="shrink-0 pt-0.5 text-right">
                <Pill color={look.color}>{look.label(step.channel)}</Pill>
                <p className="mt-1 text-caption tabular-nums text-text-secondary">{stepWhen(step)}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {/* ── What this state means ── */}
      <div
        className="mt-4 flex items-start gap-2.5 rounded-lg px-3 py-2.5"
        style={{
          background: paused
            ? 'color-mix(in oklab, var(--feedback-success) 10%, transparent)'
            : live
              ? 'color-mix(in oklab, var(--channel-email) 8%, transparent)'
              : 'var(--bg-subtle)',
        }}
      >
        <Info
          className="mt-0.5 size-4 shrink-0"
          style={{ color: paused ? 'var(--feedback-success)' : live ? 'var(--channel-email)' : 'var(--text-secondary)' }}
          aria-hidden="true"
        />
        <div className="min-w-0 text-caption leading-relaxed">
          {paused ? (
            <>
              <p className="font-semibold text-text-primary">No further messages are sent while paused.</p>
              <p className="text-text-secondary">
                The sequence carries on when you resume or reschedule it
                {replied ? ' — read the reply first.' : '.'}
              </p>
            </>
          ) : live ? (
            <>
              <p className="font-semibold text-text-primary">
                {sequence.nextStepAt ? `Next step ${formatWhen(sequence.nextStepAt)}.` : 'Waiting for its next step.'}
              </p>
              <p className="text-text-secondary">It pauses by itself the moment the client replies.</p>
            </>
          ) : (
            <p className="text-text-secondary">
              This sequence has ended{reason ? ` — ${reason}` : ''}. Nothing further will be sent.
            </p>
          )}
        </div>
      </div>

      {/* ── The controls ── */}
      {live && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {paused ? (
            replied ? (
              <Button tone="primary" onClick={onReviewReply} icon={MessageSquareText}>
                Review reply
              </Button>
            ) : (
              <Button
                tone="primary"
                disabled={busy}
                icon={Play}
                onClick={() =>
                  void act(
                    { state: sequence.step === 0 ? 'scheduled' : 'active', pauseReason: null, nextStepAt: new Date().toISOString() },
                    () => rescheduleSequenceAction(sequence.id, new Date().toISOString()),
                    'Sequence resumed.',
                  )
                }
              >
                Resume now
              </Button>
            )
          ) : (
            <Button
              disabled={busy}
              icon={PauseCircle}
              onClick={() =>
                void act(
                  { state: 'paused', pauseReason: 'paused by you', nextStepAt: null },
                  () => pauseSequenceAction(sequence.id),
                  'Sequence paused.',
                )
              }
            >
              Pause
            </Button>
          )}
          <Button
            disabled={busy}
            active={panel === 'reschedule'}
            icon={CalendarClock}
            onClick={() => setPanel((p) => (p === 'reschedule' ? null : 'reschedule'))}
          >
            Reschedule
          </Button>
          <Button
            disabled={busy}
            active={panel === 'stop'}
            icon={Square}
            onClick={() => setPanel((p) => (p === 'stop' ? null : 'stop'))}
          >
            Stop
          </Button>
        </div>
      )}

      {panel === 'reschedule' && (
        <WhenPicker
          heading={paused ? 'Resume with the next step at' : 'Move the next step to'}
          confirm={paused ? 'Resume at this time' : 'Reschedule'}
          busy={busy}
          onCancel={() => setPanel(null)}
          onPick={(iso) =>
            void act(
              { state: sequence.step === 0 ? 'scheduled' : 'active', pauseReason: null, nextStepAt: iso },
              () => rescheduleSequenceAction(sequence.id, iso),
              paused ? 'Sequence resumed.' : 'Next step moved.',
            )
          }
        />
      )}

      {panel === 'stop' && (
        <div className="mt-3 rounded-lg border border-border-default p-3">
          <p className="text-body-sm font-semibold text-text-primary">Stop this sequence?</p>
          <p className="mt-0.5 text-caption text-text-secondary">
            Anything it has queued is cancelled and nothing further is sent. It cannot be restarted — you
            can start a new one.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button onClick={() => setPanel(null)}>Keep it running</Button>
            <Button
              tone="danger"
              disabled={busy}
              icon={Square}
              onClick={() =>
                void act(
                  { state: 'stopped', pauseReason: 'stopped by you', nextStepAt: null },
                  () => stopSequenceAction(sequence.id),
                  'Sequence stopped.',
                )
              }
            >
              Stop sequence
            </Button>
          </div>
        </div>
      )}

      {!live && related.sequenceOptions.length > 0 && (
        <div className="mt-3 border-t border-border-subtle pt-3">
          <StartSequence lead={lead} options={related.sequenceOptions} embedded />
        </div>
      )}
    </section>
  );
}

/* ── A plan saved and not started ────────────────────────────────────────── */

/**
 * ⚠️ A DRAFT HAS TO BE SOMEWHERE. "Save draft" that put a plan out of reach
 * would be worse than no button at all — this is where it lands, with the two
 * things anybody wants next.
 */
function DraftCard({
  lead,
  draft,
  onGone,
}: {
  lead: CrmLeadRecord;
  draft: NonNullable<CrmLeadRelated['draft']>;
  onGone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  const act = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await fn();
      if (result.ok) {
        onGone();
        toast({ tone: 'ok', text: ok });
      } else {
        toast({ tone: 'error', text: result.error });
      }
    } catch {
      toast({ tone: 'error', text: 'That did not save — the connection dropped.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-dashed border-border-default bg-bg-surface p-4">
      <header className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-bg-subtle text-text-secondary">
          <CalendarDays className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-caption text-text-secondary">Draft · not started yet</p>
          <h3 className="truncate text-body font-semibold text-text-primary">{draft.name}</h3>
          <p className="mt-0.5 text-caption text-text-secondary">
            {draft.steps.length} step{draft.steps.length === 1 ? '' : 's'} · saved {formatWhen(draft.createdAt)}
          </p>
        </div>
      </header>
      <ol className="mt-3 space-y-1.5">
        {draft.steps.map((s) => (
          <li key={s.stepNo} className="flex items-center gap-2.5 text-caption">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-bg-subtle font-semibold text-text-secondary">
              {s.stepNo}
            </span>
            <ChannelGlyph channel={s.channel} />
            <span className="min-w-0 flex-1 truncate text-text-primary">{s.title ?? channelLabel(s.channel)}</span>
            <span className="shrink-0 text-text-secondary">
              {s.delayDays === 0 ? 'at the start' : `${s.delayDays} day${s.delayDays === 1 ? '' : 's'} later`}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button tone="quiet" disabled={busy} onClick={() => void act(() => discardDraftAction(draft.id), 'Draft discarded.')}>
          Discard
        </Button>
        <Button
          tone="primary"
          icon={Play}
          disabled={busy}
          onClick={() => void act(() => startDraftAction(lead.id, draft.id, null), 'Plan started.')}
        >
          Start this plan
        </Button>
      </div>
    </section>
  );
}

/* ── Starting one ─────────────────────────────────────────────────────────── */

function StartSequence({
  lead,
  options,
  embedded = false,
}: {
  lead: CrmLeadRecord;
  options: CrmLeadRelated['sequenceOptions'];
  embedded?: boolean;
}) {
  const toast = useToast();
  const [chosen, setChosen] = React.useState(options[0]?.id ?? '');
  const [busy, setBusy] = React.useState(false);
  const [started, setStarted] = React.useState(false);

  const start = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    try {
      const result = await startSequenceAction({ leadId: lead.id, sequenceId: chosen, firstAt: null });
      if (result.ok) {
        setStarted(true);
        toast({ tone: 'ok', text: 'Sequence started.' });
      } else {
        toast({ tone: 'error', text: result.error });
      }
    } catch {
      toast({ tone: 'error', text: 'That did not save — the connection dropped.' });
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      <div className="flex items-start gap-3">
        {!embedded && (
          <span
            className="grid size-11 shrink-0 place-items-center rounded-xl"
            style={{ background: 'color-mix(in oklab, #7c3aed 12%, transparent)', color: '#7c3aed' }}
          >
            <Workflow className="size-5" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-body-sm font-semibold text-text-primary">
            {embedded ? 'Start a new sequence' : 'No sequence running'}
          </h3>
          <p className="mt-0.5 text-caption leading-relaxed text-text-secondary">
            {options.length > 0
              ? 'A sequence follows up on a schedule and pauses the moment the client replies.'
              : 'No sequences are set up for this project yet — your manager creates them.'}
          </p>
        </div>
      </div>
      {options.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            disabled={busy || started}
            aria-label="Sequence"
            className="min-w-0 flex-1 rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.steps} step{o.steps === 1 ? '' : 's'}
              </option>
            ))}
          </select>
          <Button tone="primary" icon={Play} disabled={busy || started || !chosen} onClick={() => void start()}>
            {busy ? 'Starting…' : started ? 'Started' : 'Start'}
          </Button>
        </div>
      )}
    </>
  );

  return embedded ? body : <section className="rounded-xl border border-border-subtle bg-bg-surface p-4">{body}</section>;
}

/* ── A time chooser, shared by Reschedule and the composer ────────────────── */

function WhenPicker({
  heading,
  confirm,
  busy,
  onPick,
  onCancel,
}: {
  heading: string;
  confirm: string;
  busy: boolean;
  onPick: (iso: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState(() => toInputValue(QUICK_TIMES[1].at()));
  const ms = fromInputValue(value);
  return (
    <div className="mt-3 rounded-lg border border-border-default p-3">
      <p className="text-caption font-semibold text-text-primary">{heading}</p>
      <QuickTimes value={value} onChange={setValue} />
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          tone="primary"
          icon={CalendarClock}
          disabled={busy || ms === null}
          onClick={() => ms !== null && onPick(new Date(ms).toISOString())}
        >
          {confirm}
        </Button>
      </div>
    </div>
  );
}

/* ── New follow-up / Add reminder ─────────────────────────────────────────── */

const CHANNEL_CHOICES = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'call', label: 'Call' },
  { key: 'email', label: 'Email' },
] as const;

function suggestionsFor(stage: string, channel: string): string[] {
  const verb = channel === 'call' ? 'Call' : channel === 'email' ? 'Email' : 'Message';
  if (stage === 'quotation_sent' || stage === 'proposal_pending') {
    return [`${verb} to check the quotation was received`, `${verb} about the payment plan`, `${verb} to confirm the decision date`];
  }
  if (stage === 'visit_scheduled' || stage === 'visited') {
    return [`${verb} to confirm the visit`, `${verb} after the visit`];
  }
  if (stage === 'negotiation') return [`${verb} with the revised figure`, `${verb} to agree the booking amount`];
  return [`${verb} to introduce ourselves`, `${verb} to ask about their budget`];
}

function Composer({
  kind,
  lead,
  onClose,
  onSubmit,
  onSaved,
  onFailed,
}: {
  kind: 'follow_up' | 'reminder';
  lead: CrmLeadRecord;
  onClose: () => void;
  /** The row, drawn now. */
  onSubmit: (row: CrmFollowUpRow) => void;
  onSaved: (rowId: string) => void;
  onFailed: (rowId: string) => void;
}) {
  const toast = useToast();
  const reminder = kind === 'reminder';
  const [channel, setChannel] = React.useState<'whatsapp' | 'call' | 'email' | 'task'>(reminder ? 'task' : 'whatsapp');
  const [title, setTitle] = React.useState('');
  const [note, setNote] = React.useState('');
  const [when, setWhen] = React.useState(() => toInputValue(QUICK_TIMES[1].at()));
  const [busy, setBusy] = React.useState(false);
  const at = fromInputValue(when);

  const save = async () => {
    if (busy || !title.trim() || at === null) return;
    setBusy(true);
    const dueAt = new Date(at).toISOString();
    const rowId = `new-${Date.now()}`;
    onSubmit({
      id: rowId,
      title: title.trim(),
      purpose: 'custom',
      channel,
      status: 'planned',
      dueAt,
      doneAt: null,
      outcomeNote: null,
      mode: 'remind_me',
      body: note.trim() || null,
      leadSequenceId: null,
      sequenceStepNo: null,
      doneByName: null,
      createdByName: 'You',
    });
    try {
      const result = await createFollowUpAction({ leadId: lead.id, channel, title, note, dueAt });
      if (result.ok) onSaved(rowId);
      else {
        onFailed(rowId);
        toast({ tone: 'error', text: result.error });
      }
    } catch {
      onFailed(rowId);
      toast({ tone: 'error', text: 'That did not save — the connection dropped.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="rounded-xl border p-4"
      style={{
        borderColor: 'color-mix(in oklab, var(--accent-primary) 35%, transparent)',
        background: 'color-mix(in oklab, var(--accent-primary) 4%, var(--bg-surface))',
      }}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-body-sm font-semibold text-text-primary">
          {reminder ? <Bell className="size-4" aria-hidden="true" /> : <CalendarClock className="size-4" aria-hidden="true" />}
          {reminder ? 'Add a reminder for yourself' : 'Plan a follow-up'}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-7 place-items-center rounded-md text-text-secondary hover:bg-bg-subtle"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      {!reminder && (
        <div className="mt-3 inline-flex rounded-lg border border-border-default p-0.5">
          {CHANNEL_CHOICES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setChannel(c.key)}
              aria-pressed={channel === c.key}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-caption font-medium transition-colors',
                channel === c.key ? 'bg-accent-primary text-white' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              <ChannelGlyph channel={c.key} onAccent={channel === c.key} />
              {c.label}
            </button>
          ))}
        </div>
      )}

      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
        }}
        maxLength={140}
        placeholder={reminder ? 'Remind me to…' : 'What is the follow-up?'}
        aria-label="Title"
        className="mt-3 w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
      />
      {!reminder && !title && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestionsFor(lead.stage, channel).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setTitle(s)}
              className="rounded-full bg-bg-subtle px-2.5 py-0.5 text-caption text-text-secondary transition-colors hover:text-text-primary"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 text-caption font-semibold text-text-primary">When</p>
      <QuickTimes value={when} onChange={setWhen} />

      <textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        placeholder="Note (optional)"
        aria-label="Note"
        className="mt-3 w-full resize-y rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-text-secondary">
          {at !== null ? `Due ${formatWhen(new Date(at).toISOString())}` : 'Choose a time'} · becomes the lead&rsquo;s next action if it is the soonest
        </p>
        <div className="ml-auto flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" disabled={busy || !title.trim() || at === null} onClick={() => void save()}>
            {busy ? 'Saving…' : reminder ? 'Save reminder' : 'Plan follow-up'}
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ── History ──────────────────────────────────────────────────────────────── */

const STATE_LOOK: Record<FollowUpState, { label: string; color: string }> = {
  planned: { label: 'Planned', color: 'var(--channel-email)' },
  due: { label: 'Due today', color: PAUSED_ORANGE },
  overdue: { label: 'Overdue', color: 'var(--feedback-error)' },
  done: { label: 'Completed', color: 'var(--feedback-success)' },
  cancelled: { label: 'Cancelled', color: 'var(--text-secondary)' },
  skipped: { label: 'Skipped', color: 'var(--text-secondary)' },
  failed: { label: 'Failed', color: 'var(--feedback-error)' },
};

type HistoryFilter = 'all' | 'open' | 'done' | 'cancelled';

function ChannelGlyph({ channel, onAccent = false }: { channel: string; onAccent?: boolean }) {
  const style = onAccent ? undefined : { color: channel === 'whatsapp' ? WA_GREEN : channel === 'email' ? MAIL_BLUE : undefined };
  if (channel === 'whatsapp') return <span style={style}><WhatsAppMark className="size-4" /></span>;
  if (channel === 'email') return <Mail className="size-4" style={style} aria-hidden="true" />;
  if (channel === 'call') return <Phone className="size-4" aria-hidden="true" />;
  return <Bell className="size-4" aria-hidden="true" />;
}

function History({
  rows,
  nowMs,
  tokens,
  planRunning,
  onPatch,
}: {
  rows: readonly CrmFollowUpRow[];
  nowMs: number;
  tokens: Record<string, string>;
  planRunning: boolean;
  onPatch: (id: string, patch: Partial<CrmFollowUpRow>) => void;
}) {
  const [filter, setFilter] = React.useState<HistoryFilter>('all');
  const [openId, setOpenId] = React.useState<string | null>(null);

  const shown = rows.filter((r) => {
    const s = followUpState(r, nowMs);
    if (filter === 'open') return s === 'planned' || s === 'due' || s === 'overdue';
    if (filter === 'done') return s === 'done';
    if (filter === 'cancelled') return s === 'cancelled' || s === 'skipped';
    return true;
  });

  return (
    <section className="pt-1">
      <header className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-body-sm font-semibold text-text-primary">Manual follow-up history</h3>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as HistoryFilter)}
          aria-label="Show"
          className="rounded-lg border border-border-default bg-bg-surface px-2.5 py-1 text-caption text-text-primary focus:border-accent-primary focus:outline-none"
        >
          <option value="all">All activity</option>
          <option value="open">Open</option>
          <option value="done">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </header>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-default px-4 py-5 text-center text-caption leading-relaxed text-text-secondary">
          {rows.length === 0
            ? 'Nothing planned by hand yet. Add a reminder for yourself, or plan the next call or message.'
            : 'Nothing here under this filter.'}
        </p>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-bg-surface">
          {shown.map((row) => (
            <HistoryRow
              key={row.id}
              row={row}
              nowMs={nowMs}
              tokens={tokens}
              planRunning={planRunning}
              open={openId === row.id}
              onToggle={() => setOpenId((id) => (id === row.id ? null : row.id))}
              onPatch={onPatch}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function HistoryRow({
  row,
  nowMs,
  tokens,
  planRunning,
  open,
  onToggle,
  onPatch,
}: {
  row: CrmFollowUpRow;
  nowMs: number;
  tokens: Record<string, string>;
  /** Whether a sequence is live on this lead — what "stop it too" would stop. */
  planRunning: boolean;
  open: boolean;
  onToggle: () => void;
  onPatch: (id: string, patch: Partial<CrmFollowUpRow>) => void;
}) {
  const toast = useToast();
  const state = followUpState(row, nowMs);
  const look = STATE_LOOK[state];
  const openRow = state === 'planned' || state === 'due' || state === 'overdue';
  const [note, setNote] = React.useState('');
  const [stopPlan, setStopPlan] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const pending = row.id.startsWith('new-');
  /* Saved, and the real row (with its real id) is on its way — nothing to act on yet. */
  const provisional = pending || row.id.startsWith('saved-');

  const close = async (done: boolean) => {
    if (busy || provisional) return;
    setBusy(true);
    const before = { status: row.status, doneAt: row.doneAt, outcomeNote: row.outcomeNote };
    onPatch(row.id, done
      ? { status: 'done', doneAt: new Date().toISOString(), outcomeNote: note.trim() || null }
      : { status: 'cancelled' });
    onToggle();
    try {
      const result = done
        ? await completeFollowUpAction(row.id, note, planRunning && stopPlan)
        : await cancelFollowUpAction(row.id);
      if (result.ok) toast({ tone: 'ok', text: done ? 'Marked as done.' : 'Follow-up cancelled.' });
      else {
        onPatch(row.id, before);
        toast({ tone: 'error', text: result.error });
      }
    } catch {
      onPatch(row.id, before);
      toast({ tone: 'error', text: 'That did not save — the connection dropped.' });
    } finally {
      setBusy(false);
    }
  };

  const channelTone =
    row.channel === 'whatsapp' ? WA_GREEN : row.channel === 'email' ? MAIL_BLUE : 'var(--text-secondary)';
  const detail = row.outcomeNote ?? (row.body ? fillTokens(row.body, tokens) : null) ?? `${channelLabel(row.channel)} follow-up`;
  const when = row.doneAt ?? row.dueAt;
  const who = row.doneByName ?? row.createdByName;

  return (
    <li>
      <button
        type="button"
        onClick={openRow && !provisional ? onToggle : undefined}
        className={cn(
          'flex w-full items-start gap-3 px-3.5 py-3 text-left',
          openRow && !provisional ? 'cursor-pointer hover:bg-bg-subtle' : 'cursor-default',
        )}
        aria-expanded={openRow ? open : undefined}
      >
        <span
          className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full"
          style={{ background: `color-mix(in oklab, ${channelTone} 12%, transparent)`, color: channelTone }}
        >
          <ChannelGlyph channel={row.channel} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm font-semibold text-text-primary">{row.title}</span>
          <span className="block truncate text-caption text-text-secondary">{detail}</span>
        </span>
        <span className="shrink-0 text-right">
          <Pill color={look.color}>
            {state === 'done' && <CircleCheck className="size-3.5" aria-hidden="true" />}
            {pending ? 'Saving…' : look.label}
          </Pill>
          <span className="mt-1 block text-caption tabular-nums text-text-secondary">{formatWhen(when)}</span>
          {who && <span className="block text-caption text-text-tertiary">{who}</span>}
        </span>
      </button>

      {open && openRow && (
        <div className="border-t border-border-subtle bg-bg-subtle/40 px-3.5 py-3">
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void close(true);
            }}
            maxLength={2000}
            placeholder="What happened? (optional)"
            aria-label="Outcome"
            className="w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
          />
          {/* ⚠️ THE CHASE ENDS WITH IT, UNLESS YOU SAY OTHERWISE. Owner's rule:
              completing the follow-up means it is handled — so the plan stops
              rather than nudging the client again tomorrow. */}
          {planRunning && (
            <label className="mt-2 flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={stopPlan}
                onChange={(e) => setStopPlan(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--pick-mark)]"
              />
              <span className="text-caption leading-relaxed text-text-secondary">
                <span className="font-medium text-text-primary">Stop the running plan too.</span>{' '}
                Nothing further is sent, and anything it had queued is cancelled.
              </span>
            </label>
          )}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button tone="quiet" disabled={busy} onClick={() => void close(false)}>
              Cancel follow-up
            </Button>
            <Button tone="primary" icon={Check} disabled={busy} onClick={() => void close(true)}>
              Mark as done
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/* ── Buttons ──────────────────────────────────────────────────────────────── */

function Button({
  tone = 'outline',
  icon: Icon,
  active = false,
  disabled,
  onClick,
  children,
}: {
  tone?: 'outline' | 'primary' | 'danger' | 'quiet';
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-caption font-semibold transition-colors disabled:opacity-50',
        tone === 'primary' && 'bg-accent-primary text-white hover:opacity-90',
        tone === 'danger' && 'bg-feedback-error text-white hover:opacity-90',
        tone === 'outline' &&
          cn(
            'border text-text-primary hover:bg-bg-subtle',
            active ? 'border-accent-primary bg-bg-subtle' : 'border-border-default bg-bg-surface',
          ),
        tone === 'quiet' && 'text-text-secondary hover:text-text-primary',
      )}
    >
      {Icon && <Icon className="size-4" aria-hidden="true" />}
      {children}
    </button>
  );
}
