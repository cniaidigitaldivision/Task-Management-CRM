'use client';

import * as React from 'react';
import { ArrowRight, Check, Copy, FileText, Home, Mail, MapPin, Tag, User } from 'lucide-react';

import { QualifyPanel } from '@/components/crm/qualify-panel';
import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { useToast } from '@/components/ui/toast';
import type {
  CrmLeadEvent,
  CrmLeadNote,
  CrmLeadRecord,
  CrmLeadRelated,
} from '@/lib/db/queries/crm-leads';
import { activityLabel } from '@/lib/domain/crm-stages';
import { bantQuestions, qualificationGaps } from '@/lib/domain/crm-qualification';
import { sourceLabel } from '@/lib/domain/lead-source';
import { displayPhone } from '@/lib/domain/phone';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE OVERVIEW TAB — built to the owner's reference of 2026-09-17
 * ----------------------------------------------------------------------------
 * A lifecycle strip, Lead details on the left, and Next action · Personal note ·
 * Recent activity down the right.
 *
 * ── ⚠️ THE STRIP SHOWS SEVEN STEPS AND THE DATABASE HAS TEN STAGES ─────────
 * The strip is built from the owner's own list — see `stepsFor` below, which is
 * where the reasoning lives. Nothing is hidden: every real stage has a step, and
 * the only group left is Visit, whose current label says which half it is in.
 * ========================================================================= */

/* The blue halo on the current step. Held here because a template literal
   inside JSX props is where a stray quote goes unnoticed. */
const DOT_RING = '0 0 0 4px color-mix(in oklab, var(--accent-primary) 18%, transparent)';

const CHANNEL: Record<string, string> = {
  whatsapp: 'WhatsApp', call: 'Call', email: 'Email',
  meeting: 'Meeting', site_visit: 'Site visit', task: 'Task',
};
/** ⚠️ "whatsapp" in lower case is a database value, not a word for a screen. */
function channelLabel(kind: string): string {
  return CHANNEL[kind] ?? kind.replace(/_/g, ' ');
}

/**
 * The lifecycle, in the owner's own words (2026-09-17):
 *
 *   New · Contacted · Qualified · **Proposal sent** · **Quotation sent** ·
 *   then for real estate: Visit · Negotiation · Won
 *
 * ⚠️ PROPOSAL AND QUOTATION ARE TWO STEPS, NOT ONE. They were collapsed on the
 * first attempt and the owner caught it: *"One step you have missed is the
 * quotation."* They are genuinely different moments — a proposal says what we
 * would do, a quotation says what it costs — and a lead sitting between them is
 * in the commonest place a deal goes quiet. Merging them hid exactly that.
 *
 * ⚠️ AND VISIT IS REAL ESTATE ONLY. Owner: *"If it's real estate then
 * definitely: Visit, Negotiation."* Nobody visits a site to buy an ERP, and a
 * permanently grey step a service lead can never reach would read as a deal
 * stalled rather than as a step that does not apply. `app.crm_lead_sells` (174)
 * already decides which kind this lead is.
 *
 * ⚠️ `lost` IS ABSENT ON PURPOSE — it is an exit, not a step. A funnel that
 * draws losing as progress is a funnel that rewards it.
 */
interface Step {
  readonly label: string;
  readonly stages: readonly string[];
}

function stepsFor(sells: string): readonly Step[] {
  const visit: Step = { label: 'Visit', stages: ['visit_scheduled', 'visited'] };

  return [
    { label: 'New', stages: ['new'] },
    { label: 'Contacted', stages: ['contacted'] },
    { label: 'Qualified', stages: ['qualified'] },
    { label: 'Proposal sent', stages: ['proposal_pending'] },
    { label: 'Quotation sent', stages: ['quotation_sent'] },
    ...(sells === 'service' ? [] : [visit]),
    { label: 'Negotiation', stages: ['negotiation'] },
    { label: 'Won', stages: ['won'] },
  ];
}

export function LeadOverviewTab({
  lead,
  notes,
  activity,
  related,
  phone,
  viewerName,
  onTab,
  loading = false,
}: {
  lead: CrmLeadRecord;
  notes: readonly CrmLeadNote[];
  activity: readonly CrmLeadEvent[];
  related: CrmLeadRelated;
  phone: string;
  viewerName: string;
  onTab: (tab: 'conversations' | 'followups' | 'activity') => void;
  /**
   * Drawn from the clicked row while the record is on its way.
   * ⚠️ The lifecycle, the details and the next action are all real from the
   * first frame. The qualification answers, the budget, the notes and the
   * activity are not on the row — and a null there must read as "loading", not
   * as "never asked", or the card would tell somebody to go and ask questions
   * the lead has already answered.
   */
  loading?: boolean;
}) {
  const toast = useToast();
  const [editingQualification, setEditingQualification] = React.useState(false);

  const steps = stepsFor(lead.sells);
  /* ⚠️ A SERVICE LEAD THAT SOMEHOW REACHED `visited` FINDS NO STEP, and -1
     would light none of them. It falls back to the step before Visit, so the
     strip still says roughly where the deal is rather than going blank. */
  const found = steps.findIndex((s) => s.stages.includes(lead.stage));
  const at =
    found >= 0
      ? found
      : lead.stage === 'visit_scheduled' || lead.stage === 'visited'
        ? steps.findIndex((s) => s.label === 'Quotation sent')
        : -1;
  const isLost = lead.stage === 'lost';

  const copy = (value: string, what: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => toast({ tone: 'ok', text: `${what} copied.` }),
      () => toast({ tone: 'error', text: 'Could not copy — select it by hand.' }),
    );
  };

  const questions = bantQuestions(
    (lead.sells as 'property' | 'service' | 'mixed') ?? 'property',
  );
  const gaps = qualificationGaps(lead);
  const answered = 4 - gaps.length;

  return (
    <div className="space-y-4">
      {/* ── Lifecycle ─────────────────────────────────────────────────── */}
      <section>
        <h3 className="mb-2 text-caption font-medium text-text-secondary">Lifecycle</h3>

        {isLost ? (
          /* ⚠️ A LOST LEAD IS NOT A STEP ON THE WAY TO WON. Drawing it in the
             strip would make losing look like progress. */
          <p className="rounded-xl border border-feedback-error/30 bg-feedback-error/5 px-3 py-2 text-body-sm text-text-primary">
            This lead was lost
            {lead.lostReason && ` — ${lead.lostReason.replace(/_/g, ' ')}`}.
          </p>
        ) : (
          <ol className="flex items-start gap-0">
            {steps.map((step, i) => {
              const done = at > i;
              const current = at === i;
              return (
                <li key={step.label} className="relative flex min-w-0 flex-1 flex-col items-center">
                  {/* The rail, behind the dots. ⚠️ Drawn per step rather than as
                      one line under the row, so it cannot drift out of alignment
                      when a label wraps. */}
                  {i > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute right-1/2 top-[13px] h-[2px] w-full"
                      style={{
                        background: at >= i
                          ? 'var(--feedback-success)'
                          : 'var(--border-default)',
                      }}
                    />
                  )}
                  {/* ⚠️ THE FILL IS AN INLINE VAR, not a `bg-` class. These tokens
                      exist, but Tailwind only emits a class it has SEEN — and a
                      colour that silently renders as nothing is exactly the bug that
                      showed up here first: three completed steps with no green circle
                      at all. `calendar-view` fills its status dots the same way, for
                      the same reason. */}
                  <span
                    className={cn(
                      'relative z-10 grid size-7 place-items-center rounded-full text-caption font-semibold',
                      done || current
                        ? 'text-white'
                        : 'border border-border-default text-text-secondary',
                    )}
                    style={{
                      background: done
                        ? 'var(--feedback-success)'
                        : current
                          ? 'var(--accent-primary)'
                          : 'var(--bg-surface)',
                      boxShadow: current ? DOT_RING : undefined,
                    }}
                  >
                    {done ? <Check className="size-4" strokeWidth={3} aria-hidden="true" /> : i + 1}
                  </span>
                  <span
                    className={cn(
                      'mt-1.5 text-center text-caption leading-tight',
                      current ? 'font-semibold' : 'text-text-secondary',
                    )}
                  >
                    {/* ⚠️ THE CURRENT STEP CARRIES THE REAL STAGE NAME. A lead at
                        `proposal_pending` lights step 4 and says so, rather than
                        being reported as having sent a quotation it has not. */}
                    <span style={current ? { color: 'var(--accent-primary)' } : undefined}>
                      {current ? currentLabel(lead.stage, step.label) : step.label}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* ⚠️ `sm:`, NOT `lg:`. The drawer is 42rem — 672px — so an `lg` breakpoint
          at 1024px would never fire and the two columns the reference draws would
          never appear. Written wrong first and caught by looking at it. */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* ⚠️ THE LEFT COLUMN IS ONE CHILD, not two. Qualification was a direct
            child of the grid with `sm:col-span-2`, which forced it onto its own
            row and pushed the whole right-hand column below it — the two-column
            layout silently became one. A grid with two children stays two. */}
        <div className="space-y-3">
        {/* ── Lead details ──────────────────────────────────────────── */}
        <section className="rounded-xl border border-border-subtle bg-bg-surface p-4">
          <header className="mb-3">
            <h3 className="text-body-sm font-semibold text-text-primary">Lead details</h3>
          </header>

          <dl className="space-y-3">
            <Row icon={Home} label="Project / Interest" value={lead.projectName} />
            <Row icon={FileText} label="Interested in" value={lead.propertyLabel} />
            {/* ⚠️ THE PRECISE FIGURE, not the band. `budget` and `budget_band`
                are two different columns: what they actually said they would
                spend, and which bracket that falls in. The band belongs to the
                qualification card below, so neither is printed twice. */}
            <Row
              icon={Tag}
              label="Budget (PKR)"
              value={lead.budget === null ? null : `PKR ${lead.budget.toLocaleString('en-PK')}`}
            />
            <Row icon={MapPin} label="City" value={lead.city} />
            <Row icon={Tag} label="Source" value={sourceLabel(lead.source)} />
            <Row
              icon={Mail}
              label="Email"
              value={lead.email}
              href={lead.email ? `mailto:${lead.email}` : null}
            />
            {phone && (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0" style={{ color: WA_GREEN }}>
                  <WhatsAppMark className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <dt className="text-caption text-text-secondary">WhatsApp</dt>
                  <dd className="flex items-center gap-2 text-body-sm text-text-primary">
                    <span className="tabular-nums">{displayPhone(lead.phoneE164) ?? phone}</span>
                    {/* ⚠️ THE NUMBER IS SHOWN IN FULL, not masked as the reference
                        draws it. Hiding it from the person whose job is to ring it
                        is friction with no security behind it — RLS already decides
                        who sees this lead at all, and the desk behind this drawer
                        prints it in full. */}
                    <button
                      type="button"
                      onClick={() => copy(lead.phoneE164 ?? phone, 'Number')}
                      aria-label="Copy the number"
                      className="rounded p-0.5 text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
                    >
                      <Copy className="size-3.5" aria-hidden="true" />
                    </button>
                  </dd>
                </div>
              </div>
            )}
            <Row
              icon={User}
              label="Owner"
              value={lead.ownerName ? `You · ${lead.ownerName}` : viewerName}
            />
          </dl>
        </section>

        {/* ── Qualification ────────────────────────────────────
            ⚠️ ITS OWN CARD, NOT FOUR MORE ROWS IN THE LIST. The answers were
            inline in Lead details and the owner asked for them out: four
            question-shaped labels among eight fact-shaped ones made the list
            read as a form. As a card they are one line, and the whole set is
            legible at a glance — which is what a qualification IS. */}
        <section className="rounded-xl border border-border-subtle bg-bg-surface p-4">
          <header className="flex flex-wrap items-center gap-2">
            <h3 className="text-body-sm font-semibold text-text-primary">Qualification</h3>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-caption font-medium',
                !loading && gaps.length === 0 ? 'text-white' : 'text-text-secondary',
              )}
              style={
                !loading && gaps.length === 0 ? { background: 'var(--feedback-success)' } : undefined
              }
            >
              {loading ? (
                'Loading…'
              ) : gaps.length === 0 ? (
                <>
                  <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> Qualified
                </>
              ) : answered === 0 ? (
                'Not asked yet'
              ) : (
                `${answered} of 4`
              )}
            </span>
            <button
              type="button"
              disabled={loading}
              onClick={() => setEditingQualification((v) => !v)}
              className="ml-auto text-caption font-medium text-text-brand underline-offset-2 hover:underline"
            >
              {editingQualification ? 'Done' : answered === 0 ? 'Answer them' : 'Edit'}
            </button>
          </header>

          {/* ⚠️ THE EXACT ANSWERS, as a row of chips — the owner asked for the
              collapsed summary to carry them rather than a count. "3 of 4" tells
              you a form is unfinished; "Within a month · ERP · 1–3 lakh" tells you
              who you are about to ring. */}
          {!editingQualification && (
            loading ? (
              <p className="mt-2 text-caption text-text-secondary">Loading the answers…</p>
            ) : answered === 0 ? (
              <p className="mt-2 text-caption leading-relaxed text-text-secondary">
                Nothing asked yet — this lead cannot move past Contacted until it is.
              </p>
            ) : (
              <>
                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                  {questions.map((q) => {
                    const value = q.labelOf(lead[q.field]);
                    return (
                      <li
                        key={q.field}
                        className={cn(
                          'rounded-lg border px-2 py-1 text-caption',
                          value
                            ? 'border-border-subtle bg-bg-subtle text-text-primary'
                            : 'border-dashed border-border-default text-text-secondary',
                        )}
                      >
                        <span className="font-semibold">{q.letter}</span>{' '}
                        {/* ⚠️ An unanswered axis says WHICH one is missing rather than
                            being left out — an absent chip is a gap nobody can see. */}
                        {value ?? <span className="italic">{q.label.replace(/\?$/, '')}</span>}
                      </li>
                    );
                  })}
                </ul>
                {gaps.length > 0 && (
                  <p className="mt-2 text-caption text-text-secondary">
                    Still to find out: {gaps.join(', ').toLowerCase()}. This lead cannot
                    move past Contacted until you do.
                  </p>
                )}
              </>
            )
          )}

          {editingQualification && (
            <div className="mt-2">
              <QualifyPanel lead={lead} />
            </div>
          )}
        </section>
        </div>

        {/* ── Right column ──────────────────────────────────────────── */}
        <div className="space-y-3">
          {/* Next action */}
          <section className="rounded-xl border border-border-subtle bg-bg-surface p-4">
            <header className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-body-sm font-semibold text-text-primary">Next action</h3>
              <button
                type="button"
                onClick={() => onTab('followups')}
                className="text-caption font-medium text-text-brand underline-offset-2 hover:underline"
              >
                Edit
              </button>
            </header>

            {lead.nextAction ? (
              <div className="rounded-xl border border-accent-primary/20 bg-accent-primary/5 p-3">
                <p className="text-body-sm font-semibold text-text-primary">{lead.nextAction}</p>
                {lead.nextActionAt && (
                  <p className="mt-0.5 text-caption font-medium text-text-brand">
                    {/* The reference's own wording: "Tue 15 Sep 2026 at 10:00 AM". */}
                    {new Date(lead.nextActionAt).toLocaleDateString('en-GB', {
                      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                      timeZone: 'Asia/Karachi',
                    })}
                    {' at '}
                    {new Date(lead.nextActionAt).toLocaleTimeString('en-US', {
                      hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi',
                    })}
                  </p>
                )}
                {lead.nextActionType && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-caption text-text-secondary">
                    {lead.nextActionType === 'whatsapp' && (
                      <span style={{ color: WA_GREEN }}><WhatsAppMark className="size-4" /></span>
                    )}
                    {channelLabel(lead.nextActionType)}
                  </p>
                )}
                {/* ⚠️ THE SEQUENCE STEP, only when a sequence is actually running.
                    "Step 1 of 3" on a lead with no sequence is a number somebody
                    would act on. */}
                {related.sequence && (
                  <p className="mt-1 text-caption text-text-secondary">
                    Step {related.sequence.step} of {related.sequence.total}
                    {related.sequence.state === 'paused' && related.sequence.pauseReason && (
                      <span className="ml-1 text-text-primary">
                        · paused, {related.sequence.pauseReason}
                      </span>
                    )}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => onTab('followups')}
                  className="mt-3 w-full rounded-lg bg-accent-primary px-3 py-2 text-body-sm font-semibold text-white transition-opacity hover:opacity-90"
                >
                  Mark as done
                </button>

                {/* ⚠️ ONLY WHEN A SEQUENCE IS ACTUALLY RUNNING. "View sequence" on
                    a lead with none is a link to an empty screen. */}
                {related.sequence && (
                  <button
                    type="button"
                    onClick={() => onTab('followups')}
                    className="mt-2 flex w-full items-center justify-center gap-1 text-caption font-medium text-text-brand underline-offset-2 hover:underline"
                  >
                    View sequence <ArrowRight className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            ) : (
              /* ⚠️ NOT "No next action" ALONE. 640 of 641 leads are in exactly
                 this state, and it is the single commonest fault in the data — so
                 it says what it costs. */
              <p className="rounded-xl border border-dashed border-border-default px-3 py-2.5 text-caption leading-relaxed text-text-secondary">
                Nothing planned. A lead with no next action is one nobody is coming
                back to.
              </p>
            )}
          </section>

          {/* Personal note */}
          <section className="rounded-xl border border-border-subtle bg-bg-surface p-4">
            <header className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-body-sm font-semibold text-text-primary">Personal note</h3>
              <button
                type="button"
                onClick={() => onTab('activity')}
                className="text-caption font-medium text-text-brand underline-offset-2 hover:underline"
              >
                {!loading && notes.length > 1 ? `All ${notes.length}` : 'Edit'}
              </button>
            </header>
            {loading ? (
              <p className="text-caption text-text-secondary">Loading…</p>
            ) : notes.length === 0 ? (
              <p className="text-caption text-text-secondary">Nothing written yet.</p>
            ) : (
              <div className="flex items-start gap-2.5 rounded-xl border border-gold-200 bg-gold-100/60 px-3 py-2.5">
                <FileText className="mt-0.5 size-4 shrink-0 text-gold-700" aria-hidden="true" />
                <p className="min-w-0 whitespace-pre-wrap text-body-sm leading-relaxed text-text-primary">
                  {notes[0].body}
                </p>
              </div>
            )}
          </section>

          {/* Recent activity */}
          <section className="rounded-xl border border-border-subtle bg-bg-surface p-4">
            <header className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-body-sm font-semibold text-text-primary">Recent activity</h3>
              <button
                type="button"
                onClick={() => onTab('activity')}
                className="text-caption font-medium text-text-brand underline-offset-2 hover:underline"
              >
                View all
              </button>
            </header>
            {loading ? (
              <p className="text-caption text-text-secondary">Loading…</p>
            ) : activity.length === 0 ? (
              <p className="text-caption text-text-secondary">Nothing recorded yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {activity.slice(0, 3).map((e) => (
                  <li key={e.id} className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-bg-subtle text-text-secondary">
                      <FileText className="size-3" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-body-sm font-medium text-text-primary">
                        {activityLabel(e.kind)}
                      </span>
                      <span className="block text-caption text-text-secondary">
                        {new Date(e.occurredAt).toLocaleString('en-GB', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          timeZone: 'Asia/Karachi',
                        })}
                        {e.actorName && ` · ${e.actorName}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ⚠️ The current step wears the lead's OWN stage name where the group covers more
   than one. Step 4 is "Quotation sent" in the design, but a lead sitting at
   `proposal_pending` has not sent one, and saying it had would be the drawer
   reporting progress that did not happen. */
function currentLabel(stage: string, fallback: string): string {
  /* Only where one step covers more than one stage. `Visit` is the single
     group left, now that proposal and quotation have a step each. */
  if (stage === 'visit_scheduled') return 'Visit scheduled';
  if (stage === 'visited') return 'Visited';
  return fallback;
}

function Row({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Home;
  label: string;
  value: string | null;
  href?: string | null;
}) {
  /* ⚠️ A ROW WITH NOTHING IN IT IS NOT DRAWN. A column of "—" reads as a broken
     record; an absent line reads as a fact nobody has recorded yet. */
  if (!value) return null;

  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-text-secondary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <dt className="text-caption text-text-secondary">{label}</dt>
        <dd className="text-body-sm text-text-primary">
          {href ? (
            <a href={href} className="text-text-brand underline-offset-2 hover:underline">
              {value}
            </a>
          ) : (
            value
          )}
        </dd>
      </div>
    </div>
  );
}
