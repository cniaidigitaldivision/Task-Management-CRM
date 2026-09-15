'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Info, Shuffle, X } from 'lucide-react';

import { checkDuplicatesAction, createLeadAction } from '@/app/actions/crm-leads';
import { useToast } from '@/components/ui/toast';
import type { CrmDuplicate } from '@/lib/db/queries/crm-leads';
import {
  ADD_LEAD_SOURCES,
  PREFERRED_CHANNELS,
  duplicateVerdict,
  newLeadProblems,
  phoneWarning,
} from '@/lib/domain/crm-new-lead';
import { sourceLabel } from '@/lib/domain/lead-source';
import { stageLabel } from '@/lib/domain/crm-stages';
import { cn } from '@/lib/utils';

/* ============================================================================
 * ADD LEAD — a walk-in, a referral, a phone call
 * ----------------------------------------------------------------------------
 * ── ⚠️ THERE IS NO OWNER FIELD, AND THE FORM SAYS SO OUT LOUD ──────────────
 * The owner's rule: *"The salesperson must not select an owner."* A form that
 * simply omitted the control would look like an oversight and somebody would
 * ask for it back; one that says "the rota will choose, and you will be told
 * why" is a decision. The absence is enforced three layers down — this component
 * has no field, the action has no argument, and `app.crm_create_lead` has no
 * parameter to receive one.
 *
 * ── ⚠️ THE DUPLICATE CHECK RUNS BEFORE SAVE, NOT AFTER ─────────────────────
 * The spec's order: *"Before creation: normalize phone and email; check
 * duplicates; check whether an open lead exists."* Finding out afterwards is
 * useless — the second lead already exists by then, and somebody has to go and
 * delete it, which only an Admin can do (124).
 *
 * ── ⚠️ AND ONE FINDING CANNOT BE OVERRIDDEN ────────────────────────────────
 * An OPEN lead for this person, on this project, belonging to somebody else.
 * The database refuses it outright (CRM05) and so does this. Everything softer —
 * a closed lead, a past customer, an enquiry on another project — is shown and
 * then allowed, because those are real and common.
 *
 * ── ⚠️ NOTHING TYPED IS EVER THROWN AWAY ───────────────────────────────────
 * The owner's standing rule since the team forms: *"I don't need to enter it
 * again and again."* Every refusal leaves the panel open with every field as it
 * was.
 * ========================================================================= */

export interface AddLeadProject {
  readonly id: string;
  readonly name: string;
}

export interface AddLeadProperty {
  readonly id: string;
  readonly label: string;
  readonly status: string;
}

export function AddLead({
  projects,
  properties,
  defaultProjectId,
  onClose,
}: {
  projects: readonly AddLeadProject[];
  /**
   * The catalogue for `defaultProjectId` only.
   *
   * ⚠️ WHICH PROJECT IT BELONGS TO MATTERS. `crm_leads.property_id` references
   * `crm_properties` and nothing else, so a plot from one project can be
   * attached to another project's lead and every later quotation, payment plan
   * and price describes a property the client was never shown. The field is
   * hidden the moment the chosen project stops matching, and the database
   * refuses it anyway (CRM07).
   */
  properties: readonly AddLeadProperty[];
  defaultProjectId: string | null;
  /** Hides the dialog at once. The URL catches up in the parent. */
  onClose: () => void;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();

  /* ⚠️ NO ALPHABETICAL DEFAULT. The picker holds every project this department
     leads — fourteen of them, most belonging to real clients — and preselecting
     whichever sorts first is how a walk-in typed in a hurry lands on somebody
     else's live project. It defaults only to the project already in view, which
     is a choice the person made; otherwise they choose. */
  const [projectId, setProjectId] = React.useState(defaultProjectId ?? '');
  const [fullName, setFullName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [city, setCity] = React.useState('');
  const [source, setSource] = React.useState('walk_in');
  const [sourceDetail, setSourceDetail] = React.useState('');
  const [enquiry, setEnquiry] = React.useState('');
  const [propertyId, setPropertyId] = React.useState('');
  const [budget, setBudget] = React.useState('');
  /* ⚠️ NULL, NOT FALSE. Nobody has been asked yet, and that is a different fact
     from "they said no" — the sequence engine reads this column before it may
     send, and a default of false would record a refusal nobody gave. */
  const [whatsappConsent, setWhatsappConsent] = React.useState<boolean | null>(null);
  const [preferredChannel, setPreferredChannel] = React.useState<string | null>(null);
  const [preferredTime, setPreferredTime] = React.useState('');
  const [nextAction, setNextAction] = React.useState('');
  const [nextActionType, setNextActionType] = React.useState('call');
  const [nextActionAt, setNextActionAt] = React.useState('');

  const [dupes, setDupes] = React.useState<readonly CrmDuplicate[]>([]);
  const [checking, setChecking] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  /* ── Who do we already know? ──────────────────────────────────────────────
     ⚠️ DEBOUNCED, AND THE LATE ANSWER IS DISCARDED. A phone field fires a lot of
     changes, and without the `live` guard an earlier, slower reply can land
     after a later one and put a stale warning on the screen — which here would
     mean warning about a person whose number has since been corrected. */
  React.useEffect(() => {
    const p = phone.trim();
    const e = email.trim();
    const worthAsking = Boolean(projectId) && (p.length >= 7 || e.includes('@'));

    let live = true;
    /* ⚠️ EVERY setState HAPPENS IN THE TIMER, NOT IN THE EFFECT BODY. Clearing
       synchronously here fired a second render on every keystroke — and on a
       field somebody types a phone number into, that is a cascade React lints
       against for good reason. */
    const timer = setTimeout(() => {
      if (!live) return;
      if (!worthAsking) {
        setDupes([]);
        setChecking(false);
        return;
      }
      setChecking(true);
      void checkDuplicatesAction(projectId, p, e)
        .then((r) => {
          if (!live) return;
          setDupes(r.duplicates);
          setAcknowledged(false);
        })
        .finally(() => {
          if (live) setChecking(false);
        });
    }, 450);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [projectId, phone, email]);

  const input = {
    projectId,
    fullName,
    phone,
    email,
    city,
    source,
    sourceDetail,
    enquiry,
    budget,
    whatsappConsent,
    preferredChannel,
    preferredTime,
    nextAction,
    nextActionAt: nextActionAt ? new Date(nextActionAt).toISOString() : null,
    nextActionType: nextAction.trim() ? nextActionType : null,
  };

  const problems = newLeadProblems(input);
  const caveat = phoneWarning(phone);
  const verdict = duplicateVerdict(
    dupes.map((d) => ({
      kind: d.kind,
      name: d.name,
      projectName: d.projectName,
      sameProject: d.sameProject,
      isOpen: d.isOpen,
      isMine: d.isMine,
      ownerName: d.ownerName,
      stage: d.stage,
    })),
  );

  const blocked = verdict.verdict === 'blocked';
  const mustAcknowledge = verdict.verdict === 'confirm' && !acknowledged;
  const canSave = !busy && problems.length === 0 && !blocked && !mustAcknowledge;

  /* Why the button is off, in the order somebody meets it. The hard refusal
     first — it is the one no amount of filling in will clear. */
  const blockedBy = blocked
    ? verdict.message
    : mustAcknowledge
      ? 'Read the note above and confirm this is a new enquiry.'
      : (problems[0] ?? null);

  /* ⚠️ THE PARENT OWNS WHETHER THIS IS ON SCREEN, and it is a client component,
     so the cross takes effect in the click's own frame. This used to re-render
     the entire page — every query on it — to take a dialog off the screen. */
  const close = onClose;

  /* Escape closes, on the same instant path. A dialog that can only be
     dismissed by hitting a small target is one people fight with. */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    setBusy(true);
    const result = await createLeadAction({
      ...input,
      propertyId: propertyId || null,
      /* ⚠️ Only ever true for a finding the person was actually shown. It can
         never get past a colleague's open lead — the database refuses that
         whatever this says. */
      allowDuplicate: acknowledged,
    });
    setBusy(false);

    if (!result.ok) {
      toast({ tone: 'error', text: result.error ?? 'That did not save.' });
      return;
    }

    /* ⚠️ THE CONFIRMATION NAMES WHO GOT IT AND WHY. A rota nobody can interrogate
       is one people stop trusting, and this is the moment the question is
       actually being asked. */
    toast({
      tone: 'ok',
      text: result.ownerName
        ? `${fullName.trim()} added — ${result.ownerName} is working it.`
        : `${fullName.trim()} added. Nobody was available, so it is waiting to be shared out.`,
    });

    onClose();
    const next = new URLSearchParams(search.toString());
    next.delete('action');
    if (result.id) next.set('lead', result.id);
    router.push(`/my-leads?${next.toString()}` as Route);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={close}
        className="absolute inset-0 bg-black/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add a lead"
        className="relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border-default bg-bg-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-body font-semibold text-text-primary">Add a lead</h2>
            <p className="mt-0.5 text-caption text-text-secondary">
              A walk-in, a referral, or somebody who called.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Cancel"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-bg-subtle"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* ── The person ──────────────────────────────────────────────── */}
          <Section title="The person">
            <Field label="Project">
              <select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  /* ⚠️ THE UNIT IS DROPPED WITH THE PROJECT. Keeping it would
                     carry a plot from the old project into the new one — which
                     the database now refuses (CRM07), but a refusal on save is
                     a worse experience than a field that quietly stays true. */
                  setPropertyId('');
                }}
                className={control}
              >
                <option value="">
                  {projects.length === 0 ? 'No project available' : 'Choose a project…'}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Full name">
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ayesha Khan"
                className={control}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone">
                <input
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0300 1234567"
                  className={control}
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ayesha@example.com"
                  className={control}
                />
              </Field>
            </div>

            {caveat && (
              <p className="flex items-start gap-1.5 text-caption leading-relaxed text-text-secondary">
                <Info className="mt-0.5 size-3.5 shrink-0 text-gold-700" />
                {caveat}
              </p>
            )}

            <Field label="City">
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Islamabad"
                className={control}
              />
            </Field>
          </Section>

          {/* ── Do we know them already? ────────────────────────────────── */}
          {checking && (
            <p className="text-caption text-text-tertiary">Checking whether we know them…</p>
          )}

          {dupes.length > 0 && (
            <div
              className={cn(
                'space-y-2 rounded-xl border px-3 py-3',
                blocked
                  ? 'border-feedback-error/40 bg-[color-mix(in_oklab,var(--feedback-error)_7%,transparent)]'
                  : 'border-gold-700/40 bg-[color-mix(in_oklab,var(--gold-700)_8%,transparent)]',
              )}
            >
              <p className="flex items-start gap-1.5 text-caption font-medium leading-relaxed text-text-primary">
                <AlertTriangle
                  className={cn(
                    'mt-0.5 size-3.5 shrink-0',
                    blocked ? 'text-feedback-error' : 'text-gold-700',
                  )}
                />
                {verdict.message}
              </p>

              <ul className="space-y-1">
                {dupes.map((d) => (
                  <li key={`${d.kind}-${d.id}`} className="text-caption text-text-secondary">
                    <span className="text-text-primary">{d.name}</span>
                    {d.kind === 'client'
                      ? ' · bought from us before'
                      : ` · ${d.projectName ?? 'a project'}${
                          d.stage ? ` · ${stageLabel(d.stage)}` : ''
                        }${d.ownerName ? ` · ${d.isMine ? 'yours' : d.ownerName}` : ' · unassigned'}`}
                    <span className="text-text-tertiary"> · matched on {d.matchedOn}</span>
                  </li>
                ))}
              </ul>

              {verdict.verdict === 'confirm' && (
                <label className="flex items-start gap-2 pt-1">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="mt-0.5 size-4 rounded border-border-default"
                  />
                  <span className="text-caption leading-relaxed text-text-primary">
                    I have read this and this is a new enquiry.
                  </span>
                </label>
              )}
            </div>
          )}

          {/* ── Where it came from ──────────────────────────────────────── */}
          <Section title="Where it came from">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Channel">
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className={control}
                >
                  {ADD_LEAD_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {sourceLabel(s)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Detail">
                <input
                  type="text"
                  value={sourceDetail}
                  onChange={(e) => setSourceDetail(e.target.value)}
                  placeholder="Showroom desk"
                  className={control}
                />
              </Field>
            </div>
          </Section>

          {/* ── What they want ──────────────────────────────────────────── */}
          <Section title="What they asked about">
            {properties.length > 0 && projectId === defaultProjectId && (
              <Field label="Unit">
                <select
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                  className={control}
                >
                  <option value="">Not decided yet</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.status !== 'available' ? ` — ${p.status}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Budget (PKR)">
              <input
                type="text"
                inputMode="numeric"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="12,000,000"
                className={control}
              />
            </Field>

            <Field label="The enquiry, in their words">
              <textarea
                value={enquiry}
                onChange={(e) => setEnquiry(e.target.value)}
                rows={3}
                placeholder="Asked about a 5 marla corner plot, wants to visit on Saturday."
                className="w-full rounded-xl border border-border-subtle bg-bg-surface px-3 py-2 text-body-sm text-text-primary"
              />
            </Field>
          </Section>

          {/* ── How to reach them ───────────────────────────────────────── */}
          <Section title="How to reach them">
            {/* ⚠️ THREE BUTTONS, NOT A CHECKBOX. A tickbox has two states and
                this question has three — and "nobody asked" is the one the
                sequence engine must be able to tell from "they said no", because
                only one of those is a refusal it has to honour. */}
            <Field label="Did they agree to WhatsApp?">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    [true, 'Yes, they agreed'],
                    [false, 'No'],
                    [null, 'Not asked yet'],
                  ] as const
                ).map(([value, label]) => {
                  const on = whatsappConsent === value;
                  return (
                    <button
                      key={String(value)}
                      type="button"
                      onClick={() => setWhatsappConsent(value)}
                      aria-pressed={on}
                      className={cn(
                        'rounded-lg border px-2.5 py-1.5 text-caption font-medium transition-colors',
                        on
                          ? 'border-accent-primary bg-[color-mix(in_oklab,var(--accent-primary)_14%,transparent)] text-accent-primary'
                          : 'border-border-subtle text-text-secondary hover:bg-bg-subtle',
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-caption leading-relaxed text-text-secondary">
                A follow-up sequence cannot send on WhatsApp without this. It is what we point at
                if somebody asks why a business is messaging them.
              </p>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="They prefer">
                <select
                  value={preferredChannel ?? ''}
                  onChange={(e) => setPreferredChannel(e.target.value || null)}
                  className={control}
                >
                  <option value="">No preference</option>
                  {PREFERRED_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {c === 'whatsapp' ? 'WhatsApp' : c === 'call' ? 'A call' : 'Email'}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Best time">
                <input
                  type="text"
                  value={preferredTime}
                  onChange={(e) => setPreferredTime(e.target.value)}
                  placeholder="Evenings, not Fridays"
                  className={control}
                />
              </Field>
            </div>
          </Section>

          {/* ── What happens next ───────────────────────────────────────── */}
          <Section title="What happens next">
            <Field label="Next action">
              <input
                type="text"
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                placeholder="Call back about the corner plot"
                className={control}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="How">
                <select
                  value={nextActionType}
                  onChange={(e) => setNextActionType(e.target.value)}
                  className={control}
                >
                  <option value="call">Call</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="meeting">Meeting</option>
                  <option value="site_visit">Site visit</option>
                  <option value="task">Task</option>
                </select>
              </Field>
              <Field label="When">
                <input
                  type="datetime-local"
                  value={nextActionAt}
                  onChange={(e) => setNextActionAt(e.target.value)}
                  className={control}
                />
              </Field>
            </div>
          </Section>

          {/* ── Who gets it ─────────────────────────────────────────────── */}
          {/* ⚠️ SAID OUT LOUD RATHER THAN LEFT AS A MISSING FIELD. An absent
              dropdown reads as an oversight somebody will ask to have put back;
              a sentence reads as a decision, and names what happens instead. */}
          <p className="flex items-start gap-2 rounded-xl border border-border-subtle bg-bg-subtle px-3 py-2.5 text-caption leading-relaxed text-text-secondary">
            <Shuffle className="mt-0.5 size-3.5 shrink-0 text-text-tertiary" />
            <span>
              The rota chooses who works this lead — whoever is on shift with the lightest load and
              the fastest recent replies. You will be told who got it, and why.
            </span>
          </p>

          {problems.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-feedback-error/40 bg-[color-mix(in_oklab,var(--feedback-error)_7%,transparent)] px-3 py-2">
              {problems.map((p) => (
                <li key={p} className="flex items-start gap-1.5 text-caption text-text-primary">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-feedback-error" />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ⚠️ THE REASON TRAVELS WITH THE BUTTON. The problems list sits at the
            bottom of a scrolling panel, three sections below the fold — so on
            an unfilled form somebody saw a greyed-out "Add lead" and no
            explanation anywhere on screen. A disabled control with its reason
            out of sight is the exact refusal-without-a-reason this form was
            written to avoid. Found by looking at it, not by reading it. */}
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 border-t border-border-subtle px-5 py-3">
          {blockedBy && (
            <p
              className={cn(
                'mr-auto flex min-w-0 items-start gap-1.5 text-caption leading-snug',
                blocked ? 'text-feedback-error' : 'text-text-secondary',
              )}
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{blockedBy}</span>
            </p>
          )}
          <button
            type="button"
            onClick={close}
            className="min-h-[2.4rem] rounded-xl px-3 text-body-sm font-medium text-text-secondary hover:bg-bg-subtle"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className={cn(
              'min-h-[2.4rem] rounded-xl bg-accent-primary px-4 text-body-sm font-medium text-white transition-opacity',
              !canSave && 'opacity-40',
            )}
          >
            {busy ? 'Adding…' : 'Add lead'}
          </button>
        </div>
      </div>
    </div>
  );
}

const control =
  'min-h-[2.4rem] w-full rounded-xl border border-border-subtle bg-bg-surface px-3 text-body-sm text-text-primary';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-border-subtle px-3 py-3">
      <legend className="px-1 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-micro font-semibold uppercase tracking-wide text-text-tertiary">
        {label}
      </span>
      {children}
    </label>
  );
}
