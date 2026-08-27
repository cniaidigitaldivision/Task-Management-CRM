'use client';

import * as React from 'react';
import { Check, Loader2 } from 'lucide-react';

import { recordExpenseAction, recordRevenueAction } from '@/app/actions/finance';
import { ExpenseFields, type PersonOption, type ToolOption } from '@/components/finance/expense-fields';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { ExpenseCategory, ProjectOption } from '@/lib/db/queries/finance';

/* ============================================================================
 * RECORDING ONE ENTRY
 * ----------------------------------------------------------------------------
 * One dialog, two shapes. They share the date handling and the money parsing;
 * splitting them into two components would mean two places for those to drift.
 *
 * ── ⚠️ THE EXPENSE HALF IS THE SAME FIELDS THE COORDINATOR SEES ────────────
 * `ExpenseFields`, imported rather than copied. An Admin filing an expense and
 * a Coordinator filing one are the same act and must collect the same things —
 * including the receipt, which neither of them can skip.
 *
 * ── ⚠️ THE PROJECT FEE IS A PREFILL, NOT A POSTING ─────────────────────────
 * Owner, 2026-08-26: income is entered by hand, every line. Choosing a project
 * fills the amount with its agreed monthly fee so nobody has to remember
 * 120,000 — and then a person decides. A month where a client paid nothing has
 * no income row, and the difference between "billed" and "would have been
 * billed" stays visible, which is the whole reason it was not automated.
 * ========================================================================= */

export function EntryDialog({
  kind,
  open,
  onClose,
  categories,
  projects,
  tools,
  people,
  today,
}: {
  kind: 'expense' | 'revenue';
  open: boolean;
  onClose: () => void;
  categories: readonly ExpenseCategory[];
  projects: readonly ProjectOption[];
  tools: readonly ToolOption[];
  people: readonly PersonOption[];
  today: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState('');

  /* Salaries are never filable by hand — see `ExpenseDropBox`. */
  const filable = categories.filter((c) => !c.postedOnly);

  const [categoryId, setCategoryId] = React.useState(() => filable[0]?.id ?? '');
  const [incurredOn, setIncurredOn] = React.useState(today);
  const [office, setOffice] = React.useState('');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const result =
      kind === 'expense' ? await recordExpenseAction(form) : await recordRevenueAction(form);

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAmount('');
    onClose();
  };

  /* Choosing a project fills the amount — see the header. Only when the field
     is still empty, so it never overwrites a figure somebody has typed. */
  const onProject = (projectId: string) => {
    if (amount.trim() !== '') return;
    const project = projects.find((p) => p.id === projectId);
    if (project?.monthlyFeePkr) setAmount(String(project.monthlyFeePkr));
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={kind === 'expense' ? 'Record an expense' : 'Record income'}
      description={
        kind === 'expense'
          ? 'Anything the division paid for. The bill or slip is required; salaries are posted from each person’s pay record.'
          : 'Money the division earned. Choose a project to fill in its agreed fee.'
      }
    >
      <form id="entry-form" onSubmit={submit} className="space-y-4">
        {kind === 'expense' ? (
          <>
            <Field label="Category" htmlFor="categoryId">
              <Select
                id="categoryId"
                name="categoryId"
                size="md"
                className="w-full"
                required
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                {filable.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>

            <ExpenseFields
              categories={filable}
              categoryId={categoryId}
              tools={tools}
              people={people}
              today={today}
              incurredOn={incurredOn}
              onIncurredOn={setIncurredOn}
              office={office}
              onOffice={setOffice}
              amount={amount}
              onAmount={setAmount}
            />
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kind" htmlFor="kind">
                <Select id="kind" name="kind" size="md" className="w-full" required>
                  <option value="retainer">Package retainer</option>
                  <option value="one_off">One-off project</option>
                  <option value="add_on">Add-on</option>
                </Select>
              </Field>

              <Field label="Project" htmlFor="projectId" hint="Fills in the agreed fee.">
                <Select
                  id="projectId"
                  name="projectId"
                  size="md"
                  className="w-full"
                  onChange={(event) => onProject(event.target.value)}
                >
                  <option value="">Not a listed project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field
              label="Or name the client"
              htmlFor="clientName"
              hint="Only needed when it is not one of the projects above."
            >
              <Input id="clientName" name="clientName" maxLength={120} autoComplete="off" />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Amount (PKR)" htmlFor="amountPkr">
                <Input
                  id="amountPkr"
                  name="amountPkr"
                  required
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="120,000"
                  autoComplete="off"
                />
              </Field>

              <Field label="Date earned" htmlFor="earnedOn" hint="The month it belongs to.">
                <Input id="earnedOn" name="earnedOn" type="date" defaultValue={today} required />
              </Field>

              <Field label="Invoice reference" htmlFor="invoiceRef" hint="Optional.">
                <Input id="invoiceRef" name="invoiceRef" maxLength={60} autoComplete="off" />
              </Field>
            </div>

            {/* ── ⚠️ NEW INCOME STARTS AS `pending`, NOT `received` ────────────
                Owner: *"It's not compulsory that on the 1st of each month we are
                getting the money."* Recording that a client OWES 120,000 is a
                different act from recording that it arrived — and the second
                needs proof, which is collected as a PAYMENT on the Revenue tab when the
                money actually lands. */}
            <Field
              label="Status"
              htmlFor="status"
              hint="This records what a client OWES. Money arriving is recorded separately, as a payment with its own proof — so an invoice can be settled in instalments."
            >
              <Select id="status" name="status" size="md" className="w-full" defaultValue="pending">
                <option value="pending">Pending — not invoiced yet</option>
                <option value="invoiced">Invoiced — waiting on payment</option>
              </Select>
            </Field>
          </>
        )}

        <Field label="Note" htmlFor="note" hint="Optional.">
          <Textarea id="note" name="note" rows={2} maxLength={400} />
        </Field>

        {error && (
          <p className="text-caption font-medium" role="alert" style={{ color: 'var(--feedback-error)' }}>
            {error}
          </p>
        )}
      </form>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" form="entry-form" variant="primary" size="md" disabled={busy}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-4 w-4" aria-hidden="true" />
          )}
          Record
        </Button>
      </div>
    </Dialog>
  );
}
