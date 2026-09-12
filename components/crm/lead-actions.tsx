'use client';

import * as React from 'react';
import { Trash2 } from 'lucide-react';

import {
  addNoteAction,
  assignLeadAction,
  deleteNoteAction,
  logContactAction,
  setNextActionAction,
  setStageAction,
  setTemperatureAction,
  shareOutLeadsAction,
  type LeadWriteResult,
} from '@/app/actions/crm-leads';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import {
  LOST_REASONS,
  STAGE_ORDER,
  TEMPERATURES,
  lostReasonLabel,
  stageLabel,
  temperatureLabel,
} from '@/lib/domain/crm-stages';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WORKING A LEAD — the controls
 * ----------------------------------------------------------------------------
 * Step 6. Everything on this page that saves is in this file, and everything in
 * `lead-record.tsx` reads. Keeping the split at the file boundary is what makes
 * "does this screen write?" answerable by looking at the imports.
 *
 * ── ⚠️ THE SERVER'S COPY IS THE ONE ON SCREEN ──────────────────────────────
 * Every action revalidates and the page re-renders from the database. Nothing
 * here keeps a local copy of the lead and patches it — two people working the
 * same lead would drift, and the one who drifted would be the one who believed
 * their screen. The cost is a round trip; the alternative is a screen that is
 * confidently wrong.
 *
 * ── ⚠️ AND A FAILURE IS SAID OUT LOUD ──────────────────────────────────────
 * Every result is checked and a refusal becomes a toast. An action whose error
 * is dropped leaves a control that looks like it worked, which on a stage change
 * means somebody believes a lead moved when it did not.
 * ========================================================================= */

/** One place to run an action, so no caller can forget to report a refusal. */
function useAction(): [boolean, (run: () => Promise<LeadWriteResult>, done?: () => void) => void] {
  const [pending, start] = React.useTransition();
  const toast = useToast();

  const go = React.useCallback(
    (run: () => Promise<LeadWriteResult>, done?: () => void) => {
      start(async () => {
        const result = await run();
        if (!result.ok) {
          toast({ tone: 'error', text: result.error ?? 'That did not save.' });
          return;
        }
        done?.();
      });
    },
    [toast],
  );

  return [pending, go];
}

/* ---- Stage ---------------------------------------------------------------- */

/**
 * ⚠️ MOVING TO LOST DOES NOT SAVE ON THE SELECT. Every other stage saves the
 * moment it is picked, because the change is one decision and it is reversible.
 * `lost` is two decisions — that it is lost, and why — and the why is what makes
 * the lost-reason report worth reading. Saving on the select would either refuse
 * (the constraint in 111) or need a reason invented for it.
 */
export function StageControl({
  leadId,
  stage,
  lostReason,
}: {
  leadId: string;
  stage: string;
  lostReason: string | null;
}) {
  const [pending, go] = useAction();
  const [draft, setDraft] = React.useState(stage);
  const [reason, setReason] = React.useState(lostReason ?? '');

  /* The server's value is the truth: after a save the page re-renders and the
     prop changes. Compared against the prop rather than synced in an effect,
     which would paint the stale value once first. */
  const [lastStage, setLastStage] = React.useState(stage);
  if (lastStage !== stage) {
    setLastStage(stage);
    setDraft(stage);
    setReason(lostReason ?? '');
  }

  const needsReason = draft === 'lost';

  return (
    <Field label="Stage">
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          label="Stage"
          value={draft}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            if (next !== 'lost') go(() => setStageAction(leadId, next, null));
          }}
        >
          {STAGE_ORDER.map((s) => (
            <option key={s} value={s}>
              {stageLabel(s)}
            </option>
          ))}
        </Select>

        {needsReason && (
          <>
            <Select
              label="Why it was lost"
              value={reason}
              disabled={pending}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="">Why?</option>
              {LOST_REASONS.map((r) => (
                <option key={r} value={r}>
                  {lostReasonLabel(r)}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="primary"
              disabled={pending || reason === ''}
              onClick={() => go(() => setStageAction(leadId, 'lost', reason))}
            >
              Mark lost
            </Button>
          </>
        )}
      </div>
    </Field>
  );
}

/* ---- Temperature ---------------------------------------------------------- */

/** ⚠️ Pressing the one already set CLEARS it. "Cold" and "not judged yet" are
 *  different facts, and without a way back the first mis-click would be
 *  permanent — which is how a column fills up with values nobody trusts. */
export function TemperatureControl({
  leadId,
  temperature,
}: {
  leadId: string;
  temperature: string | null;
}) {
  const [pending, go] = useAction();

  return (
    <Field label="Temperature">
      <div className="flex flex-wrap items-center gap-1.5">
        {TEMPERATURES.map((t) => {
          const on = temperature === t;
          return (
            <Button
              key={t}
              size="sm"
              variant={on ? 'primary' : 'secondary'}
              disabled={pending}
              aria-pressed={on}
              onClick={() => go(() => setTemperatureAction(leadId, on ? null : t))}
            >
              {temperatureLabel(t)}
            </Button>
          );
        })}
        {temperature === null && (
          <span className="text-caption text-text-secondary">Not judged yet</span>
        )}
      </div>
    </Field>
  );
}

/* ---- Next action ---------------------------------------------------------- */

export function NextActionControl({
  leadId,
  action,
  dueDate,
}: {
  leadId: string;
  action: string | null;
  /** `YYYY-MM-DD` in Karachi, resolved on the server. */
  dueDate: string | null;
}) {
  const [pending, go] = useAction();
  const [text, setText] = React.useState(action ?? '');
  const [due, setDue] = React.useState(dueDate ?? '');

  const [last, setLast] = React.useState(`${action ?? ''}|${dueDate ?? ''}`);
  const current = `${action ?? ''}|${dueDate ?? ''}`;
  if (last !== current) {
    setLast(current);
    setText(action ?? '');
    setDue(dueDate ?? '');
  }

  const dirty = text !== (action ?? '') || due !== (dueDate ?? '');

  return (
    <Field label="Next action">
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          go(() => setNextActionAction(leadId, text, due));
        }}
      >
        <Input
          size="sm"
          value={text}
          disabled={pending}
          onChange={(e) => setText(e.target.value)}
          placeholder="Call back about the corner plot…"
          aria-label="What is owed on this lead"
          className="w-[18rem]"
        />
        <input
          type="date"
          value={due}
          disabled={pending}
          onChange={(e) => setDue(e.target.value)}
          aria-label="When it is due"
          className="min-h-[2.2rem] rounded-lg border border-border-subtle bg-bg-surface px-2 text-micro text-text-primary focus:border-accent-primary focus:outline-none"
        />
        <Button size="sm" type="submit" variant="primary" disabled={pending || !dirty}>
          Save
        </Button>
        {(action !== null || dueDate !== null) && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => go(() => setNextActionAction(leadId, '', ''))}
          >
            Clear
          </Button>
        )}
      </form>
    </Field>
  );
}

/* ---- Logging what happened ------------------------------------------------ */

/**
 * ⚠️ THE ONLY THING ON THIS PAGE THAT STAMPS RESPONSE TIME — through 116's
 * trigger, from `occurred_at`. It is also why the call and WhatsApp links in the
 * header are LINKS: opening a chat is not evidence a message was sent, and a
 * timeline that recorded the click would credit work nobody did.
 *
 * ⚠️ "No answer" is here and it counts as contact. It measures OUR
 * responsiveness, not the lead's — somebody who rang within four minutes and got
 * no answer responded in four minutes.
 */
const LOGGABLE = [
  { kind: 'call_connected', label: 'Spoke to them' },
  { kind: 'call_no_answer', label: 'No answer' },
  { kind: 'call_attempted', label: 'Tried to call' },
  { kind: 'whatsapp_sent', label: 'WhatsApp sent' },
  { kind: 'email_sent', label: 'Email sent' },
] as const;

export function LogContactControl({ leadId }: { leadId: string }) {
  const [pending, go] = useAction();
  const [outcome, setOutcome] = React.useState('');

  return (
    <Field label="Log what happened">
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          size="sm"
          value={outcome}
          disabled={pending}
          onChange={(e) => setOutcome(e.target.value)}
          placeholder="Asked to call Friday… (optional)"
          aria-label="What came of it"
          className="w-[18rem]"
        />
        {LOGGABLE.map((l) => (
          <Button
            key={l.kind}
            size="sm"
            disabled={pending}
            onClick={() => go(() => logContactAction(leadId, l.kind, outcome), () => setOutcome(''))}
          >
            {l.label}
          </Button>
        ))}
      </div>
    </Field>
  );
}

/* ---- Notes ---------------------------------------------------------------- */

export function NoteComposer({ leadId }: { leadId: string }) {
  const [pending, go] = useAction();
  const [body, setBody] = React.useState('');

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        go(() => addNoteAction(leadId, body), () => setBody(''));
      }}
    >
      <textarea
        value={body}
        disabled={pending}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="What was discussed, what quotation was given…"
        aria-label="Add a note"
        className="w-full rounded-xl border border-border-subtle bg-bg-surface px-3 py-2 text-body-sm text-text-primary transition-colors placeholder:text-text-tertiary hover:border-border-default focus:border-accent-primary focus:outline-none"
      />
      <div className="flex items-center justify-between gap-2">
        {/* ⚠️ Says what a note IS, because the alternative is somebody using it
            for the next action and nobody being reminded. */}
        <p className="text-micro text-text-secondary">
          Notes stay on the record. They cannot be edited afterwards.
        </p>
        <Button size="sm" type="submit" variant="primary" disabled={pending || body.trim() === ''}>
          Add note
        </Button>
      </div>
    </form>
  );
}

/**
 * ⚠️ REMOVES THE TEXT, NOT THE FACT. `crm_lead_activity` has no delete policy at
 * any rank, so the "Note added" entry stays on the timeline — what somebody
 * withdrew is gone, that something was written at that hour is not.
 */
export function NoteDeleteButton({
  leadId,
  noteId,
  canDelete,
}: {
  leadId: string;
  noteId: string;
  canDelete: boolean;
}) {
  const [pending, go] = useAction();
  const [armed, setArmed] = React.useState(false);

  if (!canDelete) return null;

  /* Two presses, no dialog. ⚠️ A `confirm()` would block every browser event and
     take the extension with it; a dialog for one line of text is heavier than
     the thing it guards. */
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => (armed ? go(() => deleteNoteAction(leadId, noteId)) : setArmed(true))}
      onBlur={() => setArmed(false)}
      aria-label={armed ? 'Press again to remove this note' : 'Remove this note'}
      title={armed ? 'Press again to remove' : 'Remove this note'}
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-md transition-colors',
        armed
          ? 'bg-feedback-error text-neutral-0'
          : 'text-text-tertiary hover:bg-bg-subtle hover:text-text-primary',
      )}
    >
      <Trash2 className="size-3.5" aria-hidden="true" />
    </button>
  );
}

/* ---- Who holds it --------------------------------------------------------- */

export interface OwnerOption {
  readonly id: string;
  readonly name: string;
  readonly openLeads: number;
  readonly isManager: boolean;
}

/**
 * ⚠️ RENDERED ONLY FOR SOMEBODY WHO MAY REASSIGN — the record decides that by
 * passing an empty list. Migration 120's trigger refuses a salesperson whatever
 * the screen shows, so the worst a mistake here could do is draw a control that
 * then refuses; it could never hand out a lead that should not move.
 *
 * ⚠️ AND THE OPEN COUNT IS ON EVERY NAME. The manager is choosing between
 * people, and "Sale Tester · 12 open" is the fact that decision turns on. Making
 * them go and look it up elsewhere is how a lead lands on whoever is top of an
 * alphabetical list.
 */
export function OwnerControl({
  leadId,
  leadName,
  ownerId,
  owners,
}: {
  leadId: string;
  leadName: string;
  ownerId: string | null;
  owners: readonly OwnerOption[];
}) {
  const [pending, go] = useAction();

  if (owners.length === 0) return null;

  return (
    <Field label="Owner">
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          label="Who works this lead"
          value={ownerId ?? ''}
          disabled={pending}
          onChange={(e) => go(() => assignLeadAction(leadId, e.target.value || null, leadName))}
        >
          <option value="">Nobody yet</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.isManager ? ' (manager)' : ''} · {o.openLeads} open
            </option>
          ))}
        </Select>
        {ownerId === null && (
          <span className="text-caption text-text-secondary">
            Nobody has been asked to ring this person yet.
          </span>
        )}
      </div>
    </Field>
  );
}

/**
 * Share the unassigned leads out across the sales team.
 *
 * ⚠️ THE RULE IS SHOWN, NOT HIDDEN. "Fewest open leads first, then whoever
 * waited longest" is one sentence, and printing it is what lets a salesperson
 * check the rota rather than suspect it. `07-AI-PLAN.md`: a conclusion nobody
 * can reconstruct gets ignored the first time it disagrees with somebody's gut.
 *
 * ⚠️ AND IT IS CAPPED. Sharing out all 615 would be one irreversible click and
 * 615 notifications; the count is chosen deliberately each time.
 */
export function ShareOutControl({
  projectId,
  unassigned,
  salesTeam,
}: {
  projectId: string;
  unassigned: number;
  salesTeam: number;
}) {
  const [pending, start] = React.useTransition();
  const toast = useToast();
  const [count, setCount] = React.useState(10);

  if (unassigned === 0) return null;

  /* ⚠️ Said plainly rather than drawn as a disabled button somebody has to guess
     about — with nobody in Sales the rota has nowhere to put anything. */
  if (salesTeam === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border-default bg-bg-surface px-4 py-2.5 text-caption leading-relaxed text-text-secondary">
        <strong>{unassigned}</strong> {unassigned === 1 ? 'lead has' : 'leads have'} nobody working
        them, and there is nobody in the Sales department to give them to. Add somebody to Sales on
        the Team page first.
      </p>
    );
  }

  const take = Math.min(count, unassigned);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border-default bg-bg-surface px-4 py-2.5">
      <p className="min-w-0 flex-1 text-caption leading-relaxed text-text-secondary">
        <strong className="text-text-primary">{unassigned}</strong>{' '}
        {unassigned === 1 ? 'lead has' : 'leads have'} nobody working{' '}
        {unassigned === 1 ? 'it' : 'them'}. Sharing out gives each to whoever holds the{' '}
        <strong className="text-text-primary">fewest open leads</strong>, and on a tie to whoever
        has waited longest — oldest enquiry first.
      </p>

      <input
        type="number"
        min={1}
        max={Math.min(50, unassigned)}
        value={count}
        disabled={pending}
        onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
        aria-label="How many to share out"
        className="min-h-[2.2rem] w-[4.5rem] rounded-lg border border-border-subtle bg-bg-surface px-2 text-body-sm tabular-nums text-text-primary focus:border-accent-primary focus:outline-none"
      />

      <Button
        size="sm"
        variant="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await shareOutLeadsAction(projectId, take);
            if (!result.ok) {
              toast({ tone: 'error', text: result.error ?? 'Nothing was shared out.' });
              return;
            }
            toast({
              tone: 'ok',
              text: `Shared out ${result.assigned ?? take} ${(result.assigned ?? take) === 1 ? 'lead' : 'leads'}. Everybody has been told.`,
            });
          })
        }
      >
        {pending ? 'Sharing…' : `Share out ${take}`}
      </Button>
    </div>
  );
}

/* ---- Layout --------------------------------------------------------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start sm:gap-3">
      {/* ⚠️ Secondary, not tertiary — 3.94:1 measured in light. The key of a
          key/value pair is load-bearing; see the note in lead-record.tsx. */}
      <span className="pt-1.5 text-caption text-text-secondary">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
