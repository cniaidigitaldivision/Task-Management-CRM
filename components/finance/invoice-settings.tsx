'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Building2, Check, Landmark, Loader2, PenLine, Trash2 } from 'lucide-react';

import {
  clearSignatureAction,
  saveBillingProfileAction,
  saveLetterheadAction,
  saveSignatureAction,
  type InvoiceResult,
} from '@/app/actions/invoices';
import type { BillingProfile } from '@/lib/db/queries/invoices';
import type { CompanyLetterhead } from '@/lib/domain/invoice';
import { termsLabel } from '@/lib/domain/invoice';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

import { SignaturePad, type SignaturePadHandle } from './signature-pad';

/* ============================================================================
 * INVOICE SETTINGS — owner request 2026-08-29
 * ----------------------------------------------------------------------------
 * Three things an invoice needs that are not part of any single invoice: who is
 * issuing it, who is being billed, and whose signature goes at the foot.
 *
 * ── ⚠️ WHY THIS IS A TAB IN FINANCE AND NOT ON THE SETTINGS PAGE ───────────
 * It could go either way, and Finance wins for one reason: this is where
 * somebody is standing when they discover the letterhead is blank. The Settings
 * page is where you go to change something you already know about; the moment
 * you learn an invoice has no bank details on it is the moment you are looking
 * at the invoice. Putting it a tab away rather than a page away is the
 * difference between fixing it now and meaning to.
 *
 * ── ⚠️ NOTHING HERE IS PRE-FILLED WITH A PLAUSIBLE GUESS ───────────────────
 * The address, the NTN and the bank account are blank until somebody types
 * them, and the PDF omits any block that is still blank. An invented account
 * number on a document a client pays against is money sent to nobody, and a
 * placeholder that looks like a real value is worse than an obvious gap.
 * ========================================================================= */

const EMPTY: InvoiceResult = { ok: false };

export function InvoiceSettings({
  company,
  projects,
  signature,
}: {
  company: CompanyLetterhead;
  projects: readonly BillingProfile[];
  signature: { name: string; title: string | null; has: boolean };
}) {
  return (
    <div className="space-y-5">
      <SignatureCard signature={signature} />
      <LetterheadCard company={company} />
      <BillingCard projects={projects} />
    </div>
  );
}

/* ==========================================================================
 * THE SAVED SIGNATURE
 * ========================================================================== */

function SignatureCard({ signature }: { signature: { name: string; title: string | null; has: boolean } }) {
  const router = useRouter();
  const [state, formAction, pending] = React.useActionState(saveSignatureAction, EMPTY);
  const padRef = React.useRef<SignaturePadHandle>(null);
  const [dataUrl, setDataUrl] = React.useState('');
  const [hasInk, setHasInk] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const seen = React.useRef(false);

  React.useEffect(() => {
    if (state.ok && !seen.current) {
      seen.current = true;
      padRef.current?.clear();
      router.refresh();
    }
  }, [state, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PenLine className="size-4" strokeWidth={2.25} aria-hidden="true" />
          Your signature
        </CardTitle>
        <CardDescription>
          Drawn once and stamped on every invoice you issue, above your name. You can still draw a
          different one on a particular invoice.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-3">
        {state.ok && state.message && (
          <p
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-success)' }}
          >
            <Check className="mt-px h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            {state.message}
          </p>
        )}
        {!state.ok && state.error && (
          <p
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-error)' }}
          >
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            {state.error}
          </p>
        )}

        <p className="text-body-sm text-text-secondary">
          Invoices are signed <strong className="text-text-primary">{signature.name}</strong>
          {signature.title ? `, ${signature.title}` : ''}.{' '}
          {signature.has ? (
            <span style={{ color: 'var(--feedback-success)' }}>A signature is saved.</span>
          ) : (
            'No signature is saved yet.'
          )}
        </p>

        <form action={formAction} className="space-y-3">
          <SignaturePad
            ref={padRef}
            label={signature.has ? 'Draw a new one to replace it' : 'Draw your signature'}
            onChange={setHasInk}
          />
          <input type="hidden" name="signatureDataUrl" value={dataUrl} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="md"
              type="submit"
              disabled={pending || !hasInk}
              onClick={() => setDataUrl(padRef.current?.toDataUrl() ?? '')}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {signature.has ? 'Replace my signature' : 'Save my signature'}
            </Button>

            {signature.has && (
              <Button
                variant="ghost"
                size="md"
                disabled={clearing}
                onClick={async () => {
                  setClearing(true);
                  await clearSignatureAction();
                  setClearing(false);
                  router.refresh();
                }}
              >
                {clearing ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="size-4" strokeWidth={2.25} aria-hidden="true" />
                )}
                Remove it
              </Button>
            )}
          </div>
          {/* ⚠️ Says what removing does NOT do. An invoice already issued keeps
              the signature it was drawn with — its PDF is stored, and the whole
              point of storing it is that the client's copy and ours agree. */}
          {signature.has && (
            <p className="text-micro text-text-tertiary">
              Invoices already issued keep the signature they were signed with.
            </p>
          )}
        </form>
      </CardBody>
    </Card>
  );
}

/* ==========================================================================
 * THE LETTERHEAD
 * ========================================================================== */

function LetterheadCard({ company }: { company: CompanyLetterhead }) {
  const router = useRouter();
  const [state, formAction, pending] = React.useActionState(saveLetterheadAction, EMPTY);
  const seen = React.useRef(false);

  React.useEffect(() => {
    if (state.ok && !seen.current) {
      seen.current = true;
      router.refresh();
    }
  }, [state, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="size-4" strokeWidth={2.25} aria-hidden="true" />
          What goes at the top of the invoice
        </CardTitle>
        <CardDescription>
          Anything left blank is left off the PDF rather than printed as a placeholder.
        </CardDescription>
      </CardHeader>
      <CardBody>
        <form action={formAction} className="space-y-4">
          {state.ok && state.message && (
            <p
              className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-success)' }}
            >
              <Check className="mt-px h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              {state.message}
            </p>
          )}
          {!state.ok && state.error && (
            <p
              className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-error)' }}
            >
              <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              {state.error}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal name" htmlFor="legalName">
              <Input id="legalName" name="legalName" defaultValue={company.legalName} required />
            </Field>
            <Field label="Division" htmlFor="division" hint="Printed under the name. Optional.">
              <Input id="division" name="division" defaultValue={company.division} />
            </Field>
          </div>

          <Field label="Address" htmlFor="addressLines" hint="One line per line. Blank lines are dropped.">
            <Textarea
              id="addressLines"
              name="addressLines"
              rows={3}
              defaultValue={company.addressLines.join('\n')}
              placeholder={'Office 402, Business Centre\nGulberg III, Lahore 54660'}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Phone" htmlFor="phone">
              <Input id="phone" name="phone" defaultValue={company.phone} />
            </Field>
            <Field label="Email" htmlFor="email" hint="Clients are told to reply here.">
              <Input id="email" name="email" type="email" defaultValue={company.email} />
            </Field>
            <Field label="Website" htmlFor="website">
              <Input id="website" name="website" defaultValue={company.website} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="NTN" htmlFor="ntn" hint="National Tax Number. Optional.">
              <Input id="ntn" name="ntn" defaultValue={company.ntn} />
            </Field>
            <Field label="STRN" htmlFor="strn" hint="Sales Tax Registration Number. Optional.">
              <Input id="strn" name="strn" defaultValue={company.strn} />
            </Field>
          </div>

          {/* ── How to pay ───────────────────────────────────────────────────
              ⚠️ The whole block is omitted from the PDF when these are empty.
              An invoice with no payment details is obviously incomplete; one
              with a made-up account number is not, which is why nothing here is
              pre-filled. */}
          <div className="space-y-4 rounded-xl border border-border-subtle p-3">
            <p className="flex items-center gap-2 text-caption font-semibold text-text-primary">
              <Landmark className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              How clients pay
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bank" htmlFor="bankName">
                <Input id="bankName" name="bankName" defaultValue={company.bankName} placeholder="Meezan Bank Limited" />
              </Field>
              <Field label="Account title" htmlFor="bankTitle">
                <Input id="bankTitle" name="bankTitle" defaultValue={company.bankTitle} />
              </Field>
              <Field label="Account number" htmlFor="bankAccount">
                <Input id="bankAccount" name="bankAccount" defaultValue={company.bankAccount} />
              </Field>
              <Field label="IBAN" htmlFor="bankIban">
                <Input id="bankIban" name="bankIban" defaultValue={company.bankIban} placeholder="PK00XXXX0000000000000000" />
              </Field>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Number prefix" htmlFor="invoicePrefix" hint="CNI-2026-0001">
              <Input id="invoicePrefix" name="invoicePrefix" defaultValue={company.invoicePrefix} maxLength={10} />
            </Field>
            <Field label="Tax label" htmlFor="taxLabel" hint="Printed on the tax line.">
              <Input id="taxLabel" name="taxLabel" defaultValue={company.taxLabel} />
            </Field>
            <Field
              label="Default tax rate"
              htmlFor="defaultTaxRatePct"
              hint="The rate offered. Tax stays switched off unless you tick it."
            >
              <Input
                id="defaultTaxRatePct"
                name="defaultTaxRatePct"
                type="number"
                min={0}
                max={100}
                step="0.5"
                defaultValue={company.defaultTaxRatePct}
              />
            </Field>
          </div>

          <Field label="Footer note" htmlFor="footerNote" hint="One line at the foot of every page.">
            <Input id="footerNote" name="footerNote" defaultValue={company.footerNote} />
          </Field>

          <Button variant="primary" size="md" type="submit" disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Save the letterhead
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

/* ==========================================================================
 * WHO IS BILLED
 * ========================================================================== */

function BillingCard({ projects }: { projects: readonly BillingProfile[] }) {
  const [openId, setOpenId] = React.useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who each client is billed as</CardTitle>
        <CardDescription>
          Filled in here once, and every invoice for that client fills itself in. A client with no
          email address cannot be sent an invoice.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-2">
        {projects.map((project) => (
          <div key={project.projectId} className="rounded-xl border border-border-subtle">
            <button
              type="button"
              onClick={() => setOpenId(openId === project.projectId ? null : project.projectId)}
              className="flex w-full flex-wrap items-center gap-3 px-3 py-2.5 text-left hover:bg-bg-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-semibold text-text-primary">
                  {project.billingName || project.projectName}
                </span>
                <span className="block truncate text-micro text-text-secondary">
                  {project.billingEmail || 'No billing email — invoices cannot be sent'}
                </span>
              </span>
              <span className="shrink-0 text-micro text-text-tertiary">
                {termsLabel(project.paymentTermsDays)}
              </span>
              {/* ⚠️ The gap is flagged on the collapsed row, not only inside.
                  Somebody scanning this list needs to see which client will fail
                  at send time without opening five panels. */}
              {!project.billingEmail && (
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-micro font-semibold"
                  style={{
                    backgroundColor: 'color-mix(in oklab, var(--feedback-warning) 14%, transparent)',
                    color: 'var(--feedback-warning)',
                  }}
                >
                  Needs an email
                </span>
              )}
            </button>

            {openId === project.projectId && <BillingForm project={project} onSaved={() => setOpenId(null)} />}
          </div>
        ))}

        {projects.length === 0 && (
          <p className="px-3 py-8 text-center text-body-sm text-text-secondary">
            There are no projects to bill yet.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function BillingForm({ project, onSaved }: { project: BillingProfile; onSaved: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = React.useActionState(saveBillingProfileAction, EMPTY);
  const seen = React.useRef(false);

  React.useEffect(() => {
    if (state.ok && !seen.current) {
      seen.current = true;
      router.refresh();
      onSaved();
    }
  }, [state, router, onSaved]);

  return (
    <form action={formAction} className="space-y-4 border-t border-border-subtle p-3">
      <input type="hidden" name="projectId" value={project.projectId} />

      {!state.ok && state.error && (
        <p
          className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-error)' }}
        >
          <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          {state.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Billed as"
          htmlFor={`billingName-${project.projectId}`}
          hint="The legal entity. Falls back to the project name."
        >
          <Input
            id={`billingName-${project.projectId}`}
            name="billingName"
            defaultValue={project.billingName ?? ''}
            placeholder={project.projectName}
          />
        </Field>
        <Field label="Contact person" htmlFor={`billingContact-${project.projectId}`}>
          <Input
            id={`billingContact-${project.projectId}`}
            name="billingContact"
            defaultValue={project.billingContact ?? ''}
          />
        </Field>
        <Field
          label="Billing email"
          htmlFor={`billingEmail-${project.projectId}`}
          hint="Where invoices are sent."
        >
          <Input
            id={`billingEmail-${project.projectId}`}
            name="billingEmail"
            type="email"
            defaultValue={project.billingEmail ?? ''}
          />
        </Field>
        <Field label="Phone" htmlFor={`billingPhone-${project.projectId}`}>
          <Input
            id={`billingPhone-${project.projectId}`}
            name="billingPhone"
            defaultValue={project.billingPhone ?? ''}
          />
        </Field>
      </div>

      <Field label="Billing address" htmlFor={`billingAddress-${project.projectId}`} hint="One line per line.">
        <Textarea
          id={`billingAddress-${project.projectId}`}
          name="billingAddress"
          rows={2}
          defaultValue={project.billingAddress ?? ''}
        />
      </Field>

      <Field
        label="Payment terms"
        htmlFor={`paymentTermsDays-${project.projectId}`}
        hint="An invoice issued today is due this many days from now."
      >
        <Select
          id={`paymentTermsDays-${project.projectId}`}
          name="paymentTermsDays"
          defaultValue={String(project.paymentTermsDays)}
          options={[0, 7, 10, 15, 30, 45, 60].map((days) => ({
            value: String(days),
            label: termsLabel(days),
          }))}
        />
      </Field>

      <Button variant="primary" size="md" type="submit" disabled={pending}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        Save
      </Button>
    </form>
  );
}
