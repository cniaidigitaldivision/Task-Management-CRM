'use client';

import * as React from 'react';
import { AlertTriangle, Info, Loader2, Plus, Trash2 } from 'lucide-react';

import { createInvoiceAction, type InvoiceResult } from '@/app/actions/invoices';
import type { BillingProfile } from '@/lib/db/queries/invoices';
import {
  INVOICE_KINDS,
  INVOICE_KIND_META,
  checkInvoice,
  dueDateFor,
  longDate,
  termsLabel,
  totalsFor,
  type InvoiceKind,
} from '@/lib/domain/invoice';
import { pkr, plain } from '@/lib/domain/money';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { SignaturePad, type SignaturePadHandle } from './signature-pad';

/* ============================================================================
 * RAISING AN INVOICE — owner request 2026-08-29
 * ----------------------------------------------------------------------------
 * *"Its form should be a very intelligent and very smart form. Specify which
 * project I am selecting, for example Daniyal Marketing. The client name should
 * auto-fill. If I select GC Royal the GC Royal member name should auto-fill
 * right over here, or I can add that name also."*
 *
 * ── ⚠️ WHAT "SMART" MEANS HERE: EVERY FIELD IS FILLED AND EVERY ONE IS STILL
 * EDITABLE. Choosing a project fills the billed-to name, the contact, the
 * address, the email, the payment terms, the due date and — for a monthly
 * invoice — the first line at the agreed fee. None of it is locked. A form that
 * guesses and then refuses to be corrected is worse than one that asks.
 *
 * ⚠️ AND IT NEVER OVERWRITES SOMETHING TYPED. `fillFrom` only writes into
 * fields still holding their auto-filled value. Somebody who corrects the
 * address and then changes the invoice type must not lose the correction — that
 * is the specific way "smart" forms become infuriating.
 *
 * ── ⚠️ THE TOTALS ARE COMPUTED BY THE SAME FUNCTION THE SERVER USES ────────
 * `totalsFor` from lib/domain/invoice.ts, not a sum written here. The preview a
 * person approves and the figure stored against the client are then the same
 * number by construction. A second implementation in the form is how a screen
 * comes to promise 165,000 and a PDF to say 164,999.
 *
 * ── ⚠️ ONE FORM, ONE ACT. THIS DOES NOT SEND. ──────────────────────────────
 * Owner chose *"issue, preview, then send"*. Pressing Create makes the invoice
 * and the PDF and nothing leaves the building; sending is a separate, deliberate
 * press on the row. An email to a client cannot be recalled.
 * ========================================================================= */

const EMPTY: InvoiceResult = { ok: false };

interface DraftLine {
  /** A stable key, so removing the second of three rows does not re-key the
   *  third and make React reuse the wrong input's DOM node — which loses focus
   *  and, worse, carries the removed row's text into the survivor. */
  readonly key: string;
  description: string;
  quantity: string;
  rate: string;
}

const newLine = (description = '', quantity = '1', rate = ''): DraftLine => ({
  key: Math.random().toString(36).slice(2),
  description,
  quantity,
  rate,
});

export function InvoiceDialog({
  projects,
  today,
  signerName,
  signerTitle,
  hasSavedSignature,
  defaultTaxRatePct,
  taxLabel,
  onClose,
  onDone,
}: {
  projects: readonly BillingProfile[];
  /** Karachi's today, from the server — see lib/now.ts on reading a clock. */
  today: string;
  signerName: string;
  signerTitle: string | null;
  hasSavedSignature: boolean;
  defaultTaxRatePct: number;
  taxLabel: string;
  onClose: () => void;
  onDone: (result: InvoiceResult) => void;
}) {
  const [state, formAction, pending] = React.useActionState(createInvoiceAction, EMPTY);
  const seen = React.useRef(false);
  const padRef = React.useRef<SignaturePadHandle>(null);

  const [kind, setKind] = React.useState<InvoiceKind>('retainer');
  const [projectId, setProjectId] = React.useState(projects[0]?.projectId ?? '');

  const [billedToName, setBilledToName] = React.useState('');
  const [billedToPerson, setBilledToPerson] = React.useState('');
  const [billedToEmail, setBilledToEmail] = React.useState('');
  const [billedToAddress, setBilledToAddress] = React.useState('');
  const [termsDays, setTermsDays] = React.useState('10');

  const [issuedOn, setIssuedOn] = React.useState(today);
  /* ── ⚠️ THE DUE DATE IS DERIVED, NOT STORED ───────────────────────
     It follows the issue date and the terms until somebody sets it by hand, and
     then it stops. The obvious shape is a `dueOn` state plus an effect that
     recomputes it — and that is a cascading render on every keystroke in the
     terms box, plus a value that is briefly stale on the render before the
     effect runs.

     So the state is only the OVERRIDE: null means "follow the terms", a string
     means "somebody chose this". `dueOn` is computed during render and can
     never be out of step with the two things it depends on. */
  const [dueOverride, setDueOverride] = React.useState<string | null>(null);

  const [lines, setLines] = React.useState<DraftLine[]>([newLine()]);
  const [taxOn, setTaxOn] = React.useState(false);
  const [taxRate, setTaxRate] = React.useState(String(defaultTaxRatePct));

  const [useSignature, setUseSignature] = React.useState(hasSavedSignature);
  const [drawInstead, setDrawInstead] = React.useState(false);
  const [padHasInk, setPadHasInk] = React.useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = React.useState('');

  const project = projects.find((p) => p.projectId === projectId) ?? null;

  const dueOn = dueOverride ?? dueDateFor(issuedOn, Number(termsDays) || 10);

  /* ── The auto-fill ────────────────────────────────────────────
     ⚠️ AN EVENT HANDLER, NOT AN EFFECT. Filling the form is a response to
     somebody choosing a project or an invoice type — it is caused by a click,
     not by a render. Written as `useEffect([projectId, kind])` it renders once
     with the old values and again with the new ones, which is what eslint's
     `set-state-in-effect` rule objects to. Called from the two `onChange`
     handlers it happens in the same commit as the choice.

     ⚠️ AND NOTHING TYPED IS EVER OVERWRITTEN. Each field is rewritten only
     while it still holds what the PREVIOUS project put there (or is empty).
     Somebody who corrects the address and then switches invoice type must not
     lose the correction — that is the specific way "smart" forms become
     infuriating. */
  const fillFrom = React.useCallback(
    (nextProjectId: string, nextKind: InvoiceKind) => {
      const next = projects.find((p) => p.projectId === nextProjectId);
      const previous = projects.find((p) => p.projectId === projectId);
      if (!next) return;

      const wasAuto = (current: string, pick: (p: BillingProfile) => string) =>
        current === '' || (previous ? current === pick(previous) : false);

      if (wasAuto(billedToName, (p) => p.billingName ?? p.projectName)) {
        setBilledToName(next.billingName ?? next.projectName);
      }
      if (wasAuto(billedToPerson, (p) => p.billingContact ?? '')) {
        setBilledToPerson(next.billingContact ?? '');
      }
      if (wasAuto(billedToEmail, (p) => p.billingEmail ?? '')) {
        setBilledToEmail(next.billingEmail ?? '');
      }
      if (wasAuto(billedToAddress, (p) => p.billingAddress ?? '')) {
        setBilledToAddress(next.billingAddress ?? '');
      }
      if (wasAuto(termsDays, (p) => String(p.paymentTermsDays))) {
        setTermsDays(String(next.paymentTermsDays));
      }

      /* ── The first line ────────────────────────────────────
         ⚠️ ONLY for a monthly invoice, and only while the line is untouched. A
         retainer has one known answer — the agreed fee — and typing it every
         month is the drudgery the owner asked to remove. An add-on has no such
         answer; pre-filling it with the retainer fee would be a plausible wrong
         number, which is far worse than an empty field. */
      setLines((current) => {
        const only = current.length === 1 ? current[0] : null;
        if (only === null) return current;

        const untouched =
          only.rate === '' ||
          (previous?.monthlyFeePkr != null && only.rate === String(previous.monthlyFeePkr));
        if (!untouched) return current;

        if (nextKind === 'retainer' && next.monthlyFeePkr) {
          return [newLine(`${next.projectName} — monthly package fee`, '1', String(next.monthlyFeePkr))];
        }
        return only.description === '' && only.rate === '' ? current : [newLine()];
      });
    },
    [projects, projectId, billedToName, billedToPerson, billedToEmail, billedToAddress, termsDays],
  );

  /* ⚠️ Fills once on open, for the project that starts selected. An effect
     with an empty dependency list is the right tool here and is NOT the smell
     above: it runs on mount rather than on every change of a value it also
     writes, so there is no cascade to trigger. */
  const filled = React.useRef(false);
  React.useEffect(() => {
    if (filled.current || !projectId) return;
    filled.current = true;
    fillFrom(projectId, kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (state.ok && !seen.current) {
      seen.current = true;
      onDone(state);
    }
  }, [state, onDone]);

  const parsed = lines
    .filter((l) => l.description.trim() !== '')
    .map((l) => ({
      description: l.description,
      quantity: Number(l.quantity || '1'),
      unitPricePkr: Number(l.rate || '0'),
    }));

  const totals = totalsFor(parsed, taxOn ? Number(taxRate) || 0 : null);

  /* ⚠️ NOT memoised. `checkInvoice` walks at most forty lines of pure
     arithmetic, so a memo costs more than it saves — and memoising it needs
     `parsed` in the dependency list, which is a fresh array every render, so the
     only way to make the memo work at all is to stringify it. Building a cache
     key with JSON.stringify on every render to avoid a cheap function is the
     wrong trade twice over. */
  const check = checkInvoice({
    billedToName,
    billedToEmail,
    lines: parsed,
    issuedOn,
    dueOn,
    taxRatePct: taxOn ? Number(taxRate) || 0 : null,
  });
  const problem = check.ok ? null : check.message;

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Create an invoice"
      description="It is numbered and a PDF is drawn. Nothing is emailed until you send it."
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="invoice-form"
            disabled={pending || problem !== null}
            onClick={() => {
              /* Read the pad at submit time. Keeping the data URL in state on
                 every stroke would re-render the whole form mid-signature. */
              if (drawInstead) setSignatureDataUrl(padRef.current?.toDataUrl() ?? '');
            }}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Create invoice
          </Button>
        </>
      }
    >
      <form id="invoice-form" action={formAction} className="space-y-5">
        {!state.ok && state.error && (
          <p
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-error)' }}
          >
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            {state.error}
          </p>
        )}

        {/* ══ WHAT KIND ═══════════════════════════════════════════════════════
            First, because the suggested line below depends on the answer. The
            description under each is not decoration — see INVOICE_KIND_META. */}
        <fieldset className="space-y-1.5">
          <legend className="block text-caption font-semibold text-text-primary">
            Type of invoice
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {INVOICE_KINDS.map((value) => {
              const meta = INVOICE_KIND_META[value];
              const active = kind === value;
              return (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-xl border p-3',
                    'transition-[border-color,background-color] duration-[140ms]',
                    active
                      ? 'border-border-brand bg-bg-selected'
                      : 'border-border-subtle hover:border-border-strong',
                  )}
                >
                  <input
                    type="radio"
                    name="kind"
                    value={value}
                    checked={active}
                    onChange={() => {
                      setKind(value);
                      /* The suggested first line depends on the type: a monthly
                         invoice fills in the agreed fee, the others do not. */
                      fillFrom(projectId, value);
                    }}
                    className="mt-0.5 size-3.5 shrink-0 accent-[var(--accent-primary)]"
                  />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block text-body-sm font-semibold text-text-primary">
                      {meta.label}
                    </span>
                    <span className="block text-micro leading-snug text-text-secondary">
                      {meta.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* ══ WHO ═════════════════════════════════════════════════════════════ */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Project"
            htmlFor="projectId"
            hint="Choosing one fills in everything below. All of it stays editable."
          >
            <Select
              id="projectId"
              name="projectId"
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                fillFrom(event.target.value, kind);
              }}
              options={[
                { value: '', label: 'Not tied to a project' },
                ...projects.map((p) => ({ value: p.projectId, label: p.projectName })),
              ]}
            />
          </Field>

          <Field label="Billed to" htmlFor="billedToName" hint="The name printed on the invoice.">
            <Input
              id="billedToName"
              name="billedToName"
              value={billedToName}
              onChange={(event) => setBilledToName(event.target.value)}
              placeholder="GC Royal Emporium (Pvt) Ltd"
              required
            />
          </Field>

          <Field label="Contact person" htmlFor="billedToPerson" hint="Optional. Addressed to them.">
            <Input
              id="billedToPerson"
              name="billedToPerson"
              value={billedToPerson}
              onChange={(event) => setBilledToPerson(event.target.value)}
              placeholder="Mr Ahmed Raza"
            />
          </Field>

          <Field
            label="Send to"
            htmlFor="billedToEmail"
            hint={
              project && !project.billingEmail
                ? 'No address is saved for this client — type one, and add it to the project so next month fills in.'
                : 'Where the invoice will be emailed.'
            }
          >
            <Input
              id="billedToEmail"
              name="billedToEmail"
              type="email"
              value={billedToEmail}
              onChange={(event) => setBilledToEmail(event.target.value)}
              placeholder="accounts@client.com"
              required
            />
          </Field>
        </div>

        <Field label="Billing address" htmlFor="billedToAddress" hint="Optional. One line per line.">
          <Textarea
            id="billedToAddress"
            name="billedToAddress"
            rows={2}
            value={billedToAddress}
            onChange={(event) => setBilledToAddress(event.target.value)}
            placeholder={'Plot 12, Main Boulevard\nLahore'}
          />
        </Field>

        {/* ══ WHEN ════════════════════════════════════════════════════════════ */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Issue date" htmlFor="issuedOn">
            <Input
              id="issuedOn"
              name="issuedOn"
              type="date"
              value={issuedOn}
              onChange={(event) => setIssuedOn(event.target.value)}
              required
            />
          </Field>

          <Field label="Terms" htmlFor="paymentTermsDays" hint="Days to pay.">
            <Input
              id="paymentTermsDays"
              name="paymentTermsDays"
              type="number"
              min={0}
              max={180}
              value={termsDays}
              onChange={(event) => setTermsDays(event.target.value)}
            />
          </Field>

          <Field
            label="Due date"
            htmlFor="dueOn"
            hint={dueOverride ? 'Set by hand.' : termsLabel(Number(termsDays) || 0)}
          >
            <Input
              id="dueOn"
              name="dueOn"
              type="date"
              value={dueOn}
              onChange={(event) => setDueOverride(event.target.value)}
              required
            />
          </Field>
        </div>

        {/* ══ WHAT FOR ════════════════════════════════════════════════════════ */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-caption font-semibold text-text-primary">What is being charged</span>
            <Button variant="ghost" size="sm" onClick={() => setLines((c) => [...c, newLine()])}>
              <Plus className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
              Add a line
            </Button>
          </div>

          <div className="overflow-hidden rounded-xl border border-border-default">
            <div className="hidden items-center gap-2 border-b border-border-subtle bg-bg-subtle px-3 py-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary sm:flex">
              <span className="flex-1">Description</span>
              <span className="w-16 text-right">Qty</span>
              <span className="w-28 text-right">Rate</span>
              <span className="w-28 text-right">Amount</span>
              <span className="w-8" />
            </div>

            {lines.map((line, index) => (
              <div
                key={line.key}
                className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2 last:border-b-0"
              >
                <span className="min-w-[10rem] flex-1">
                  <Input
                    name={`line-description-${index}`}
                    value={line.description}
                    onChange={(event) => updateLine(line.key, { description: event.target.value })}
                    placeholder="Social media management — Sep 2026"
                    aria-label={`Line ${index + 1} description`}
                  />
                </span>
                <span className="w-16">
                  <Input
                    name={`line-quantity-${index}`}
                    type="number"
                    min={0}
                    step="0.5"
                    value={line.quantity}
                    onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                    className="text-right"
                    aria-label={`Line ${index + 1} quantity`}
                  />
                </span>
                <span className="w-28">
                  <Input
                    name={`line-rate-${index}`}
                    type="number"
                    min={0}
                    step="1"
                    value={line.rate}
                    onChange={(event) => updateLine(line.key, { rate: event.target.value })}
                    className="text-right"
                    aria-label={`Line ${index + 1} rate`}
                  />
                </span>
                <span className="w-28 text-right text-body-sm font-semibold tabular-nums text-text-primary">
                  {plain(Number(line.quantity || 0) * Number(line.rate || 0))}
                </span>
                <span className="w-8 text-right">
                  {/* ⚠️ Hidden rather than disabled on the last row: an invoice
                      with no lines is refused anyway, and a disabled bin invites
                      somebody to keep pressing it. */}
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))}
                      aria-label={`Remove line ${index + 1}`}
                      className="grid size-7 place-items-center rounded-lg text-text-tertiary hover:bg-bg-hover hover:text-[var(--feedback-error)]"
                    >
                      <Trash2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ══ THE MONEY ═══════════════════════════════════════════════════════ */}
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border-subtle bg-bg-subtle p-3">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              name="taxOn"
              checked={taxOn}
              onChange={(event) => setTaxOn(event.target.checked)}
              className="mt-0.5 size-3.5 accent-[var(--accent-primary)]"
            />
            <span className="space-y-1">
              <span className="block text-body-sm font-semibold text-text-primary">
                Add {taxLabel}
              </span>
              <span className="flex items-center gap-1.5">
                <input
                  name="taxRatePct"
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={taxRate}
                  disabled={!taxOn}
                  onChange={(event) => setTaxRate(event.target.value)}
                  aria-label={`${taxLabel} rate`}
                  className="h-8 w-20 rounded-lg border border-border-default bg-bg-surface px-2 text-right text-body-sm text-text-primary disabled:opacity-50"
                />
                <span className="text-micro text-text-tertiary">%</span>
              </span>
            </span>
          </label>

          <div className="min-w-[12rem] space-y-1 text-right">
            {totals.taxPkr !== null && (
              <>
                <p className="flex justify-between text-caption text-text-secondary">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{plain(totals.subtotalPkr)}</span>
                </p>
                <p className="flex justify-between text-caption text-text-secondary">
                  <span>
                    {taxLabel} @ {totals.taxRatePct}%
                  </span>
                  <span className="tabular-nums">{plain(totals.taxPkr)}</span>
                </p>
              </>
            )}
            <p className="flex justify-between border-t border-border-default pt-1 text-body font-bold text-text-primary">
              <span>Total</span>
              <span className="tabular-nums">{pkr(totals.totalPkr)}</span>
            </p>
            <p className="text-micro text-text-tertiary">Due {longDate(dueOn)}</p>
          </div>
        </div>

        {/* ══ NOTES ═══════════════════════════════════════════════════════════ */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Note to the client"
            htmlFor="clientNote"
            hint="Printed on the invoice and in the email."
          >
            <Textarea id="clientNote" name="clientNote" rows={2} placeholder="Please quote the invoice number with your transfer." />
          </Field>
          <Field
            label="Internal note"
            htmlFor="note"
            hint="Only ever seen here. Never printed and never emailed."
          >
            <Textarea id="note" name="note" rows={2} />
          </Field>
        </div>

        <Field
          label="Invoice number"
          htmlFor="invoiceNo"
          hint="Leave empty to take the next one in the series. Typing your own does not consume a number."
        >
          <Input id="invoiceNo" name="invoiceNo" placeholder="Automatic" />
        </Field>

        {/* ══ THE SIGNATURE ═══════════════════════════════════════════════════
            Owner chose both: the saved one by default, with the option to draw a
            different one for the times somebody else signs. */}
        <div className="space-y-3 rounded-xl border border-border-subtle p-3">
          <p className="text-caption font-semibold text-text-primary">
            Signed by {signerName}
            {signerTitle ? `, ${signerTitle}` : ''}
          </p>

          {hasSavedSignature ? (
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-body-sm text-text-primary">
                <input
                  type="radio"
                  name="signatureChoice"
                  checked={useSignature && !drawInstead}
                  onChange={() => {
                    setUseSignature(true);
                    setDrawInstead(false);
                  }}
                  className="size-3.5 accent-[var(--accent-primary)]"
                />
                Use my saved signature
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-body-sm text-text-primary">
                <input
                  type="radio"
                  name="signatureChoice"
                  checked={drawInstead}
                  onChange={() => {
                    setUseSignature(true);
                    setDrawInstead(true);
                  }}
                  className="size-3.5 accent-[var(--accent-primary)]"
                />
                Draw a different one for this invoice
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-body-sm text-text-secondary">
                <input
                  type="radio"
                  name="signatureChoice"
                  checked={!useSignature}
                  onChange={() => {
                    setUseSignature(false);
                    setDrawInstead(false);
                  }}
                  className="size-3.5 accent-[var(--accent-primary)]"
                />
                No signature — the printed name only
              </label>
            </div>
          ) : (
            <p className="flex items-start gap-2 text-micro text-text-secondary">
              <Info className="mt-px size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              You have no saved signature yet. Draw one below for this invoice, or save one under
              Invoice settings so it is stamped on every invoice you issue.
            </p>
          )}

          {(drawInstead || !hasSavedSignature) && (
            <SignaturePad
              ref={padRef}
              label="Draw your signature"
              hint="It is stamped above your name at the foot of the PDF."
              onChange={setPadHasInk}
            />
          )}

          {/* ⚠️ Hidden fields rather than reading the canvas on the server. The
              pad is read once, at submit, by the footer button. */}
          <input type="hidden" name="useSignature" value={useSignature ? 'on' : 'off'} />
          <input type="hidden" name="signatureDataUrl" value={drawInstead || !hasSavedSignature ? signatureDataUrl : ''} />
          {padHasInk && drawInstead && (
            <p className="text-micro text-text-tertiary">This drawing is used for this invoice only — your saved signature is unchanged.</p>
          )}
        </div>

        {/* ⚠️ The live objection, not a message that appears after pressing a
            button that was enabled the whole time. */}
        {problem && (
          <p className="flex items-start gap-2 text-micro text-text-secondary">
            <AlertTriangle
              className="mt-px size-3.5 shrink-0"
              strokeWidth={2.25}
              style={{ color: 'var(--feedback-warning)' }}
              aria-hidden="true"
            />
            {problem}
          </p>
        )}
      </form>
    </Dialog>
  );
}
