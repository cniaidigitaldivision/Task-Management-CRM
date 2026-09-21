'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  Clock3,
  Info,
  CreditCard,
  FileText,
  Flag,
  Mail,
  MapPin,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Square,
  Target,
  Trash2,
  User,
  Users,
  X,
  Zap,
} from 'lucide-react';

import {
  createFollowUpPlanAction,
  leadDocumentsAction,
  polishMessageAction,
  whatsAppTemplatesAction,
  type TemplateList,
} from '@/app/actions/crm-followups';
import { EmailPreview, WhatsAppPreview } from '@/components/crm/followup-preview';
import {
  DEFAULT_HOURS,
  eventMoment,
  SchedulePicker,
  ScheduleValueLabel,
  type EventAnchor,
  type ScheduleValue,
} from '@/components/crm/schedule-picker';
import { MAIL_BLUE, WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
/* ⚠️ THE SAME CALENDAR THE APPOINTMENT TAB USES — one month grid, one idea of
   which days are past. See `calendar-bits.tsx`. */
import { Field, MonthGrid } from '@/components/crm/calendar-bits';
import { formatDay, formatWhen, karachiAt, karachiParts } from '@/components/crm/when';
import { useToast } from '@/components/ui/toast';
import type { CrmLeadRecord, CrmLeadRelated, CrmSequenceStep } from '@/lib/db/queries/crm-leads';
import {
  DELIVERY_CHOICES,
  fillTokens,
  leadFactsFrom,
  MAX_STEPS,
  planProblem,
  planTokens,
  purposeAvailability,
  purposeLabel,
  PURPOSE_CARDS,
  suggestedSubject,
  stopConditions,
  suggestedPlan,
  type FollowUpPurpose,
  type PlanChannel,
  type PlanMode,
  type PlanStep,
} from '@/lib/domain/crm-followup-plans';
import { fillable, fillTemplates, templateForPurpose } from '@/lib/domain/crm-template-for-purpose';
import { cn } from '@/lib/utils';

/* ============================================================================
 * NEW FOLLOW-UP — proceed, purpose, message, schedule, review
 * ----------------------------------------------------------------------------
 * Built to the owner's four designs of 2026-09-17, and to the sentence behind
 * them: *"the follow-up will be sent at the respective time automatically. If I
 * have to log in and send it… what is the purpose of the automation then?"*
 *
 * So **Auto-send is the default**, and it is real: 187–190 built the queue, the
 * business hours and the sender, and `/api/cron/crm-followups` delivers on
 * WhatsApp and by email.
 *
 * ⚠️ WHAT IT STILL WILL NOT PRETEND. Outside WhatsApp's 24-hour window only a
 * template Meta has approved may go out. A step that would be free text out
 * there is handed back to a person — said on screen, before anybody chooses it,
 * rather than discovered as a silent failure days later.
 *
 * ⚠️ AND NOTHING HERE TOUCHES THE NETWORK UNTIL IT IS SAVED. Every preview,
 * every suggestion and every date is client state. The documents list and the AI
 * rewrite are the two exceptions, both on demand, both after a click.
 * ========================================================================= */

export interface PlanCreated {
  readonly kind: 'single' | 'schedule';
  readonly purpose: string;
  readonly name: string;
  readonly steps: readonly PlanStep[];
  readonly firstAt: string;
  readonly started: boolean;
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
  /* 229 · the types for the rest of the approved templates. */
  proposal: Paperclip,
  meeting_feedback: MessageSquareText,
  negotiation: Target,
  agreement: Pencil,
  welcome: Sparkles,
  custom: MoreHorizontal,
};

const DELIVERY_ICON: Record<PlanMode, React.ComponentType<{ className?: string }>> = {
  remind_me: Clock3,
  review_first: FileText,
  auto_send: Send,
};

const STAGES = ['Purpose', 'Channel & message', 'Schedule & conditions', 'Review'] as const;

const MODE_LABEL: Record<PlanMode, string> = {
  remind_me: 'Reminder for me',
  review_first: 'Draft for me to send',
  auto_send: 'Sent automatically',
};

/* ⚠️ "WhatsApp call", NOT "Call". Owner, 2026-09-17: *"a salesperson uses their
   phone, so the number to call will not be a proper way… add a WhatsApp call
   option, not a normal call."* Nothing places it — WhatsApp's business calling
   is not on this account — so it is a reminder for the person, and the screen
   says exactly that. */
const CHANNEL_CHOICES: ReadonlyArray<{ key: PlanChannel; label: string }> = [
  { key: 'email', label: 'Email' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'call', label: 'WhatsApp call' },
  { key: 'task', label: 'Task' },
];

const POLISH: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'improve', label: 'Improve wording' },
  { key: 'shorten', label: 'Shorten' },
  { key: 'warmer', label: 'Warmer tone' },
  { key: 'formal', label: 'More formal' },
];

function ChannelIcon({ channel, className = 'size-4' }: { channel: string; className?: string }) {
  if (channel === 'whatsapp') return <span style={{ color: WA_GREEN }}><WhatsAppMark className={className} /></span>;
  if (channel === 'email') return <Mail className={className} style={{ color: MAIL_BLUE }} aria-hidden="true" />;
  if (channel === 'call') return <Phone className={className} aria-hidden="true" />;
  return <Bell className={className} aria-hidden="true" />;
}

function channelVerb(channel: string): string {
  if (channel === 'whatsapp') return 'Send via WhatsApp';
  if (channel === 'email') return 'Send via Email';
  if (channel === 'call') return 'WhatsApp call — you make it';
  return 'A task for you';
}

/* ── The dialog ──────────────────────────────────────────────────────────── */

export function FollowUpWizard({
  lead,
  related,
  viewerName,
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
  /* ⚠️ THE PLAN IS SENT BY THE LEAD'S OWNER, NOT BY WHOEVER IS WRITING IT. A
     manager drafting on Sahad's lead must see "I am Sahad" in the preview,
     because that is the name the client will read — `app.crm_followup_tokens`
     fills it from the follow-up's assignee at the moment of sending. */
  const facts = React.useMemo(
    () => leadFactsFrom(lead, related, lead.ownerName ?? viewerName, nowMs),
    [lead, related, viewerName, nowMs],
  );
  const tokens = React.useMemo(
    () => planTokens(facts, facts.visit ? formatWhen(facts.visit.at) : null),
    [facts],
  );

  /* ⚠️ THE PURPOSE THIS LEAD IS ACTUALLY ABOUT, and never a card that opens on a
     reason it has to refuse. A lead with a live quotation is a quotation chase;
     one with a visit booked is a reminder; everything else is a nudge. */
  const firstUsable = React.useMemo<FollowUpPurpose>(() => {
    const order: FollowUpPurpose[] = facts.approvedQuotation
      ? ['approved_offer', 'quotation', 'no_response']
      : facts.quotation
        ? ['quotation', 'no_response']
        : facts.visit
          ? ['appointment_reminder', 'no_response']
          : facts.visitedAt
            ? ['site_visit_checkin', 'no_response']
            : ['no_response'];
    return order.find((k) => purposeAvailability(k, facts).ok) ?? 'no_response';
  }, [facts]);

  const [stage, setStage] = React.useState(0);
  const [delivery, setDelivery] = React.useState<PlanMode>('auto_send');
  const [purpose, setPurpose] = React.useState<FollowUpPurpose>(firstUsable);
  const [kind, setKind] = React.useState<'single' | 'schedule'>('schedule');
  const [steps, setSteps] = React.useState<readonly PlanStep[]>(() => suggestedPlan(firstUsable, 'auto_send'));
  const [active, setActive] = React.useState(0);
  const [touched, setTouched] = React.useState(false);
  const [schedule, setSchedule] = React.useState<ScheduleValue>(() => ({
    mode: 'at',
    at: tomorrowAt10(nowMs),
    hours: { ...DEFAULT_HOURS, days: [...DEFAULT_HOURS.days] },
    event: null,
  }));
  const [conditions, setConditions] = React.useState({ reply: true, visit: true, quotation: true });
  const [keepNextAction, setKeepNextAction] = React.useState(false);
  const [planName, setPlanName] = React.useState('');
  const [advanced, setAdvanced] = React.useState(false);
  const [busy, setBusy] = React.useState<null | 'draft' | 'start'>(null);

  /* ── The approved templates, owned HERE and not by one step ─────────────
     ⚠️ THIS USED TO LIVE IN THE "CHANNEL & MESSAGE" STEP, AND THAT IS WHY IT
     FAILED. Owner, 2026-09-21: a follow-up saved with no template although
     auto-selection existed. The list comes from Meta and took seconds on the dev
     server; clicking Next before it arrived unmounted the only code that could
     apply it, so it landed nowhere and nothing was ever chosen. Owned by the
     wizard, it survives every change of stage, and Save applies it once more. */
  const [templates, setTemplates] = React.useState<TemplateList | null>(null);
  /* Steps whose template the person cleared ON PURPOSE — never refilled. State,
     not a ref, because it is read during render. */
  const [cleared, setCleared] = React.useState<ReadonlySet<number>>(() => new Set());
  const wantsTemplate = (s: PlanStep) => s.channel === 'whatsapp' && s.mode === 'auto_send';
  const needsTemplates = steps.some(wantsTemplate);

  React.useEffect(() => {
    if (!needsTemplates || templates !== null) return;
    let alive = true;
    void whatsAppTemplatesAction(lead.id).then((list) => {
      if (alive) setTemplates(list);
    });
    return () => {
      alive = false;
    };
  }, [needsTemplates, templates, lead.id]);

  /* ⚠️ APPLIED DURING RENDER, NOT IN AN EFFECT. `fillTemplates` returns the SAME
     array when there is nothing to fill, so this settles in one extra render —
     and it runs whichever stage is showing. It does not mark the plan touched:
     a template the wizard chose is not the person editing the plan. */
  const filled = templates?.ok ? fillTemplates(steps, purpose, templates.templates, cleared) : steps;
  if (filled !== steps) setSteps(filled);

  const shown = kind === 'single' ? steps.slice(0, 1) : steps;
  const problem = planProblem(shown);
  const anchors = React.useMemo<readonly EventAnchor[]>(() => {
    const live = related.quotations.find((q) => !['superseded', 'rejected', 'expired'].includes(q.status)) ?? null;
    return [
      { key: 'quotation_sent', label: 'The quotation was sent', at: live?.createdAt ?? null },
      { key: 'visit_booked', label: 'The visit is booked for', at: facts.visit?.at ?? null },
      { key: 'lead_created', label: 'The enquiry arrived', at: lead.submittedAt },
    ];
  }, [related.quotations, facts.visit, lead.submittedAt]);

  const startMs =
    schedule.mode === 'now'
      ? nowMs
      : schedule.mode === 'event'
        ? (eventMoment(schedule.event, anchors) ?? nowMs)
        : (schedule.at ?? nowMs);

  const setStep = (i: number, patch: Partial<PlanStep>) => {
    setTouched(true);
    setSteps(steps.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  };

  const choosePurpose = (next: FollowUpPurpose) => {
    setPurpose(next);
    if (!touched) {
      setSteps(suggestedPlan(next, delivery));
      setActive(0);
    }
  };

  const chooseDelivery = (next: PlanMode) => {
    setDelivery(next);
    /* ⚠️ A CALL IS NEVER "sent". The plan's answer applies to message steps and
       stops there — otherwise Auto-send would claim the machine rings people. */
    setSteps(steps.map((s) => (s.channel === 'whatsapp' || s.channel === 'email' ? { ...s, mode: next } : s)));
  };

  const save = async (start: boolean) => {
    if (busy || problem) return;
    setBusy(start ? 'start' : 'draft');
    try {
      /* ⚠️ THE LAST CHANCE, AND IT IS NOT OPTIONAL. If Meta's list has still not
         arrived when Save is pressed, wait for it here and fill in what the
         purpose implies — otherwise a fast click saves an auto-send step with no
         template, which is exactly the follow-up the owner found sitting unsent. */
      let list = templates;
      if (!list && shown.some(wantsTemplate)) {
        list = await whatsAppTemplatesAction(lead.id);
        setTemplates(list);
      }
      const final = list?.ok ? fillTemplates(shown, purpose, list.templates, cleared) : shown;

      const result = await createFollowUpPlanAction({
        leadId: lead.id,
        kind,
        purpose,
        name: planName.trim() || purposeLabel(purpose),
        stopOnReply: conditions.reply,
        stopOnVisit: conditions.visit,
        stopOnQuotationDead: conditions.quotation,
        keepNextAction,
        hours: schedule.hours,
        firstAt: schedule.mode === 'now' ? null : new Date(startMs).toISOString(),
        start,
        steps: final.map((s) => ({
          day: s.day,
          /* 207 · the hour this step asked for, or null to inherit. */
          at: s.at,
          channel: s.channel,
          title: s.title,
          body: s.body,
          subject: s.subject,
          mode: s.mode,
          onlyIfNoReply: s.onlyIfNoReply,
          template: s.template,
        })),
      });
      if (!result.ok) {
        toast({ tone: 'error', text: result.error });
        return;
      }
      onCreated({
        kind,
        purpose,
        name: planName.trim() || purposeLabel(purpose),
        steps: final,
        firstAt: result.plan?.nextStepAt ?? new Date(startMs).toISOString(),
        started: start,
        sequenceId: result.plan?.sequenceId ?? null,
        leadSequenceId: result.plan?.leadSequenceId ?? null,
      });
      /* ⚠️ A CHANGED ANSWER IS TOLD, AND IT LINGERS. "Follow-up planned" over a
         step that will never send itself is how the owner came to ask how a
         scheduled message could be overdue. */
      if (result.note) toast({ tone: 'warn', text: result.note });
      else {
        toast({
          tone: 'ok',
          text: kind === 'single' ? 'Follow-up planned.' : start ? 'Sequence started.' : 'Draft saved.',
        });
      }
      onClose();
    } catch {
      toast({ tone: 'error', text: 'That did not save — the connection dropped.' });
    } finally {
      setBusy(null);
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

  const footerLine =
    problem ??
    (kind === 'single'
      ? `One follow-up · ${formatWhen(new Date(startMs).toISOString())}`
      : `${shown.length} step${shown.length === 1 ? '' : 's'} · starts ${ScheduleValueLabel(schedule, nowMs, anchors)}`);

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
        className="flex max-h-[94vh] w-full max-w-[60rem] flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface shadow-2xl"
      >
        <header className="shrink-0 border-b border-border-subtle px-5 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-h3 font-semibold text-text-primary">
                {stage === 3 ? 'Review follow-up sequence' : stage === 1 ? 'Compose follow-up' : 'New follow-up'}
              </h2>
              <p className="mt-0.5 text-caption text-text-secondary">
                {stage === 3
                  ? 'Set up and review the follow-up for this lead.'
                  : stage === 1
                    ? `Send a personalised message to ${lead.fullName ?? 'this lead'}.`
                    : 'Create a follow-up for this lead. Choose the purpose and how it goes out.'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-full border border-border-subtle px-2.5 py-1 text-caption text-text-secondary sm:inline-flex">
                <User className="size-3.5" aria-hidden="true" />
                {lead.ownerName ? `Assigned to ${lead.ownerName}` : 'Unassigned'}
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid size-8 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <Stepper stage={stage} onStage={setStage} />
          <LeadStrip lead={lead} facts={facts} />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {stage === 0 && (
            <Purpose
              facts={facts}
              purpose={purpose}
              delivery={delivery}
              steps={shown}
              kind={kind}
              startMs={startMs}
              conditions={conditions}
              onPurpose={choosePurpose}
              onDelivery={chooseDelivery}
              advanced={advanced}
              onAdvanced={setAdvanced}
              keepNextAction={keepNextAction}
              onKeepNextAction={setKeepNextAction}
              planName={planName}
              onPlanName={setPlanName}
              kindSet={setKind}
            />
          )}
          {stage === 1 && (
            <Compose
              lead={lead}
              facts={facts}
              tokens={tokens}
              purpose={purpose}
              steps={shown}
              active={Math.min(active, shown.length - 1)}
              onActive={setActive}
              onStep={setStep}
              templates={templates}
              onClearTemplate={(i) => {
                setCleared((c) => new Set(c).add(i));
                setStep(i, { template: null });
              }}
              onAdd={() => {
                const last = steps[steps.length - 1];
                setTouched(true);
                setSteps([
                  ...steps,
                  {
                    day: (last?.day ?? 1) + 3,
                    /* Inherits the running hour until somebody sets one (207). */
                    at: null,
                    channel: last?.channel ?? 'whatsapp',
                    title: `Step ${steps.length + 1}`,
                    body: '',
                    subject: '',
                    mode: delivery,
                    onlyIfNoReply: false,
                    template: null,
                  },
                ]);
                setActive(steps.length);
              }}
              onRemove={(i) => {
                setTouched(true);
                setSteps(steps.filter((_, n) => n !== i));
                setActive(0);
              }}
              single={kind === 'single'}
              startMs={startMs}
            />
          )}
          {stage === 2 && (
            <Schedule
              kind={kind}
              steps={shown}
              onStep={setStep}
              purpose={purpose}
              schedule={schedule}
              onSchedule={setSchedule}
              nowMs={nowMs}
              anchors={anchors}
              conditions={conditions}
              onConditions={setConditions}
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
              lead={lead}
              delivery={delivery}
              conditions={conditions}
              startMs={startMs}
              active={Math.min(active, shown.length - 1)}
              onActive={setActive}
              onEdit={(i) => {
                setActive(i);
                setStage(1);
              }}
            />
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
          <p className="flex min-w-0 items-center gap-2 text-caption text-text-secondary">
            <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
            <span className={cn('min-w-0 truncate', problem && 'text-feedback-error')}>{footerLine}</span>
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button onClick={stage === 0 ? onClose : () => setStage((s) => s - 1)}>
              {stage === 0 ? 'Cancel' : 'Back'}
            </Button>
            {stage < 3 ? (
              <Button tone="primary" icon={ArrowRight} iconAfter onClick={() => setStage((s) => s + 1)}>
                Continue
              </Button>
            ) : (
              <>
                {kind === 'schedule' && (
                  <Button icon={FileText} disabled={busy !== null || problem !== null} onClick={() => void save(false)}>
                    {busy === 'draft' ? 'Saving…' : 'Save draft'}
                  </Button>
                )}
                <Button
                  tone="primary"
                  icon={kind === 'single' ? Check : Send}
                  disabled={busy !== null || problem !== null}
                  onClick={() => void save(true)}
                >
                  {busy === 'start' ? 'Saving…' : kind === 'single' ? 'Plan follow-up' : 'Start sequence'}
                </Button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}

/* ── Stepper and lead strip ──────────────────────────────────────────────── */

function Stepper({ stage, onStage }: { stage: number; onStage: (n: number) => void }) {
  return (
    <ol className="mt-3 flex items-center gap-2">
      {STAGES.map((label, i) => (
        <li key={label} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
          <button type="button" onClick={() => onStage(i)} aria-current={i === stage ? 'step' : undefined} className="flex min-w-0 items-center gap-2 text-left">
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold transition-colors',
                i === stage ? 'bg-accent-primary text-white'
                  : i < stage ? 'bg-feedback-success text-white'
                    : 'border border-border-default bg-bg-surface text-text-secondary',
              )}
            >
              {i < stage ? <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> : i + 1}
            </span>
            <span className={cn('truncate text-caption', i === stage ? 'font-semibold text-text-primary' : 'text-text-secondary')}>
              {label}
            </span>
          </button>
          {i < STAGES.length - 1 && <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border-subtle" />}
        </li>
      ))}
    </ol>
  );
}

function LeadStrip({ lead, facts }: { lead: CrmLeadRecord; facts: ReturnType<typeof leadFactsFrom> }) {
  const initials = (lead.fullName ?? '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-bg-subtle px-3.5 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-primary/15 text-caption font-semibold text-accent-primary">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-body-sm font-semibold text-text-primary">{lead.fullName ?? 'Unnamed lead'}</p>
          <p className="truncate text-caption text-text-secondary">
            {lead.projectName}{lead.city ? ` · ${lead.city}` : ''}
          </p>
        </div>
      </div>
      {lead.propertyLabel && <Fact label="Property" value={lead.propertyLabel} />}
      {facts.quotation && <Fact label="Quotation" value={facts.quotation.number} />}
      {facts.quotation && <Fact label="Value" value={`PKR ${facts.quotation.amount.toLocaleString('en-PK')}`} />}
      <Fact label="Owner" value={lead.ownerName ?? 'Unassigned'} />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-caption text-text-secondary">{label}</p>
      <p className="truncate text-body-sm font-medium text-text-primary">{value}</p>
    </div>
  );
}

/* ── 1 · How, and what for ───────────────────────────────────────────────── */

function Purpose({
  facts,
  purpose,
  delivery,
  steps,
  kind,
  startMs,
  conditions,
  onPurpose,
  onDelivery,
  advanced,
  onAdvanced,
  keepNextAction,
  onKeepNextAction,
  planName,
  onPlanName,
  kindSet,
}: {
  facts: ReturnType<typeof leadFactsFrom>;
  purpose: FollowUpPurpose;
  delivery: PlanMode;
  steps: readonly PlanStep[];
  kind: 'single' | 'schedule';
  startMs: number;
  conditions: { reply: boolean; visit: boolean; quotation: boolean };
  onPurpose: (p: FollowUpPurpose) => void;
  onDelivery: (m: PlanMode) => void;
  advanced: boolean;
  onAdvanced: (v: boolean) => void;
  keepNextAction: boolean;
  onKeepNextAction: (v: boolean) => void;
  planName: string;
  onPlanName: (v: string) => void;
  kindSet: (k: 'single' | 'schedule') => void;
}) {
  const card = PURPOSE_CARDS.find((c) => c.key === purpose)!;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-4">
        {/* ── ⚠️ THE FIRST QUESTION IS WHAT KIND OF THING THIS IS ──────────────
            Owner, 2026-09-18: *"I should first choose the settings that you have
            shown in Advanced Settings. That should not be in Advanced Settings…
            'Which follow-up do I want, one follow-up or a plan?' I should be able
            to name this plan."*

            They are right, and it was a real mistake: "one action or a sequence"
            decides what every other control on this screen MEANS — how many steps
            there are, whether a name is needed, what the schedule screen shows.
            A question that changes the shape of the form cannot live behind a
            collapsed panel called optional. */}
        <section>
          <h3 className="text-body font-semibold text-text-primary">1. One follow-up, or a plan?</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Pick chosen={kind === 'single'} onClick={() => kindSet('single')}>
              <Send className="size-5 text-text-secondary" />
              <span className="mt-1.5 block text-body-sm font-semibold text-text-primary">A single follow-up</span>
              <span className="mt-0.5 block text-caption leading-snug text-text-secondary">
                One action, at one time you choose.
              </span>
            </Pick>
            <Pick chosen={kind === 'schedule'} onClick={() => kindSet('schedule')}>
              <CalendarDays className="size-5 text-text-secondary" />
              <span className="mt-1.5 block text-body-sm font-semibold text-text-primary">A sequence</span>
              <span className="mt-0.5 block text-caption leading-snug text-text-secondary">
                Several steps, each with its own day and time.
              </span>
            </Pick>
          </div>

          {/* ⚠️ THE NAME ONLY EXISTS FOR A PLAN. A single follow-up has a title of
              its own on the next screen; asking for both would be asking twice. */}
          {kind === 'schedule' && (
            <label className="mt-2.5 block">
              <span className="block text-caption font-semibold text-text-primary">Name this plan</span>
              <input
                value={planName}
                onChange={(e) => onPlanName(e.target.value)}
                maxLength={80}
                placeholder={purposeLabel(purpose)}
                className="mt-1 w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
              />
              <span className="mt-1 block text-caption text-text-secondary">
                What the sequence card calls it on this lead. Your team sees it; the client never does.
              </span>
            </label>
          )}
        </section>

        <section>
          <h3 className="text-body font-semibold text-text-primary">2. How would you like to proceed?</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {DELIVERY_CHOICES.map((d) => {
              const Icon = DELIVERY_ICON[d.key];
              return (
                <Pick key={d.key} chosen={delivery === d.key} onClick={() => onDelivery(d.key)}>
                  <Icon className="size-5 text-text-secondary" />
                  <span className="mt-1.5 block text-body-sm font-semibold text-text-primary">{d.label}</span>
                  <span className="mt-0.5 block text-caption leading-snug text-text-secondary">{d.detail}</span>
                </Pick>
              );
            })}
          </div>
          {delivery === 'auto_send' && (
            <p className="mt-2 flex items-start gap-2 rounded-lg bg-bg-subtle px-3 py-2 text-caption leading-relaxed text-text-secondary">
              <Zap className="mt-0.5 size-3.5 shrink-0 text-accent-primary" aria-hidden="true" />
              <span>
                Sent by the system at the time you choose. Within 24 hours of the client&rsquo;s last message it goes
                as a normal WhatsApp message; after that, as the approved template for its purpose. Email has no such
                limit.
              </span>
            </p>
          )}
        </section>

        <section>
          <h3 className="text-body font-semibold text-text-primary">3. What is the purpose of this follow-up?</h3>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PURPOSE_CARDS.map((c) => {
              const can = purposeAvailability(c.key, facts);
              const Icon = PURPOSE_ICON[c.key];
              return (
                <Pick key={c.key} chosen={c.key === purpose} disabled={!can.ok} onClick={() => onPurpose(c.key)} title={can.reason ?? undefined}>
                  <Icon className="size-5 text-text-secondary" />
                  <span className="mt-1.5 block text-body-sm font-semibold leading-tight text-text-primary">{c.label}</span>
                  <span className="mt-0.5 block text-caption leading-snug text-text-secondary">
                    {can.ok ? c.blurb : can.reason}
                  </span>
                  {c.badge && can.ok && (
                    <span className="mt-1.5 inline-block rounded-md bg-feedback-warning/15 px-1.5 py-0.5 text-caption font-medium text-feedback-warning">
                      {c.badge}
                    </span>
                  )}
                </Pick>
              );
            })}
          </div>
        </section>

        {/* ⚠️ WHAT IS LEFT HERE IS GENUINELY ADVANCED: one switch, whose default
            is right for almost everybody, and which changes nothing about the
            shape of the plan. That is the test for this panel — if a control
            decides what the rest of the form means, it is not advanced, it is the
            first question. */}
        <section className="rounded-xl border border-border-subtle">
          <button
            type="button"
            onClick={() => onAdvanced(!advanced)}
            aria-expanded={advanced}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
          >
            <Settings2 className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-body-sm font-medium text-text-primary">
              Advanced settings <span className="font-normal text-text-secondary">(optional)</span>
            </span>
            <ChevronDown className={cn('size-4 shrink-0 text-text-secondary transition-transform', advanced && 'rotate-180')} aria-hidden="true" />
          </button>
          {advanced && (
            <div className="space-y-3 border-t border-border-subtle px-3.5 py-3">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={keepNextAction}
                  onChange={(e) => onKeepNextAction(e.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--pick-mark)]"
                />
                <span className="min-w-0">
                  <span className="block text-body-sm text-text-primary">Leave the lead&rsquo;s Next action unchanged</span>
                  <span className="block text-caption text-text-secondary">
                    By default the desk row and your Todos start showing this follow-up when it is the soonest thing owed.
                  </span>
                </span>
              </label>
            </div>
          )}
        </section>
      </div>

      {/* ── The suggestion ───────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border-subtle bg-bg-subtle/40 p-3.5">
        <h3 className="text-body font-semibold text-text-primary">
          {kind === 'single' ? 'Suggested follow-up' : 'Suggested sequence'}
        </h3>
        <p className="mt-0.5 text-caption text-text-secondary">
          {delivery === 'auto_send'
            ? 'These messages are sent for you. You can change every part on the next screen.'
            : 'Set as reminders for you. You can change every part on the next screen.'}
        </p>
        <ol className="mt-3 space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex flex-col items-center">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-bg-surface shadow-sm">
                  <ChannelIcon channel={s.channel} />
                </span>
                {i < steps.length - 1 && <span aria-hidden="true" className="my-1 w-px flex-1 bg-border-subtle" />}
              </span>
              <span className="min-w-0 flex-1 pb-1">
                <span className="block text-body-sm font-semibold text-text-primary">
                  Day {s.day} · {s.title}
                </span>
                <span className="block text-caption text-text-secondary">
                  {channelVerb(s.channel)} · {formatDay(startMs + Math.max(0, s.day - (steps[0]?.day ?? 1)) * 86_400_000)}
                </span>
                <span className="block text-caption text-text-secondary">{MODE_LABEL[s.mode]}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-3 space-y-2.5 border-t border-border-subtle pt-3">
          <IconLine icon={Target} title="Goal" detail={card.goal(facts)} />
          <IconLine
            icon={Square}
            title="Stop rule"
            detail={
              conditions.reply
                ? 'Any reply pauses this sequence and tells you immediately.'
                : 'It runs to the end unless the lead closes or they ask you to stop.'
            }
          />
        </div>
      </section>
    </div>
  );
}

function IconLine({
  icon: Icon,
  title,
  detail,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-accent-primary" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-body-sm font-semibold text-text-primary">{title}</p>
        <p className="text-caption leading-relaxed text-text-secondary">{detail}</p>
      </div>
    </div>
  );
}

/** A card that can be chosen, in the colours sampled from the owner's design. */
function Pick({
  chosen,
  disabled = false,
  onClick,
  title,
  compact = false,
  children,
}: {
  chosen: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={chosen}
      title={title}
      className={cn(
        'relative rounded-xl border text-left transition-colors',
        compact ? 'p-2.5' : 'p-3',
        chosen
          ? 'border-[var(--pick-border)] bg-[var(--pick-bg)]'
          : disabled
            ? 'cursor-not-allowed border-border-subtle bg-bg-subtle/50 opacity-60'
            : 'border-border-subtle bg-bg-surface hover:bg-bg-subtle',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute right-2 top-2 grid size-4 place-items-center rounded-full border',
          chosen ? 'border-[var(--pick-mark)] bg-[var(--pick-mark)] text-white' : 'border-border-default',
        )}
      >
        {chosen && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="block pr-5">{children}</span>
    </button>
  );
}

/* ── 2 · Compose ─────────────────────────────────────────────────────────── */

function Compose({
  lead,
  facts,
  tokens,
  purpose,
  steps,
  active,
  onActive,
  onStep,
  onAdd,
  onRemove,
  single,
  startMs,
  templates,
  onClearTemplate,
}: {
  lead: CrmLeadRecord;
  facts: ReturnType<typeof leadFactsFrom>;
  tokens: Record<string, string>;
  purpose: FollowUpPurpose;
  steps: readonly PlanStep[];
  active: number;
  onActive: (i: number) => void;
  onStep: (i: number, patch: Partial<PlanStep>) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  single: boolean;
  startMs: number;
  /** Owned by the wizard, so it survives this step being closed (2026-09-21). */
  templates: TemplateList | null;
  /** The person chose "No template" on purpose — the wizard must not refill it. */
  onClearTemplate: (i: number) => void;
}) {
  const toast = useToast();
  const step = steps[active] ?? steps[0];
  const writes = step.channel === 'whatsapp' || step.channel === 'email';
  const [polishing, setPolishing] = React.useState(false);
  const [docs, setDocs] = React.useState<ReadonlyArray<{ id: string; title: string; mime: string; sizeBytes: number }> | null>(null);
  /* ⚠️ ON DEMAND, ONCE. The dialog opens without touching the network; the list
     is fetched the first time an email step is composed and kept after that. */
  React.useEffect(() => {
    if (step.channel !== 'email' || docs !== null) return;
    let alive = true;
    void leadDocumentsAction(lead.id).then((rows) => {
      if (alive) setDocs(rows);
    });
    return () => {
      alive = false;
    };
  }, [step.channel, docs, lead.id]);

  const chosenBecause = React.useMemo(() => {
    if (!templates?.ok || !step.template) return null;
    const pick = templateForPurpose(purpose, templates.templates);
    return pick && pick.name === step.template.name ? pick.because : null;
  }, [templates, step.template, purpose]);

  const polish = async (mode: string) => {
    if (polishing || !step.body.trim()) return;
    setPolishing(true);
    try {
      const result = await polishMessageAction({ text: step.body, mode, channel: step.channel });
      if (result.ok) onStep(active, { body: result.text });
      else toast({ tone: 'error', text: result.error });
    } catch {
      toast({ tone: 'error', text: 'The rewrite did not come back.' });
    } finally {
      setPolishing(false);
    }
  };

  const filled = fillTokens(step.body, tokens);
  const filledSubject = fillTokens(step.subject || step.title, tokens);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        {/* ── Which step ─────────────────────────────────────────────── */}
        {!single && (
          <div className="flex flex-wrap items-center gap-1.5">
            {steps.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onActive(i)}
                aria-pressed={i === active}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption font-medium transition-colors',
                  i === active
                    ? 'border-[var(--pick-border)] bg-[var(--pick-bg)] text-text-primary'
                    : 'border-border-default text-text-secondary hover:text-text-primary',
                )}
              >
                <ChannelIcon channel={s.channel} className="size-3.5" />
                Day {s.day} · {s.title}
              </button>
            ))}
            {steps.length < MAX_STEPS && (
              <button
                type="button"
                onClick={onAdd}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-default px-2.5 py-1 text-caption font-medium text-text-secondary transition-colors hover:text-text-primary"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Add step
              </button>
            )}
          </div>
        )}

        {/* ── Channel tabs ───────────────────────────────────────────── */}
        {/* ⚠️ THE SAME COMPLAINT, THE SAME FIX. Owner, 2026-09-18: *"for Email,
            WhatsApp, WhatsApp Call, or a Task, the selected tab is not visible or
            prominent."* */}
        <div role="tablist" aria-label="Channel" className="flex items-center gap-2 border-b border-border-subtle sm:gap-3">
          {CHANNEL_CHOICES.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={step.channel === c.key}
              onClick={() =>
                onStep(active, {
                  channel: c.key,
                  /* ⚠️ A call or a task cannot send itself, so switching to one
                     changes what happens when it falls due — silently leaving
                     "sent automatically" on a phone call would be a lie. */
                  mode: c.key === 'call' || c.key === 'task' ? 'remind_me' : step.mode,
                  /* An email needs a subject; offer one rather than a refusal. */
                  subject: c.key === 'email' && !step.subject.trim() ? suggestedSubject(purpose) : step.subject,
                })
              }
              className={cn(
                'relative inline-flex items-center gap-2 rounded-t-lg px-3.5 py-2.5 text-body-sm transition-colors',
                step.channel === c.key
                  ? 'font-semibold text-accent-primary'
                  : 'font-medium text-text-secondary hover:bg-bg-subtle/60 hover:text-text-primary',
              )}
              style={
                step.channel === c.key
                  ? { background: 'color-mix(in oklab, var(--accent-primary) 8%, transparent)' }
                  : undefined
              }
            >
              <ChannelIcon channel={c.key} />
              {c.label}
              {step.channel === c.key && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-accent-primary"
                />
              )}
            </button>
          ))}
        </div>

        <Labelled label="Step name">
          <input
            value={step.title}
            onChange={(e) => onStep(active, { title: e.target.value })}
            maxLength={60}
            placeholder={single ? 'What is the follow-up?' : 'Step name'}
            className="w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
          />
        </Labelled>

        {step.channel === 'email' && (
          <>
            <Labelled label="To">
              <input
                readOnly
                value={lead.email ? `${lead.fullName ?? 'This lead'} <${lead.email}>` : 'This lead has no email address'}
                className={cn(
                  'w-full rounded-lg border border-border-default bg-bg-subtle px-3 py-2 text-body-sm',
                  lead.email ? 'text-text-primary' : 'italic text-feedback-error',
                )}
              />
            </Labelled>
            <Labelled label="From">
              <input
                readOnly
                value={`${facts.company} · the address your project sends from`}
                className="w-full rounded-lg border border-border-default bg-bg-subtle px-3 py-2 text-body-sm text-text-secondary"
              />
            </Labelled>
            <Labelled label="Subject">
              <input
                value={step.subject}
                onChange={(e) => onStep(active, { subject: e.target.value })}
                maxLength={160}
                placeholder="What the client sees before opening it"
                className="w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
              />
            </Labelled>
          </>
        )}

        <Labelled label={writes ? 'Message' : 'Note for whoever does this'}>
          <div className="mb-1.5 flex flex-wrap gap-1">
            {['lead_first_name', 'my_first_name', 'company', 'project', 'quotation_number'].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onStep(active, { body: `${step.body}{{${key}}}` })}
                className="rounded-full bg-bg-subtle px-2 py-0.5 text-caption text-text-secondary transition-colors hover:text-text-primary"
              >
                {key.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <textarea
            rows={writes ? 6 : 3}
            value={step.body}
            onChange={(e) => onStep(active, { body: e.target.value })}
            maxLength={1500}
            placeholder={writes ? 'The message that goes to the client…' : 'What needs doing…'}
            className="w-full resize-y rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm leading-relaxed text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
          />
        </Labelled>

        {writes && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-caption font-medium text-text-secondary">
              <Sparkles className="size-3.5" aria-hidden="true" />
              AI suggestions
            </span>
            {POLISH.map((p) => (
              <button
                key={p.key}
                type="button"
                disabled={polishing || !step.body.trim()}
                onClick={() => void polish(p.key)}
                className="rounded-full border border-border-default px-2.5 py-1 text-caption text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-40"
              >
                {polishing ? 'Rewriting…' : p.label}
              </button>
            ))}
          </div>
        )}

        {step.channel === 'whatsapp' && step.mode === 'auto_send' && (
          <div className="rounded-xl border border-border-subtle bg-bg-subtle/40 p-3">
            <p className="text-caption font-semibold text-text-primary">
              Template — for when the 24-hour window has closed
            </p>
            <p className="mt-0.5 text-caption leading-relaxed text-text-secondary">
              Inside 24 hours of the client&rsquo;s last message the text above is sent as it is. Outside it, WhatsApp
              only carries a template <span className="font-medium text-text-primary">Meta has approved</span> — the one
              chosen here, or the approved template for this purpose when it sends.
            </p>
            {templates === null ? (
              <p className="mt-2 text-caption text-text-secondary">Asking Meta what this account has…</p>
            ) : (
              <>
                <select
                  value={step.template ? `${step.template.name}::${step.template.language}` : ''}
                  onChange={(e) => {
                    const [name, language] = e.target.value.split('::');
                    if (!name) {
                      onClearTemplate(active);
                      return;
                    }
                    /* 228 · how many blanks it has, so the right values are stored. */
                    const t = templates.templates.find((x) => x.name === name && x.language === language);
                    onStep(active, { template: { name, language, variables: t?.variables ?? 0 } });
                  }}
                  className="mt-2 w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
                >
                  <option value="">No template — only send inside the 24-hour window</option>
                  {templates.templates
                    .filter((t) => t.status === 'APPROVED')
                    .map((t) => (
                      /* ⚠️ SHOWN, BUT NOT CHOOSABLE, WHEN ITS BLANKS CANNOT BE
                         FILLED FROM HERE. Meta refuses a template sent short of
                         values; hiding it would leave somebody wondering where
                         their approved template went. */
                      <option
                        key={`${t.name}::${t.language}`}
                        value={`${t.name}::${t.language}`}
                        disabled={!fillable(t)}
                      >
                        {t.name} · {t.language}
                        {fillable(t) ? '' : ` — needs ${t.variables} details, sent by the booking flow`}
                      </option>
                    ))}
                </select>
                {/* ⚠️ IT SAYS WHICH ONE IT CHOSE AND WHY. A form that decides on
                    somebody's behalf and hides it is worse than one that asks —
                    this one shows its reasoning and the select still changes it,
                    including back to no template at all. */}
                {chosenBecause && (
                  <p className="mt-1.5 text-caption text-text-secondary">
                    Chosen for you because {chosenBecause}. Change it if you meant another.
                  </p>
                )}
                {templates.ok
                  && !step.template
                  && templates.templates.some((t) => t.status === 'APPROVED') && (
                  /* ⚠️ THE ONE TYPE WITH NO WIZARD TEMPLATE SAYS WHY, AND WHERE THE
                     REAL ONE GOES FROM. Every other type has its own (229); the
                     appointment reminder's template needs five details only the
                     booking has, and the booking already sends it. */
                  <p className="mt-1.5 text-caption" style={{ color: 'var(--feedback-warning)' }}>
                    {purpose === 'appointment_reminder'
                      ? 'The booking already sends the approved confirmation and reminder by itself. This extra step goes only while the client’s 24-hour window is open.'
                      : 'Nothing here matches this purpose, so this step will only send inside the 24-hour window.'}
                  </p>
                )}
                {templates.error && <p className="mt-1.5 text-caption text-feedback-error">{templates.error}</p>}
                {templates.ok && templates.templates.filter((t) => t.status === 'APPROVED').length === 0 && (
                  <p className="mt-1.5 text-caption text-text-secondary">
                    This account has no approved template yet.
                  </p>
                )}
                {templates.templates.some((t) => t.status !== 'APPROVED') && (
                  <p className="mt-1.5 text-caption text-text-secondary">
                    Waiting on Meta:{' '}
                    {templates.templates
                      .filter((t) => t.status !== 'APPROVED')
                      .map((t) => `${t.name} (${t.status.toLowerCase()})`)
                      .join(', ')}
                  </p>
                )}
                {/* ⚠️ THE ONLY PLACE ONE IS WRITTEN AND APPROVED. The CRM cannot do
                    it and never claims to — Meta reviews every template itself. */}
                <a
                  href={templates.managerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-caption font-medium text-text-brand underline-offset-2 hover:underline"
                >
                  Write or approve a template in Meta&rsquo;s WhatsApp Manager
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </>
            )}
          </div>
        )}

        {step.channel === 'call' && (
          <p className="rounded-xl bg-bg-subtle px-3 py-2.5 text-caption leading-relaxed text-text-secondary">
            A <span className="font-medium text-text-primary">WhatsApp call you make yourself</span>, from your own
            phone. Nothing dials it — WhatsApp&rsquo;s business calling is not on this account — so this step becomes a
            reminder on your list at the time you choose.
          </p>
        )}

        {step.channel === 'email' && docs !== null && docs.length > 0 && (
          <Labelled label="Attachments">
            <ul className="space-y-1.5">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-2 rounded-lg border border-border-subtle px-2.5 py-1.5">
                  <Paperclip className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-caption text-text-primary">{d.title}</span>
                  <span className="shrink-0 text-caption text-text-secondary">{(d.sizeBytes / 1_048_576).toFixed(1)} MB</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-caption text-text-secondary">
              These are this lead&rsquo;s files. Choosing which to attach is coming next — the sender already carries them.
            </p>
          </Labelled>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption text-text-secondary">When it falls due:</span>
          {/* ⚠️ NO "DRAFT FOR ME TO SEND" (234). A follow-up somebody schedules
              is one they have reviewed — it sends, or it is a reminder. */}
          {(['auto_send', 'remind_me'] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={!writes && m !== 'remind_me'}
              onClick={() => onStep(active, { mode: m })}
              aria-pressed={step.mode === m}
              className={cn(
                'rounded-full border px-2.5 py-1 text-caption font-medium transition-colors disabled:opacity-40',
                step.mode === m
                  ? 'border-[var(--pick-border)] bg-[var(--pick-bg)] text-text-primary'
                  : 'border-border-default text-text-secondary hover:text-text-primary',
              )}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
          {!single && steps.length > 1 && (
            <button
              type="button"
              onClick={() => onRemove(active)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-caption text-text-secondary transition-colors hover:bg-bg-subtle hover:text-feedback-error"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Remove this step
            </button>
          )}
        </div>
      </div>

      {/* ── The preview ──────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-body font-semibold text-text-primary">
          {step.channel === 'email' ? 'Live email preview' : step.channel === 'whatsapp' ? 'WhatsApp preview' : 'What you will see'}
        </p>
        <p className="text-caption text-text-secondary">
          {writes
            ? `This is how it will reach ${lead.fullName ?? 'the client'}.`
            : 'This step is for you — nothing goes to the client.'}
        </p>
        {step.channel === 'email' ? (
          <EmailPreview
            fromName={facts.company}
            fromAddress="your project’s sending address"
            toName={lead.fullName ?? 'This lead'}
            toAddress={lead.email ?? ''}
            subject={filledSubject}
            body={filled}
            signOff={`${facts.myFirstName} · ${facts.company}`}
          />
        ) : step.channel === 'whatsapp' ? (
          <WhatsAppPreview
            businessName={facts.company}
            body={filled}
            timeLabel={timeLabel(startMs)}
            note="Any reply pauses the sequence and tells you."
          />
        ) : (
          <div className="rounded-xl border border-border-subtle bg-bg-subtle/40 p-4">
            <p className="flex items-center gap-2 text-body-sm font-semibold text-text-primary">
              <ChannelIcon channel={step.channel} />
              {step.title || 'This step'}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-caption leading-relaxed text-text-secondary">
              {step.body || 'Nothing written yet.'}
            </p>
            <p className="mt-2 text-caption text-text-secondary">
              It lands in this lead&rsquo;s follow-ups and on your Todos when it falls due.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-caption font-semibold text-text-primary">{label}</span>
      {children}
    </label>
  );
}

/**
 * Every step's own date and time, on the same calendar.
 *
 * Owner, 2026-09-18: *"the same way I can choose the date and time in the
 * calendar and the time input box, exactly show it for the three schedules… also
 * show that this is for the first schedule, this is for the second schedule, and
 * this is for the third schedule… If I change the date from the calendar below,
 * that duration will auto-change."*
 *
 * ── ⚠️ THE DAYS ARE DERIVED, NOT TYPED ─────────────────────────────────────
 * A person picking dates does not want to do the arithmetic. So the calendar
 * writes an absolute date and `day` — the offset the engine stores — is computed
 * from it. Picking "23 Sep" on a plan starting the 19th sets day 5 without
 * anybody counting, which is the "duration will auto-change" the owner is after.
 *
 * ⚠️ AND MOVING STEP ONE MOVES THE PLAN, NOT THE GAPS. The first step's date is
 * the plan's own start (the picker above owns it), so the others keep their
 * offsets and slide with it. Anything else would silently re-space a plan
 * somebody had already laid out.
 *
 * ⚠️ A STEP CANNOT LAND BEFORE THE ONE BEFORE IT. Same-day is allowed — two
 * messages on day 3 is a real plan — but going backwards is not, because the
 * engine walks the steps in order and would simply send it at the earlier
 * moment, which is not what the screen would be showing.
 */
function StepCalendar({
  steps,
  onStep,
  startMs,
  nowMs,
}: {
  steps: readonly PlanStep[];
  onStep: (i: number, patch: Partial<PlanStep>) => void;
  startMs: number;
  nowMs: number;
}) {
  const [active, setActive] = React.useState(0);
  const first = steps[0]?.day ?? 1;

  /* The moment a step falls, from the plan's start plus its own offset. */
  const dayMs = (step: PlanStep) => startMs + Math.max(0, step.day - first) * 86_400_000;

  const step = steps[Math.min(active, steps.length - 1)] ?? steps[0];
  const index = Math.min(active, steps.length - 1);
  const at = dayMs(step);
  const parts = karachiParts(at);
  const [month, setMonth] = React.useState(() => ({ y: parts.y, m: parts.m }));

  /* ⚠️ THE FIRST STEP'S DATE BELONGS TO THE PICKER ABOVE — it is the plan's
     start, and two controls writing one value is how they disagree. */
  const readOnlyDate = index === 0;

  /* ⚠️ STRICTLY AFTER THE STEP BEFORE IT — `previous + 1`, not `previous`.
     Owner, 2026-09-18: *"Step 2 must be after step 1, not on the same day."*
     They were quoting `planProblem`'s own refusal, which this calendar was
     walking people into: it let the same day be picked and the save then said no.
     The reason the rule exists is 170's one-chase-a-day cap — two steps on one
     day means the second is silently pushed to tomorrow, so the plan on screen
     would not be the plan that ran. */
  const earliestDay = index === 0 ? first : (steps[index - 1]?.day ?? first) + 1;
  const notOnOrBefore =
    index === 0 ? null : startMs + Math.max(0, earliestDay - 1 - first) * 86_400_000;

  const pick = (y: number, m: number, d: number) => {
    if (readOnlyDate) return;
    const chosen = karachiAt(y, m, d, 12);
    const offset = Math.round((chosen - startMs) / 86_400_000);
    onStep(index, { day: Math.max(earliestDay, first + Math.max(0, offset)) });
  };

  return (
    <section>
      <h3 className="text-body font-semibold text-text-primary">Each step&rsquo;s date and time</h3>
      <p className="mt-0.5 text-caption text-text-secondary">
        Pick a step, then its day and hour. Leave the time blank and it goes out at whatever hour the plan is running
        at.
      </p>

      {/* ── Which step ────────────────────────────────────────────────── */}
      <div role="tablist" aria-label="Step" className="mt-2 flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === index}
            onClick={() => {
              setActive(i);
              const p = karachiParts(dayMs(s));
              setMonth({ y: p.y, m: p.m });
            }}
            className={cn(
              'rounded-xl border px-3 py-2 text-left transition-colors',
              i === index
                ? 'border-[var(--pick-border)] bg-[var(--pick-bg)]'
                : 'border-border-default hover:bg-bg-subtle',
            )}
          >
            <span className="flex items-center gap-1.5">
              <ChannelIcon channel={s.channel} className="size-3.5" />
              <span className="text-caption font-semibold text-text-primary">{ORDINAL[i] ?? `Step ${i + 1}`}</span>
            </span>
            <span className="mt-0.5 block text-caption tabular-nums text-text-secondary">
              {formatDay(dayMs(s))}
              {s.at ? ` · ${s.at}` : ''}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <MonthGrid
          month={month}
          onMonth={setMonth}
          selected={{ y: parts.y, m: parts.m, d: parts.d }}
          onPick={pick}
          nowMs={nowMs}
          notOnOrBefore={notOnOrBefore}
        />

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Date" icon={CalendarDays}>
              <span className="block truncate text-body-sm text-text-primary">{formatDay(at)}</span>
            </Field>
            <Field label="Time" icon={Clock3}>
              <input
                type="time"
                value={step.at ?? ''}
                onChange={(e) => onStep(index, { at: e.target.value || null })}
                aria-label={`Time for ${ORDINAL[index] ?? `step ${index + 1}`}`}
                className="w-full bg-transparent text-body-sm tabular-nums text-text-primary focus:outline-none"
              />
            </Field>
          </div>

          {readOnlyDate ? (
            /* ⚠️ SAID, NOT DISABLED SILENTLY. The first step's date is the plan's
               start and is set by the picker above; a calendar that simply
               ignored clicks would read as broken. */
            <p className="flex items-start gap-2 rounded-lg bg-bg-subtle px-3 py-2 text-caption leading-relaxed text-text-secondary">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              The first step&rsquo;s date is the plan&rsquo;s start — set it in &ldquo;When should the first step
              go?&rdquo; above. Move it and every later step slides with it, keeping the gaps you chose.
            </p>
          ) : (
            <p className="flex items-start gap-2 rounded-lg bg-bg-subtle px-3 py-2 text-caption leading-relaxed text-text-secondary">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {`${step.day - first} day${step.day - first === 1 ? '' : 's'} after the plan starts` +
                (index > 0
                  ? `, ${step.day - (steps[index - 1]?.day ?? first)} after the step before it. Earlier days are closed because only one chase a day reaches a client.`
                  : '.')}
            </p>
          )}

          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={step.onlyIfNoReply}
              onChange={(e) => onStep(index, { onlyIfNoReply: e.target.checked })}
              className="mt-0.5 size-4 accent-[var(--pick-mark)]"
            />
            <span className="min-w-0">
              <span className="block text-body-sm text-text-primary">Only if they have not replied</span>
              <span className="block text-caption text-text-secondary">
                Skipped, and recorded as skipped, if the client writes before this step falls due.
              </span>
            </span>
          </label>
        </div>
      </div>
    </section>
  );
}

const ORDINAL = ['1st follow-up', '2nd follow-up', '3rd follow-up', '4th follow-up', '5th follow-up', '6th follow-up'];

/* ── 3 · Schedule & conditions ───────────────────────────────────────────── */

function Schedule({
  kind,
  steps,
  onStep,
  purpose,
  schedule,
  onSchedule,
  nowMs,
  anchors,
  conditions,
  onConditions,
  startMs,
}: {
  kind: 'single' | 'schedule';
  steps: readonly PlanStep[];
  onStep: (i: number, patch: Partial<PlanStep>) => void;
  purpose: FollowUpPurpose;
  schedule: ScheduleValue;
  onSchedule: (v: ScheduleValue) => void;
  nowMs: number;
  anchors: readonly EventAnchor[];
  conditions: { reply: boolean; visit: boolean; quotation: boolean };
  onConditions: (c: { reply: boolean; visit: boolean; quotation: boolean }) => void;
  startMs: number;
}) {
  const list = stopConditions(purpose);
  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-body font-semibold text-text-primary">
          {kind === 'single' ? 'When should this follow-up happen?' : 'When should the first step go?'}
        </h3>
        <div className="mt-2">
          <SchedulePicker value={schedule} onChange={onSchedule} nowMs={nowMs} anchors={anchors} />
        </div>
      </section>

      {kind === 'schedule' && (
        <StepCalendar steps={steps} onStep={onStep} startMs={startMs} nowMs={nowMs} />
      )}

      <section>
        <h3 className="text-body font-semibold text-text-primary">When should it stop?</h3>
        <p className="mt-0.5 text-caption text-text-secondary">
          {kind === 'single'
            ? 'A single follow-up has no conditions — it is one thing on your list.'
            : 'Choose the first three. The last two are always on and cannot be switched off.'}
        </p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          <Condition
            on={conditions.reply}
            disabled={kind === 'single'}
            onChange={(v) => onConditions({ ...conditions, reply: v })}
            label="Stop on any reply"
            detail="Pauses the moment the client replies on any channel, so you read it first."
          />
          <Condition
            on={conditions.visit}
            disabled={kind === 'single' || !list.some((c) => c.label.includes('visit is already booked'))}
            onChange={(v) => onConditions({ ...conditions, visit: v })}
            label="Stop when a visit is booked"
            detail={
              list.some((c) => c.label.includes('visit is already booked'))
                ? 'They have agreed to come; chasing them to come stops.'
                : 'Not used for this purpose — this follow-up is about the visit itself.'
            }
          />
          <Condition
            on={conditions.quotation}
            disabled={kind === 'single' || purpose !== 'quotation'}
            onChange={(v) => onConditions({ ...conditions, quotation: v })}
            label="Stop if the quotation dies"
            detail={
              purpose === 'quotation'
                ? 'Expired, rejected or replaced by a new version.'
                : 'Only applies to a quotation follow-up.'
            }
          />
          <Condition on disabled onChange={() => {}} label="The lead is closed" detail="Won or lost — nothing further is sent. Always on." />
          <Condition on disabled onChange={() => {}} label="They asked not to be messaged" detail="A stated no stops every plan. Always on." />
        </ul>
      </section>
    </div>
  );
}

function Condition({
  on,
  disabled,
  onChange,
  label,
  detail,
}: {
  on: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
  detail: string;
}) {
  return (
    <li
      className={cn(
        'flex items-start gap-2.5 rounded-xl border p-3',
        on && !disabled ? 'border-[var(--pick-border)] bg-[var(--pick-bg)]' : 'border-border-subtle bg-bg-surface',
        disabled && 'opacity-70',
      )}
    >
      <input
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="mt-0.5 size-4 accent-[var(--pick-mark)]"
      />
      <span className="min-w-0">
        <span className="block text-body-sm font-medium text-text-primary">{label}</span>
        <span className="block text-caption leading-relaxed text-text-secondary">{detail}</span>
      </span>
    </li>
  );
}

/* ── 4 · Review ──────────────────────────────────────────────────────────── */

function Review({
  kind,
  purpose,
  steps,
  facts,
  tokens,
  lead,
  delivery,
  conditions,
  startMs,
  active,
  onActive,
  onEdit,
}: {
  kind: 'single' | 'schedule';
  purpose: FollowUpPurpose;
  steps: readonly PlanStep[];
  facts: ReturnType<typeof leadFactsFrom>;
  tokens: Record<string, string>;
  lead: CrmLeadRecord;
  delivery: PlanMode;
  conditions: { reply: boolean; visit: boolean; quotation: boolean };
  startMs: number;
  active: number;
  onActive: (i: number) => void;
  onEdit: (i: number) => void;
}) {
  const first = steps[0]?.day ?? 1;
  const last = steps[steps.length - 1]?.day ?? 1;
  const step = steps[active] ?? steps[0];
  const stepAt = startMs + Math.max(0, step.day - first) * 86_400_000;

  return (
    <div className="space-y-4">
      {/* ── The summary strip ──────────────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Chip icon={Pencil} label="Draft" detail="Not started yet" />
        <Chip icon={CalendarDays} label={`${steps.length} step${steps.length === 1 ? '' : 's'}`} detail={purposeLabel(purpose)} />
        <Chip icon={Clock3} label={`${Math.max(1, last - first + 1)} days`} detail="Total duration" />
        <Chip
          icon={DELIVERY_ICON[delivery]}
          label={MODE_LABEL[delivery]}
          detail={conditions.reply ? 'Only until they reply' : 'Runs to the end'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── The steps ────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-border-subtle bg-bg-surface p-3.5">
          <h3 className="text-body font-semibold text-text-primary">
            {kind === 'single' ? 'The follow-up' : `Sequence steps (${steps.length})`}
          </h3>
          <ol className="mt-3 space-y-2">
            {steps.map((s, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onActive(i)}
                  className={cn(
                    'flex w-full gap-3 rounded-xl border p-3 text-left transition-colors',
                    i === active ? 'border-[var(--pick-border)] bg-[var(--pick-bg)]' : 'border-border-subtle hover:bg-bg-subtle',
                  )}
                >
                  <span className="flex flex-col items-center">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-primary text-caption font-semibold text-white">
                      {i + 1}
                    </span>
                    {i < steps.length - 1 && <span aria-hidden="true" className="my-1 w-px flex-1 bg-border-subtle" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <ChannelIcon channel={s.channel} />
                      <span className="min-w-0 truncate text-body-sm font-semibold text-text-primary">{s.title}</span>
                      <span className="ml-auto shrink-0 rounded-md bg-feedback-warning/15 px-1.5 py-0.5 text-caption font-medium text-feedback-warning">
                        Planned
                      </span>
                    </span>
                    <span className="mt-1 block text-caption tabular-nums text-accent-primary">
                      {formatWhen(new Date(startMs + Math.max(0, s.day - first) * 86_400_000).toISOString())}
                    </span>
                    <span className="mt-0.5 block text-caption text-text-secondary">{MODE_LABEL[s.mode]}</span>
                    {s.onlyIfNoReply && (
                      <span className="block text-caption text-text-secondary">Only if no reply</span>
                    )}
                  </span>
                  <span
                    role="presentation"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(i);
                    }}
                    className="grid size-7 shrink-0 cursor-pointer place-items-center self-start rounded-lg border border-border-default text-text-secondary transition-colors hover:bg-bg-surface hover:text-text-primary"
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-3 flex items-center gap-1.5 border-t border-border-subtle pt-3 text-caption text-text-secondary">
            <Flag className="size-3.5" aria-hidden="true" />
            Ends after step {steps.length}
          </p>
        </section>

        {/* ── What that step will look like ────────────────────────────── */}
        <section className="space-y-2">
          <p className="text-body font-semibold text-text-primary">
            Step {active + 1} · {step.channel === 'email' ? 'Email' : step.channel === 'whatsapp' ? 'WhatsApp message' : 'For you'}
          </p>
          {step.channel === 'email' ? (
            <EmailPreview
              fromName={facts.company}
              fromAddress="your project’s sending address"
              toName={lead.fullName ?? 'This lead'}
              toAddress={lead.email ?? ''}
              subject={fillTokens(step.subject || step.title, tokens)}
              body={fillTokens(step.body, tokens)}
              signOff={`${facts.myFirstName} · ${facts.company}`}
            />
          ) : step.channel === 'whatsapp' ? (
            <WhatsAppPreview
              businessName={facts.company}
              body={fillTokens(step.body, tokens)}
              timeLabel={timeLabel(stepAt)}
              note={conditions.reply ? 'Any reply pauses the sequence and tells you.' : 'It runs to the end unless you stop it.'}
            />
          ) : (
            <div className="rounded-xl border border-border-subtle bg-bg-subtle/40 p-4 text-caption leading-relaxed text-text-secondary">
              {step.body || 'Nothing written yet.'}
            </div>
          )}

          <div className="rounded-xl border border-border-subtle bg-bg-subtle/40 p-3 text-caption leading-relaxed text-text-secondary">
            <p className="font-semibold text-text-primary">What happens next</p>
            <p className="mt-0.5">
              {delivery === 'auto_send'
                ? `Step 1 goes out on ${formatWhen(new Date(startMs).toISOString())} without anybody pressing send.`
                : `Step 1 appears on your list on ${formatWhen(new Date(startMs).toISOString())} as a reminder for you.`}
              {conditions.reply ? ' If the client replies before then, the plan pauses and waits for you.' : ''}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Chip({
  icon: Icon,
  label,
  detail,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border-subtle bg-bg-surface px-3 py-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-bg-subtle text-text-secondary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-body-sm font-semibold text-text-primary">{label}</span>
        <span className="block truncate text-caption text-text-secondary">{detail}</span>
      </span>
    </div>
  );
}

/* ── Bits ────────────────────────────────────────────────────────────────── */

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

function timeLabel(ms: number): string {
  const p = karachiParts(ms);
  const suffix = p.h < 12 ? 'AM' : 'PM';
  const hour = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${hour}:${String(p.mi).padStart(2, '0')} ${suffix}`;
}

function tomorrowAt10(nowMs: number): number {
  const p = karachiParts(nowMs);
  return karachiAt(p.y, p.m, p.d + 1, 10);
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
