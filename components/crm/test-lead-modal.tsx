'use client';

/* ============================================================================
 * ⚠️⚠️ TEMPORARY — DELETE THIS WHOLE FILE WHEN THE TESTING IS DONE ⚠️⚠️
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-12: *"when I click Send I want to see whether it drops into a
 * CRM exactly instantly and how intelligently the system assigns that lead to
 * someone… I will remove this once I make sure the system is working smartly."*
 *
 * A stand-in for a Meta lead arriving, so the rota can be watched deciding.
 *
 * To remove: delete this file, delete `app/actions/crm-test-lead.ts`, and delete
 * the single `<TestLeadButton …>` line and its import in `lead-desk.tsx`.
 *
 * ⚠️ IT ONLY DRAWS ON THE DEMO PROJECT, and the SERVER refuses anything else
 * regardless — see the action. A hidden button is not a permission.
 * ========================================================================= */

import * as React from 'react';
import { FlaskConical, ArrowRight } from 'lucide-react';

import { createTestLeadAction, listDemoFormsAction } from '@/app/actions/crm-test-lead';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';

/** What the enquiry says it wants. Ours, since these are our own products. */
const PRODUCTS = ['ERP', 'CRM', 'Taskly', 'WhatsApp automation', 'Social media automation', 'Digital marketing'];

export function TestLeadButton({ projectId }: { projectId: string }) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [forms, setForms] = React.useState<Array<{ id: string; name: string }>>([]);

  const [fullName, setFullName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [city, setCity] = React.useState('');
  const [product, setProduct] = React.useState(PRODUCTS[0]);
  const [formId, setFormId] = React.useState('');
  const [note, setNote] = React.useState('');

  /** What the rota decided, kept on screen after the dialog closes. */
  const [outcome, setOutcome] = React.useState<{ who: string; because: string } | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let live = true;
    void listDemoFormsAction(projectId).then((rows) => {
      if (!live) return;
      setForms(rows);
      setFormId((current) => current || rows[0]?.id || '');
    });
    return () => {
      live = false;
    };
  }, [open, projectId]);

  async function send() {
    if (!fullName.trim()) {
      toast({ tone: 'error', text: 'Give the lead a name.' });
      return;
    }
    setBusy(true);
    const result = await createTestLeadAction({
      projectId,
      formId: formId || null,
      fullName,
      phone,
      city,
      product,
      note,
    });
    setBusy(false);

    if (!result.ok) {
      toast({ tone: 'error', text: result.error ?? 'That did not work.' });
      return;
    }

    setOutcome({
      who: result.assignedTo ?? 'nobody yet',
      because: result.because ?? result.error ?? '',
    });
    toast({
      tone: 'ok',
      text: result.assignedTo ? `Lead arrived — ${result.assignedTo} got it.` : 'Lead arrived.',
    });

    /* Cleared so the next one is a fresh enquiry rather than an edit of the
       last, which is what makes the rota's next decision meaningful. */
    setFullName('');
    setPhone('');
    setCity('');
    setNote('');
    setOpen(false);
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <FlaskConical className="size-4" aria-hidden="true" />
        Add a test lead
      </Button>

      {/* ⚠️ OUTSIDE THE DIALOG, deliberately. The whole point is to watch where
          the lead went, and a message inside a dialog that has just closed is a
          message nobody reads. */}
      {outcome && (
        <div className="mt-2 rounded-lg border border-border-subtle bg-bg-subtle px-3 py-2">
          <p className="text-caption font-medium text-text-primary">
            <ArrowRight className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
            Went to {outcome.who}
          </p>
          <p className="mt-0.5 text-caption text-text-secondary">{outcome.because}</p>
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add a test lead"
        description="Stands in for a Meta lead arriving. It lands on the desk and the rota hands it out, exactly as a real one would."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void send()} disabled={busy}>
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <Field label="Name">
            <Input
              id="test-lead-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Who is enquiring"
              autoFocus
            />
          </Field>

          <Field
            label="Phone"
            hint="Leave empty and the lead arrives with no reachable number — no call or WhatsApp button will draw."
          >
            <Input
              id="test-lead-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="03121531511"
              inputMode="tel"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Came from">
              <Select id="test-lead-form" value={formId} onChange={(e) => setFormId(e.target.value)}>
                {forms.length === 0 && <option value="">No forms on this project</option>}
                {forms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Interested in">
              <Select
                id="test-lead-product"
                value={product}
                onChange={(e) => setProduct(e.target.value)}
              >
                {PRODUCTS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="City">
            <Input
              id="test-lead-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Islamabad"
            />
          </Field>

          <Field label="What they want">
            <Input
              id="test-lead-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Replacing an old system, 20 staff"
            />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-caption font-medium text-text-secondary">{label}</span>
      {children}
      {hint && <span className="text-caption text-text-secondary">{hint}</span>}
    </label>
  );
}
