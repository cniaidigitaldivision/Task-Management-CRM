'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  CreditCard,
  FileText,
  Mail,
  MapPin,
  MessageSquareText,
  MoreHorizontal,
  Phone,
  Plus,
  Settings2,
  Square,
  Target,
  Trash2,
  Users,
  X,
} from 'lucide-react';

import { createFollowUpPlanAction } from '@/app/actions/crm-followups';
import { MAIL_BLUE, WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { formatDay, formatWhen, fromInputValue, QuickTimes, toInputValue } from '@/components/crm/when';
import { useToast } from '@/components/ui/toast';
import type { CrmLeadRecord, CrmLeadRelated, CrmSequenceStep } from '@/lib/db/queries/crm-leads';
import {
  fillTokens,
  leadFactsFrom,
  MAX_STEPS,
  planProblem,
  planTokens,
  purposeAvailability,
  purposeLabel,
  PURPOSE_CARDS,
  stopConditions,
  suggestedPlan,
  type FollowUpPurpose,
  type PlanChannel,
  type PlanMode,
  type PlanStep,
} from '@/lib/domain/crm-followup-plans';
import { cn } from '@/lib/utils';

/* ============================================================================
 * NEW FOLLOW-UP — purpose, message, schedule, review
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17, with a design: *"this type of form should pop up… I want to
 * set a scheduler [or] a single follow-up."*
 *
 * ⚠️ THE SCREENSHOT IS THE IDEA; THE DATA IS OURS. The nine purposes are
 * `crm_followup_purpose` (153). The suggested plans, the goal and the stop
 * conditions come from `lib/domain/crm-followup-plans.ts`, where they are
 * tested — and the stop conditions listed are the branches of the engine's own
 * `app.crm_sequence_stop_reason`, not a description of them.
 *
 * ⚠️ AND A CARD SAYS WHY IT CANNOT BE USED, BEFORE IT IS PRESSED. "Quotation
 * follow-up" with no live quotation would be stopped by the engine on its first
 * pass; the card says so instead of the sequence dying quietly.
 *
 * ⚠️ NOTHING HERE TOUCHES THE NETWORK UNTIL "Create". Every step, every
 * suggestion and every preview is client state — Rule Zero's first law.
 * ========================================================================= */

export interface PlanCreated {
  readonly kind: 'single' | 'schedule';
  readonly purpose: string;
  readonly name: string;
  readonly steps: readonly PlanStep[];
  readonly firstAt: string;
  readonly sequenceId: string | null;
  readonly leadSequenceId: string | null;
}

const PURPOSE_ICON: Record<FollowUpPurpose, React.ComponentType<{ className?: string }>> = {
  no_response: MessageSquareText,
  quotation: FileText,
  appointment_reminder: CalendarDays,
  missing_information: CircleHelp,
  approved_offer: BadgeCheck,
  payment_reminder: CreditCard,
  site_visit_checkin: MapPin,
  re_engage: Users,
  custom: MoreHorizontal,
};

const STAGES = ['Purpose', 'Channel & message', 'Schedule & conditions', 'Review'] as const;

const MODE_LABEL: Record<PlanMode, string> = {
  remind_me: 'Reminder for me',
  review_first: 'Draft for me to send',
  auto_send: 'Sent automatically',
};

/* ── Channel glyphs, in the channel's own colour ─────────────────────────── */

function ChannelIcon({ channel, className = 'size-4' }: { channel: string; className?: string }) {
  if (channel === 'whatsapp') return <span style={{ color: WA_GREEN }}><WhatsAppMark className={className} /></span>;
  if (channel === 'email') return <Mail className={className} style={{ color: MAIL_BLUE }} aria-hidden="true" />;
  if (channel === 'call') return <Phone className={className} aria-hidden="true" />;
  return <Bell className={className} aria-hidden="true" />;
}

function channelVerb(channel: string): string {
  if (channel === 'whatsapp') return 'Send via WhatsApp';
  if (channel === 'email') return 'Send via Email';
  if (channel === 'call') return 'Call them';
  return 'A task for you';
}

const CHANNEL_CHOICES: ReadonlyArray<{ key: PlanChannel; label: string }> = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
  { key: 'call', label: 'Call' },
  { key: 'task', label: 'Task' },
];

/* ── The dialog ──────────────────────────────────────────────────────────── */

export function FollowUpWizard({
  lead,
  related,
  viewerName,
  /* The clock comes from the page, never `Date.now()` in a render: two renders
     would otherwise draw two different "tomorrow". */
  nowMs,
  onClose,
  onCreated,
}: {
  lead: CrmLeadRecord;
  related: CrmLeadRelated;
  viewerName: string;
  nowMs: number;
  onClose: () => void;
  onCreated: (plan: PlanCreated) => void;
}) {
  const toast = useToast();
  const [stage, setStage] = React.useState(0);
  const [purpose, setPurpose] = React.useState<FollowUpPurpose>('no_response');
  const [kind, setKind] = React.useState<'single' | 'schedule'>('schedule');
  const [steps, setSteps] = React.useState<readonly PlanStep[]>(() => suggestedPlan('no_response'));
  const [touched, setTouched] = React.useState(false);
  const [stopOnReply, setStopOnReply] = React.useState(true);
  const [keepNextAction, setKeepNextAction] = React.useState(false);
  const [startAt, setStartAt] = React.useState<string | null>(null);
  const [advanced, setAdvanced] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  /* ── What this lead can answer ──────────────────────────────────────────── */
  const facts = React.useMemo(
    () => leadFactsFrom(lead, related, viewerName, nowMs),
    [lead, related, viewerName, nowMs],
  );

  const tokens = React.useMemo(
    () => planTokens(facts, facts.visit ? formatWhen(facts.visit.at) : null),
    [facts],
  );

  /* ⚠️ CHANGING THE PURPOSE REWRITES THE PLAN — unless the plan has been edited.
     Losing somebody's typing because they went back one screen is the kind of
     small betrayal that makes people distrust a wizard. */
  const choosePurpose = (next: FollowUpPurpose) => {
    setPurpose(next);
    if (!touched) setSteps(suggestedPlan(next));
  };

  const editSteps = (next: readonly PlanStep[]) => {
    setTouched(true);
    setSteps(next);
  };

  const shown = kind === 'single' ? steps.slice(0, 1) : steps;
  const problem = planProblem(shown);
  const firstAtMs = startAt ? fromInputValue(startAt) : null;
  const startMs = firstAtMs ?? nowMs + Math.max(0, (shown[0]?.day ?? 1) - 1) * 86_400_000;

  const create = async () => {
    if (busy || problem) return;
    setBusy(true);
    try {
      const result = await createFollowUpPlanAction({
        leadId: lead.id,
        kind,
        purpose,
        name: purposeLabel(purpose),
        stopOnReply,
        keepNextAction,
        firstAt: firstAtMs !== null ? new Date(firstAtMs).toISOString() : null,
        steps: shown.map((s) => ({ day: s.day, channel: s.channel, title: s.title, body: s.body, mode: s.mode })),
      });
      if (!result.ok) {
        toast({ tone: 'error', text: result.error });
        return;
      }
      onCreated({
        kind,
        purpose,
        name: purposeLabel(purpose),
        steps: shown,
        firstAt: result.plan?.nextStepAt ?? new Date(startMs).toISOString(),
        sequenceId: result.plan?.sequenceId ?? null,
        leadSequenceId: result.plan?.leadSequenceId ?? null,
      });
      toast({ tone: 'ok', text: kind === 'single' ? 'Follow-up planned.' : 'Plan started.' });
      onClose();
    } catch {
      toast({ tone: 'error', text: 'That did not save — the connection dropped.' });
    } finally {
      setBusy(false);
    }
  };

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

  const body = (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="New follow-up"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[56rem] flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface shadow-2xl"
      >
        {/* ── Header ────────────────────────────────────────────────────── */}
        <header className="shrink-0 border-b border-border-subtle px-5 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-h3 font-semibold text-text-primary">New follow-up</h2>
              <p className="mt-0.5 text-caption text-text-secondary">
                Create a follow-up for this lead. Choose the purpose and how it goes out.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <Stepper stage={stage} onStage={setStage} />
          <LeadStrip lead={lead} facts={facts} />
        </header>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {stage === 0 && (
            <Purpose
              purpose={purpose}
              facts={facts}
              steps={shown}
              kind={kind}
              stopOnReply={stopOnReply}
              onChoose={choosePurpose}
              advanced={advanced}
              onAdvanced={setAdvanced}
              keepNextAction={keepNextAction}
              onKeepNextAction={setKeepNextAction}
              startAt={startAt}
              onStartAt={setStartAt}
            />
          )}
          {stage === 1 && (
            <Message
              kind={kind}
              onKind={setKind}
              steps={steps}
              onSteps={editSteps}
              tokens={tokens}
              purpose={purpose}
            />
          )}
          {stage === 2 && (
            <Schedule
              kind={kind}
              steps={steps}
              onSteps={editSteps}
              purpose={purpose}
              stopOnReply={stopOnReply}
              onStopOnReply={setStopOnReply}
              startAt={startAt}
              onStartAt={setStartAt}
              startMs={startMs}
            />
          )}
          {stage === 3 && (
            <Review
              kind={kind}
              purpose={purpose}
              steps={shown}
              facts={facts}
              tokens={tokens}
              stopOnReply={stopOnReply}
              keepNextAction={keepNextAction}
              startMs={startMs}
            />
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
          <p className="min-w-0 truncate text-caption text-text-secondary">
            {problem ? <span className="text-feedback-error">{problem}</span>
              : kind === 'single'
                ? `One follow-up · ${formatWhen(new Date(startMs).toISOString())}`
                : `${shown.length} step${shown.length === 1 ? '' : 's'} · starts ${formatWhen(new Date(startMs).toISOString())}`}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button onClick={stage === 0 ? onClose : () => setStage((s) => s - 1)}>
              {stage === 0 ? 'Cancel' : 'Back'}
            </Button>
            {stage < 3 ? (
              <Button tone="primary" icon={ArrowRight} iconAfter onClick={() => setStage((s) => s + 1)}>
                Continue
              </Button>
            ) : (
              <Button tone="primary" icon={Check} disabled={busy || problem !== null} onClick={() => void create()}>
                {busy ? 'Saving…' : kind === 'single' ? 'Plan follow-up' : 'Start the plan'}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}

/* ── Stepper ─────────────────────────────────────────────────────────────── */

function Stepper({ stage, onStage }: { stage: number; onStage: (n: number) => void }) {
  return (
    <ol className="mt-3 flex items-center gap-2">
      {STAGES.map((label, i) => (
        <li key={label} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
          <button
            type="button"
            onClick={() => onStage(i)}
            aria-current={i === stage ? 'step' : undefined}
            className="flex min-w-0 items-center gap-2 text-left"
          >
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold transition-colors',
                i === stage
                  ? 'bg-accent-primary text-white'
                  : i < stage
                    ? 'bg-feedback-success text-white'
                    : 'border border-border-default bg-bg-surface text-text-secondary',
              )}
            >
              {i < stage ? <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> : i + 1}
            </span>
            <span
              className={cn(
                'truncate text-caption',
                i === stage ? 'font-semibold text-text-primary' : 'text-text-secondary',
              )}
            >
              {label}
            </span>
          </button>
          {i < STAGES.length - 1 && <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border-subtle" />}
        </li>
      ))}
    </ol>
  );
}

/* ── The lead, so nobody plans for the wrong person ──────────────────────── */

function LeadStrip({ lead, facts }: { lead: CrmLeadRecord; facts: ReturnType<typeof leadFactsFrom> }) {
  const initials = (lead.fullName ?? '?')
    .split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  const money = (n: number) => `PKR ${n.toLocaleString('en-PK')}`;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-bg-subtle px-3.5 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-primary/15 text-caption font-semibold text-accent-primary">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-body-sm font-semibold text-text-primary">{lead.fullName ?? 'Unnamed lead'}</p>
          <p className="truncate text-caption text-text-secondary">
            {lead.projectName}
            {lead.propertyLabel ? ` · ${lead.propertyLabel}` : ''}
          </p>
        </div>
      </div>
      {lead.city && (
        <Fact icon={<MapPin className="size-4" aria-hidden="true" />} label={lead.city} />
      )}
      {facts.quotation && (
        <Fact
          icon={<FileText className="size-4" aria-hidden="true" />}
          label={facts.quotation.number}
          detail={money(facts.quotation.amount)}
        />
      )}
      {facts.visit && (
        <Fact
          icon={<CalendarDays className="size-4" aria-hidden="true" />}
          label="Visit booked"
          detail={formatWhen(facts.visit.at)}
        />
      )}
      <Fact
        icon={<Users className="size-4" aria-hidden="true" />}
        label="Owner"
        detail={lead.ownerName ?? 'Unassigned'}
      />
    </div>
  );
}

function Fact({ icon, label, detail }: { icon: React.ReactNode; label: string; detail?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-text-secondary">
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-caption font-medium text-text-primary">{label}</p>
        {detail && <p className="truncate text-caption">{detail}</p>}
      </div>
    </div>
  );
}

/* ── 1 · Purpose ─────────────────────────────────────────────────────────── */

function Purpose({
  purpose,
  facts,
  steps,
  kind,
  stopOnReply,
  onChoose,
  advanced,
  onAdvanced,
  keepNextAction,
  onKeepNextAction,
  startAt,
  onStartAt,
}: {
  purpose: FollowUpPurpose;
  facts: ReturnType<typeof leadFactsFrom>;
  steps: readonly PlanStep[];
  kind: 'single' | 'schedule';
  stopOnReply: boolean;
  onChoose: (p: FollowUpPurpose) => void;
  advanced: boolean;
  onAdvanced: (v: boolean) => void;
  keepNextAction: boolean;
  onKeepNextAction: (v: boolean) => void;
  startAt: string | null;
  onStartAt: (v: string | null) => void;
}) {
  const card = PURPOSE_CARDS.find((c) => c.key === purpose)!;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.05fr_1fr]">
      <section>
        <h3 className="text-body font-semibold text-text-primary">What is this follow-up for?</h3>
        <p className="mt-0.5 text-caption text-text-secondary">It decides the suggested plan and when it stops.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PURPOSE_CARDS.map((c) => {
            const can = purposeAvailability(c.key, facts);
            const Icon = PURPOSE_ICON[c.key];
            const chosen = c.key === purpose;
            return (
              <button
                key={c.key}
                type="button"
                disabled={!can.ok}
                onClick={() => onChoose(c.key)}
                aria-pressed={chosen}
                title={can.reason ?? undefined}
                className={cn(
                  'relative rounded-xl border p-3 text-left transition-colors',
                  chosen
                    ? 'border-accent-primary bg-accent-primary/5'
                    : can.ok
                      ? 'border-border-subtle bg-bg-surface hover:bg-bg-subtle'
                      : 'cursor-not-allowed border-border-subtle bg-bg-subtle/50 opacity-60',
                )}
              >
                {chosen && (
                  <span className="absolute right-2 top-2 grid size-4 place-items-center rounded-full bg-accent-primary text-white">
                    <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                  </span>
                )}
                <span
                  className={cn(
                    'grid size-8 place-items-center rounded-lg',
                    chosen ? 'bg-accent-primary text-white' : 'bg-bg-subtle text-text-secondary',
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="mt-2 block text-body-sm font-semibold leading-tight text-text-primary">{c.label}</span>
                <span className="mt-0.5 block text-caption leading-snug text-text-secondary">
                  {can.ok ? c.blurb : can.reason}
                </span>
                {c.badge && can.ok && (
                  <span className="mt-1.5 inline-block rounded-md bg-feedback-warning/15 px-1.5 py-0.5 text-caption font-medium text-feedback-warning">
                    {c.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Advanced ─────────────────────────────────────────────────── */}
        <div className="mt-3 rounded-xl border border-border-subtle">
          <button
            type="button"
            onClick={() => onAdvanced(!advanced)}
            aria-expanded={advanced}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
          >
            <Settings2 className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-body-sm font-medium text-text-primary">Advanced settings (optional)</span>
              <span className="block text-caption text-text-secondary">Start at a set time, or leave the desk&rsquo;s next action alone.</span>
            </span>
            <ChevronDown className={cn('size-4 shrink-0 text-text-secondary transition-transform', advanced && 'rotate-180')} aria-hidden="true" />
          </button>
          {advanced && (
            <div className="border-t border-border-subtle px-3.5 py-3">
              <p className="text-caption font-semibold text-text-primary">Start the first step at</p>
              <QuickTimes value={startAt ?? ''} onChange={(v) => onStartAt(v)} />
              {startAt && (
                <button
                  type="button"
                  onClick={() => onStartAt(null)}
                  className="mt-1.5 text-caption text-text-secondary underline hover:text-text-primary"
                >
                  Use the plan&rsquo;s own timing instead
                </button>
              )}
              <label className="mt-3 flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={keepNextAction}
                  onChange={(e) => onKeepNextAction(e.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--accent-primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-body-sm text-text-primary">Leave the lead&rsquo;s Next action unchanged</span>
                  <span className="block text-caption text-text-secondary">
                    By default the desk row starts showing this follow-up when it is the soonest thing owed.
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>
      </section>

      {/* ── The suggestion ───────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border-subtle bg-bg-subtle/40 p-3.5">
        <h3 className="text-body font-semibold text-text-primary">
          {kind === 'single' ? 'Suggested follow-up' : 'Follow-up plan (suggested)'}
        </h3>
        <p className="mt-0.5 text-caption text-text-secondary">
          You can change every part of this on the next screen.
        </p>
        <ol className="mt-3 space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2.5">
              <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border-default bg-bg-surface text-caption font-semibold text-text-secondary">
                {i + 1}
              </span>
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-bg-surface">
                <ChannelIcon channel={s.channel} className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body-sm font-semibold text-text-primary">Day {s.day}</span>
                <span className="block truncate text-caption text-text-secondary">{channelVerb(s.channel)}</span>
              </span>
              <span className="shrink-0 rounded-md bg-bg-surface px-2 py-0.5 text-caption text-text-secondary">
                {s.title}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-3 space-y-2.5 border-t border-border-subtle pt-3">
          <div className="flex items-start gap-2.5">
            <Target className="mt-0.5 size-4 shrink-0 text-accent-primary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-body-sm font-semibold text-text-primary">Goal</p>
              <p className="text-caption leading-relaxed text-text-secondary">{card.goal(facts)}</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <Square className="mt-0.5 size-4 shrink-0 text-text-secondary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-body-sm font-semibold text-text-primary">Stop condition</p>
              <p className="text-caption leading-relaxed text-text-secondary">
                {stopOnReply
                  ? 'Stops on any reply, and whenever the lead closes.'
                  : 'Stops when the lead closes or they ask not to be messaged.'}
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ── 2 · Channel & message ───────────────────────────────────────────────── */

function Message({
  kind,
  onKind,
  steps,
  onSteps,
  tokens,
  purpose,
}: {
  kind: 'single' | 'schedule';
  onKind: (k: 'single' | 'schedule') => void;
  steps: readonly PlanStep[];
  onSteps: (s: readonly PlanStep[]) => void;
  tokens: Record<string, string>;
  purpose: FollowUpPurpose;
}) {
  const shown = kind === 'single' ? steps.slice(0, 1) : steps;
  const set = (i: number, patch: Partial<PlanStep>) =>
    onSteps(steps.map((s, n) => (n === i ? { ...s, ...patch } : s)));

  const add = () => {
    const last = steps[steps.length - 1];
    onSteps([
      ...steps,
      { day: (last?.day ?? 1) + 3, channel: last?.channel ?? 'whatsapp', title: `Step ${steps.length + 1}`, body: '', mode: 'review_first' },
    ]);
  };

  return (
    <div className="space-y-4">
      {/* ⚠️ THE OWNER'S OWN QUESTION, ASKED ONCE AND PLAINLY. */}
      <section>
        <h3 className="text-body font-semibold text-text-primary">One follow-up, or a plan?</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Choice
            chosen={kind === 'single'}
            onClick={() => onKind('single')}
            icon={CalendarClock}
            title="A single follow-up"
            detail="One action, at one time. It appears in your list and on the desk row."
          />
          <Choice
            chosen={kind === 'schedule'}
            onClick={() => onKind('schedule')}
            icon={CalendarDays}
            title="A scheduler"
            detail="Day 1, day 3, day 7 — it runs step by step and pauses when they reply."
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-body font-semibold text-text-primary">
          {kind === 'single' ? 'What are you going to do?' : 'What each step says'}
        </h3>
        {shown.map((s, i) => (
          <StepEditor
            key={i}
            index={i}
            step={s}
            tokens={tokens}
            single={kind === 'single'}
            canRemove={kind === 'schedule' && steps.length > 1}
            onChange={(patch) => set(i, patch)}
            onRemove={() => onSteps(steps.filter((_, n) => n !== i))}
          />
        ))}
        {kind === 'schedule' && steps.length < MAX_STEPS && (
          <button
            type="button"
            onClick={add}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border-default px-3 py-2 text-caption font-medium text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add a step
          </button>
        )}
        {purpose === 'custom' && (
          <p className="text-caption text-text-secondary">
            A custom follow-up starts empty on purpose — write it in your own words.
          </p>
        )}
      </section>
    </div>
  );
}

function Choice({
  chosen,
  onClick,
  icon: Icon,
  title,
  detail,
}: {
  chosen: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={chosen}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors',
        chosen ? 'border-accent-primary bg-accent-primary/5' : 'border-border-subtle bg-bg-surface hover:bg-bg-subtle',
      )}
    >
      <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', chosen ? 'bg-accent-primary text-white' : 'bg-bg-subtle text-text-secondary')}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-body-sm font-semibold text-text-primary">{title}</span>
        <span className="block text-caption leading-snug text-text-secondary">{detail}</span>
      </span>
    </button>
  );
}

function StepEditor({
  index,
  step,
  tokens,
  single,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  step: PlanStep;
  tokens: Record<string, string>;
  single: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<PlanStep>) => void;
  onRemove: () => void;
}) {
  const writes = step.channel === 'whatsapp' || step.channel === 'email';
  const preview = fillTokens(step.body, tokens);
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-surface p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {!single && (
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-bg-subtle text-caption font-semibold text-text-secondary">
            {index + 1}
          </span>
        )}
        <input
          value={step.title}
          onChange={(e) => onChange({ title: e.target.value })}
          maxLength={60}
          aria-label={single ? 'What the follow-up is' : `Step ${index + 1} name`}
          placeholder={single ? 'What is the follow-up?' : 'Step name'}
          className="min-w-0 flex-1 rounded-lg border border-border-default bg-bg-surface px-3 py-1.5 text-body-sm font-medium text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
        />
        <div className="inline-flex shrink-0 rounded-lg border border-border-default p-0.5">
          {CHANNEL_CHOICES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onChange({ channel: c.key, mode: c.key === 'whatsapp' || c.key === 'email' ? step.mode : 'remind_me' })}
              aria-pressed={step.channel === c.key}
              title={c.label}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-caption font-medium transition-colors',
                step.channel === c.key ? 'bg-bg-subtle text-text-primary' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              <ChannelIcon channel={c.key} className="size-3.5" />
              <span className="hidden sm:inline">{c.label}</span>
            </button>
          ))}
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove step ${index + 1}`}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-feedback-error"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <textarea
        rows={writes ? 3 : 2}
        value={step.body}
        onChange={(e) => onChange({ body: e.target.value })}
        maxLength={1500}
        aria-label={writes ? 'Message' : 'Note'}
        placeholder={writes ? 'The message that goes to the client…' : 'A note for whoever does this…'}
        className="mt-2 w-full resize-y rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm leading-relaxed text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
      />

      {writes && (
        <>
          {/* ⚠️ THE SAME `{{placeholders}}` AS THE CHAT'S SAVED REPLIES, so one
              plan reads correctly for whoever ends up running it. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {['lead_first_name', 'my_first_name', 'company', 'project'].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onChange({ body: `${step.body}{{${key}}}` })}
                className="rounded-full bg-bg-subtle px-2 py-0.5 text-caption text-text-secondary transition-colors hover:text-text-primary"
              >
                {`{{${key}}}`}
              </button>
            ))}
          </div>
          {step.body.includes('{{') && (
            <p className="mt-1.5 rounded-lg bg-bg-subtle px-2.5 py-1.5 text-caption leading-relaxed text-text-secondary">
              <span className="font-semibold text-text-primary">Preview: </span>
              {preview}
            </p>
          )}
        </>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-caption text-text-secondary">When it falls due:</span>
        {(['review_first', 'remind_me'] as const).map((m) => (
          <button
            key={m}
            type="button"
            disabled={!writes && m === 'review_first'}
            onClick={() => onChange({ mode: m })}
            aria-pressed={step.mode === m}
            className={cn(
              'rounded-full border px-2.5 py-1 text-caption font-medium transition-colors disabled:opacity-40',
              step.mode === m ? 'border-accent-primary bg-accent-primary/10 text-text-primary' : 'border-border-default text-text-secondary hover:text-text-primary',
            )}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── 3 · Schedule & conditions ───────────────────────────────────────────── */

function Schedule({
  kind,
  steps,
  onSteps,
  purpose,
  stopOnReply,
  onStopOnReply,
  startAt,
  onStartAt,
  startMs,
}: {
  kind: 'single' | 'schedule';
  steps: readonly PlanStep[];
  onSteps: (s: readonly PlanStep[]) => void;
  purpose: FollowUpPurpose;
  stopOnReply: boolean;
  onStopOnReply: (v: boolean) => void;
  startAt: string | null;
  onStartAt: (v: string | null) => void;
  startMs: number;
}) {
  const conditions = stopConditions(purpose);
  const set = (i: number, day: number) => onSteps(steps.map((s, n) => (n === i ? { ...s, day } : s)));

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <section>
        <h3 className="text-body font-semibold text-text-primary">
          {kind === 'single' ? 'When?' : 'The schedule'}
        </h3>
        {kind === 'single' ? (
          <>
            <p className="mt-0.5 text-caption text-text-secondary">Karachi time, whatever your laptop is set to.</p>
            <QuickTimes value={startAt ?? toInputValue(startMs)} onChange={(v) => onStartAt(v)} />
          </>
        ) : (
          <>
            <p className="mt-0.5 text-caption text-text-secondary">
              Day 1 is the day it starts. Each step falls on its own day, at this time of day.
            </p>
            <ol className="mt-3 space-y-2">
              {steps.map((s, i) => (
                <li key={i} className="flex items-center gap-2.5 rounded-xl border border-border-subtle bg-bg-surface px-3 py-2">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-bg-subtle text-caption font-semibold text-text-secondary">
                    {i + 1}
                  </span>
                  <ChannelIcon channel={s.channel} />
                  <span className="min-w-0 flex-1 truncate text-body-sm text-text-primary">{s.title}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-caption text-text-secondary">Day</span>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={s.day}
                      onChange={(e) => set(i, Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
                      aria-label={`Day for step ${i + 1}`}
                      className="w-16 rounded-lg border border-border-default bg-bg-surface px-2 py-1 text-center text-body-sm tabular-nums text-text-primary focus:border-accent-primary focus:outline-none"
                    />
                  </span>
                  <span className="w-24 shrink-0 text-right text-caption tabular-nums text-text-secondary">
                    {formatDay(startMs + Math.max(0, s.day - (steps[0]?.day ?? 1)) * 86_400_000)}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-2.5 text-caption font-semibold text-text-primary">Start the first step</p>
            <QuickTimes value={startAt ?? toInputValue(startMs)} onChange={(v) => onStartAt(v)} />
          </>
        )}

        {/* ⚠️ THE SCHEDULER'S RULES, ON THE SCHEDULER ONLY. Neither applies to one
            follow-up on a list, and printing them there would be two sentences of
            machinery somebody has to work out does not concern them. */}
        <div hidden={kind === 'single'} className="mt-3 rounded-xl bg-bg-subtle px-3.5 py-2.5 text-caption leading-relaxed text-text-secondary">
          <p className="font-semibold text-text-primary">Two rules the scheduler keeps on its own</p>
          <p className="mt-0.5">
            Nothing goes out during the project&rsquo;s quiet hours — a step due at night is pushed to the morning, never
            dropped. And a lead is chased at most once a day, so two steps on the same day become two days.
          </p>
        </div>
      </section>

      <section>
        <h3 className="text-body font-semibold text-text-primary">When should it stop?</h3>
        <p className="mt-0.5 text-caption text-text-secondary">
          {kind === 'single'
            ? 'A single follow-up has no conditions — it is one thing on your list.'
            : 'The first is yours to choose. The rest are always on.'}
        </p>
        <ul className="mt-3 space-y-2">
          {conditions.map((c) => (
            <li
              key={c.label}
              className={cn(
                'flex items-start gap-2.5 rounded-xl border p-3',
                c.optional ? 'border-border-default' : 'border-border-subtle bg-bg-subtle/40',
              )}
            >
              {c.optional ? (
                <input
                  type="checkbox"
                  checked={stopOnReply}
                  disabled={kind === 'single'}
                  onChange={(e) => onStopOnReply(e.target.checked)}
                  aria-label={c.label}
                  className="mt-0.5 size-4 accent-[var(--accent-primary)]"
                />
              ) : (
                <Check className="mt-0.5 size-4 shrink-0 text-feedback-success" strokeWidth={3} aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p className="text-body-sm font-medium text-text-primary">{c.label}</p>
                <p className="text-caption leading-relaxed text-text-secondary">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ── 4 · Review ──────────────────────────────────────────────────────────── */

function Review({
  kind,
  purpose,
  steps,
  facts,
  tokens,
  stopOnReply,
  keepNextAction,
  startMs,
}: {
  kind: 'single' | 'schedule';
  purpose: FollowUpPurpose;
  steps: readonly PlanStep[];
  facts: ReturnType<typeof leadFactsFrom>;
  tokens: Record<string, string>;
  stopOnReply: boolean;
  keepNextAction: boolean;
  startMs: number;
}) {
  const first = steps[0]?.day ?? 1;
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border-subtle bg-bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-body font-semibold text-text-primary">
            {purposeLabel(purpose)} · {kind === 'single' ? 'one follow-up' : `${steps.length} steps`}
          </h3>
          <p className="text-caption text-text-secondary">
            Starts {formatWhen(new Date(startMs).toISOString())}
          </p>
        </div>
        <ol className="mt-3 space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-bg-subtle">
                <ChannelIcon channel={s.channel} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-semibold text-text-primary">
                  {s.title}
                  <span className="ml-2 font-normal text-text-secondary">{channelVerb(s.channel)}</span>
                </p>
                {s.body.trim() && (
                  <p className="mt-0.5 whitespace-pre-wrap text-caption leading-relaxed text-text-secondary">
                    {fillTokens(s.body, tokens)}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-caption font-medium text-text-primary">
                  {formatDay(startMs + Math.max(0, s.day - first) * 86_400_000)}
                </p>
                <p className="text-caption text-text-secondary">{MODE_LABEL[s.mode]}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ⚠️ WHO SENDS IT, SAID BEFORE THE BUTTON. Nothing in the product sends a
          step by machine yet; a review screen that implied otherwise would be a
          promise kept by nobody, on somebody's client. */}
      <section className="rounded-xl border border-border-subtle bg-bg-subtle/40 p-4">
        <h3 className="text-body-sm font-semibold text-text-primary">What happens next</h3>
        <ul className="mt-1.5 space-y-1 text-caption leading-relaxed text-text-secondary">
          <li>
            · When a step falls due it appears here and becomes the lead&rsquo;s next action, which is what your
            Todos list reads. <span className="font-medium text-text-primary">You press send</span> — nothing is
            messaged automatically.
          </li>
          {kind === 'schedule' && (
            <li>
              · {stopOnReply
                ? 'The plan pauses the moment they reply, so you read it before the next step.'
                : 'The plan does not pause on a reply — it runs to the end unless you stop it.'}
            </li>
          )}
          <li>
            · {keepNextAction
              ? 'The lead’s Next action is left as it is.'
              : `The desk row will show “${steps[0]?.title ?? 'this follow-up'}” when it is the soonest thing owed.`}
          </li>
          {facts.quotation && (purpose === 'quotation' || purpose === 'approved_offer') && (
            <li>· It is tied to {facts.quotation.number} and stops by itself if that quotation expires or is replaced.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

/* ── Button ──────────────────────────────────────────────────────────────── */

function Button({
  tone = 'outline',
  icon: Icon,
  iconAfter = false,
  disabled,
  onClick,
  children,
}: {
  tone?: 'outline' | 'primary';
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  iconAfter?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-caption font-semibold transition-colors disabled:opacity-50',
        tone === 'primary'
          ? 'bg-accent-primary text-white hover:opacity-90'
          : 'border border-border-default bg-bg-surface text-text-primary hover:bg-bg-subtle',
      )}
    >
      {Icon && !iconAfter && <Icon className="size-4" aria-hidden="true" />}
      {children}
      {Icon && iconAfter && <Icon className="size-4" aria-hidden="true" />}
    </button>
  );
}

/** The steps a created plan draws with, before the server render catches up. */
export function optimisticSteps(steps: readonly PlanStep[], purpose: string): CrmSequenceStep[] {
  let previous = 1;
  return steps.map((s, i) => {
    const delay = Math.max(0, Math.round(s.day - (i === 0 ? 1 : previous)));
    previous = s.day;
    return {
      stepNo: i + 1,
      channel: s.channel,
      delayDays: delay,
      purpose,
      body: s.body.trim() || null,
      title: s.title,
      mode: s.mode,
    };
  });
}
