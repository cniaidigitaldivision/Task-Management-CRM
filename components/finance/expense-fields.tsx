'use client';

import * as React from 'react';

import { ProofField } from '@/components/finance/proof-field';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MAX_ATTACHMENT_BYTES, formatBytes } from '@/lib/domain/attachments';
import { TOOL_CATEGORY_SLUG, subtypesFor } from '@/lib/domain/expense-subtypes';
import type { ExpenseCategory } from '@/lib/db/queries/finance';

/* ============================================================================
 * THE FIELDS OF AN EXPENSE
 * ----------------------------------------------------------------------------
 * Shared by the Coordinator's filing screen and the Admin's dialog, because
 * they collect exactly the same thing and two copies would drift the first time
 * a field was added to one of them.
 *
 * ── ⚠️ THE SECOND LEVEL CHANGES WITH THE CATEGORY ──────────────────────────
 * Owner, 2026-08-26: *"If I say that it's a utility bill, how can I know if
 * it's an electricity bill, a gas bill, something like maintenance?"* Utilities
 * offer gas/electricity/water/maintenance; AI subscriptions offer the tool list
 * AND who the seat is for; office rent offers rent/deposit. Categories with
 * nothing useful to sub-divide show no second control at all rather than an
 * empty dropdown.
 * ========================================================================= */

export interface ToolOption {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface PersonOption {
  readonly id: string;
  readonly name: string;
  readonly roleTitle: string | null;
}

export function ExpenseFields({
  categories,
  categoryId,
  tools,
  people,
  today,
  incurredOn,
  onIncurredOn,
  office,
  onOffice,
  amount,
  onAmount,
}: {
  categories: readonly ExpenseCategory[];
  categoryId: string;
  tools: readonly ToolOption[];
  people: readonly PersonOption[];
  today: string;
  incurredOn: string;
  onIncurredOn: (value: string) => void;
  office: string;
  onOffice: (value: string) => void;
  amount: string;
  onAmount: (value: string) => void;
}) {
  const category = categories.find((c) => c.id === categoryId);
  const slug = category?.slug ?? '';

  const subtypes = subtypesFor(slug);
  const isTool = slug === TOOL_CATEGORY_SLUG;

  const [subtype, setSubtype] = React.useState('');
  const [toolId, setToolId] = React.useState('');

  /* ⚠️ The sub-choice resets when the category changes. Without it, picking
     Utilities → Electricity and then switching to Travel would file a travel
     expense whose subtype is `electricity` — a value that category's list has
     never heard of, and which would render as raw text forever. */
  const lastSlug = React.useRef(slug);
  if (lastSlug.current !== slug) {
    lastSlug.current = slug;
    if (subtype !== '') setSubtype('');
    if (toolId !== '') setToolId('');
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What was it" htmlFor="title">
          <Input
            id="title"
            name="title"
            required
            maxLength={120}
            placeholder={slug === 'office_rent' ? 'Office rent — August' : 'K-Electric bill for August'}
            autoComplete="off"
          />
        </Field>

        <Field label="Amount (PKR)" htmlFor="amountPkr" hint="Commas are fine — 18,400.">
          <Input
            id="amountPkr"
            name="amountPkr"
            required
            /* ⚠️ `text`, not `number`. A number input silently discards what it
               cannot parse, so "18,400" becomes an empty field with no message.
               The action strips commas and validates instead. */
            inputMode="decimal"
            value={amount}
            onChange={(event) => onAmount(event.target.value)}
            placeholder="18,400"
            autoComplete="off"
          />
        </Field>
      </div>

      {/* ── The second level, where the category has one ─────────────────── */}
      {isTool ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Which tool" htmlFor="subscriptionId">
            {/* ⚠️ `other` is a distinct value, NOT a second empty option. Two
                options sharing `value=""` are indistinguishable to the form and
                to the `toolId === ''` test below — "Choose a tool…" would then
                silently mean "not listed" and reveal the free-text field before
                anybody had chosen anything. */}
            <Select
              id="subscriptionId"
              name="subscriptionId"
              size="md"
              className="w-full"
              required
              value={toolId}
              onChange={(event) => setToolId(event.target.value)}
            >
              <option value="">Choose a tool…</option>
              {tools.map((tool) => (
                <option key={tool.id} value={tool.id}>
                  {tool.name}
                </option>
              ))}
              {/* A tool bought before anybody added it to the catalogue still
                  has to be recordable — otherwise the figure goes in under the
                  nearest wrong name. */}
              <option value="other">Not listed — say below</option>
            </Select>
          </Field>

          {/* Owner: *"I will select the tool and then I will select the person
              to whom I'm giving this."* */}
          <Field label="For whom" htmlFor="subscriptionUserId" hint="Whose seat this pays for.">
            <Select id="subscriptionUserId" name="subscriptionUserId" size="md" className="w-full">
              <option value="">Nobody in particular</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                  {person.roleTitle ? ` — ${person.roleTitle}` : ''}
                </option>
              ))}
            </Select>
          </Field>

          {toolId === 'other' && (
            <Field
              label="Which tool, exactly"
              htmlFor="subtypeOther"
              hint="It is not in the list — name it so it can be added."
              className="sm:col-span-2"
            >
              <Input
                id="subtypeOther"
                name="subtypeOther"
                required
                maxLength={80}
                placeholder="Perplexity Pro"
                autoComplete="off"
              />
              <input type="hidden" name="subtype" value="other" />
            </Field>
          )}
        </div>
      ) : subtypes.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What kind" htmlFor="subtype">
            <Select
              id="subtype"
              name="subtype"
              size="md"
              className="w-full"
              required
              value={subtype}
              onChange={(event) => setSubtype(event.target.value)}
            >
              <option value="">Choose…</option>
              {subtypes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          {subtype === 'other' && (
            <Field label="Say what it was" htmlFor="subtypeOther">
              <Input id="subtypeOther" name="subtypeOther" required maxLength={80} autoComplete="off" />
            </Field>
          )}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date incurred" htmlFor="incurredOn" hint="The month it belongs to.">
          <Input
            id="incurredOn"
            name="incurredOn"
            type="date"
            value={incurredOn}
            onChange={(event) => onIncurredOn(event.target.value)}
            max={today}
            required
          />
        </Field>

        <Field label="Paid on" htmlFor="paidOn" hint="Blank if not paid yet.">
          <Input id="paidOn" name="paidOn" type="date" max={today} />
        </Field>

        <Field label="Office" htmlFor="officeTeam">
          <Select
            id="officeTeam"
            name="officeTeam"
            size="md"
            className="w-full"
            value={office}
            onChange={(event) => onOffice(event.target.value)}
          >
            <option value="">Not office-specific</option>
            <option value="blue_area">Blue Area</option>
            <option value="wah">Wah</option>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid to" htmlFor="vendor" hint="Optional.">
          <Input id="vendor" name="vendor" maxLength={80} placeholder="K-Electric" autoComplete="off" />
        </Field>

        {/* ── ⚠️ THE RECEIPT, AND IT IS NOT OPTIONAL ────────────────────────
            Owner: *"Without a screenshot or things like that, it would not be
            acceptable that it's an expense."* Required here, and required again
            by `expenses_manual_needs_receipt` in migration 065 — so a row filed
            through any other path is refused too.

            ⚠️ `ProofField` rather than a bare file input, so the chosen image
            is SHOWN. Owner, 2026-08-27: *"when I upload some image, that image
            should still be displayed [...] instead of just displaying the
            name."* Phones name every screenshot the same way, so a filename
            cannot answer "is this the right slip?" — which is the one check the
            receipt rule exists to make possible. */}
        <ProofField
          name="receipt"
          label="Proof of payment"
          required
          hint={`The bill, slip or screenshot. Required — up to ${formatBytes(MAX_ATTACHMENT_BYTES)}.`}
        />
      </div>

      <Field label="Note" htmlFor="note" hint="Optional. Anything Finance should know.">
        <Textarea id="note" name="note" rows={2} maxLength={400} />
      </Field>
    </>
  );
}
