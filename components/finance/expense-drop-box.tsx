'use client';

import * as React from 'react';
import {
  AppWindow, Building2, Car, Check, Laptop, Loader2, Megaphone,
  Receipt, Sparkles, Users, Wifi, Zap,
} from 'lucide-react';

import { recordExpenseAction } from '@/app/actions/finance';
import { ExpenseFields, type PersonOption, type ToolOption } from '@/components/finance/expense-fields';
import type { ExpenseCategory } from '@/lib/db/queries/finance';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/* ============================================================================
 * FILING AN EXPENSE — THE COORDINATOR'S WHOLE SCREEN
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26: *"the team coordinator can also add expenses. The list of
 * expenses, their report, or their analysis should only be visible to the admin
 * and the super admin."*
 *
 * ── ⚠️ NOTHING IS SHOWN BACK, AND THAT IS THE FEATURE ──────────────────────
 * No list of what was filed, no running total, not even "you have filed 3 this
 * month". Every one of those is analysis, and analysis is not theirs. The
 * confirmation names the act and nothing about the ledger.
 *
 * This is not merely a component that declines to render things: the server
 * never sends them. `app/(app)/finance/page.tsx` returns before any figure is
 * read, so the RSC payload behind this screen contains category names and
 * nothing else. See the note there.
 *
 * ── ⚠️ EVERY FILING CARRIES ITS RECEIPT ────────────────────────────────────
 * Owner: *"How can I trust him? It's not about trust, it's about accuracy [...]
 * Without a screenshot or things like that, it would not be acceptable that
 * it's an expense."* The field is required here and the table refuses a row
 * without one, so no path files a bare claim.
 *
 * ── ⚠️ THIS FORM SUBMITS BY HANDLER, NOT BY `action={...}` ─────────────────
 * React 19 resets a form after its `action` prop resolves, and that reset lands
 * AFTER the re-render the handler triggers — so the office came back blank on
 * every successful file even while component state still held it. Verified both
 * ways: the state survives an ordinary re-render (a category click keeps it)
 * and is wiped only by a submit. Submitting through `onSubmit` avoids the
 * behaviour rather than fighting it, and makes the clearing explicit.
 * ========================================================================= */

type IconProps = { className?: string; style?: React.CSSProperties; strokeWidth?: number };

const ICONS: Readonly<Record<string, React.ComponentType<IconProps>>> = {
  Users, Building2, Zap, Wifi, Sparkles, Laptop, AppWindow, Megaphone, Car, Receipt,
};

/* ⚠️ Icons are looked up by NAME from this map, never passed as components.
   A lucide icon is a function, and functions cannot cross the server-to-client
   boundary — doing so throws "Functions cannot be passed directly to Client
   Components" at runtime. The category row carries a string for this reason. */
function iconFor(name: string): React.ComponentType<IconProps> {
  return ICONS[name] ?? Receipt;
}

export function ExpenseDropBox({
  categories,
  canFile,
  tools,
  people,
}: {
  categories: readonly ExpenseCategory[];
  canFile: boolean;
  tools: readonly ToolOption[];
  people: readonly PersonOption[];
}) {
  const formRef = React.useRef<HTMLFormElement>(null);

  /* ── ⚠️ SALARIES ARE NOT OFFERED AT ALL ───────────────────────────────────
     Owner: *"salaries should not be in the category because salary should
     definitely be assigned, or you can say linked, with some employee. It is
     not a separate entity so exclude this salary from here."*

     Filtered on `postedOnly`, which migration 065 sets on the category itself —
     so a category the owner later marks the same way disappears from here
     without a code change. The trigger in that migration refuses a hand-filed
     salary even if this list were bypassed. */
  const filable = categories.filter((c) => !c.postedOnly);

  const [categoryId, setCategoryId] = React.useState(() => filable[0]?.id ?? '');
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  /* Today in Karachi, so the default date matches every other date in the app.
     Computed once per mount rather than per render — a value that changes while
     somebody is typing is a value that can change between reading and saving. */
  const [today] = React.useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
  );

  /* Controlled, so they survive the post-submit clear — see the header. */
  const [incurredOn, setIncurredOn] = React.useState(today);
  const [office, setOffice] = React.useState('');
  const [amount, setAmount] = React.useState('');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const el = event.currentTarget;

    setBusy(true);
    setResult(null);

    const response = await recordExpenseAction(new FormData(el));
    setBusy(false);

    if (!response.ok) {
      setResult({ ok: false, message: response.error });
      return;
    }

    setResult({ ok: true, message: response.message });

    /* ⚠️ Exactly these, and no `el.reset()`. Reset would also clear the date and
       the office, which is what the header says must carry over: somebody
       filing the month's bills files six in a row from the same office for the
       same month. Carrying the AMOUNT over, on the other hand, is how the same
       figure gets filed twice — so it goes, and so does the receipt, because
       one slip must never be attached to two claims. */
    setAmount('');
    for (const name of ['title', 'vendor', 'note', 'receipt', 'subtypeOther'] as const) {
      const field = el.elements.namedItem(name);
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        field.value = '';
      }
    }

    const title = el.elements.namedItem('title');
    if (title instanceof HTMLInputElement) title.focus();
  };

  if (!canFile) {
    return (
      <Card>
        <CardBody>
          <p className="text-caption text-text-tertiary">
            You do not have permission to file an expense.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card lit>
        <CardHeader>
          <div>
            <CardTitle>What was spent</CardTitle>
            <CardDescription>
              A bill, a purchase, a subscription — anything the division paid for.
            </CardDescription>
          </div>
        </CardHeader>

        <CardBody>
          <form ref={formRef} onSubmit={submit} className="space-y-4">
            {/* ── The category, as tiles ──────────────────────────────────────
                A dropdown would be one line and would hide the options behind a
                click. These are the things this form exists to record, so they
                are the first thing on it. */}
            <fieldset>
              <legend className="mb-2 text-caption font-medium text-text-secondary">
                Category
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {filable.map((category) => {
                  const Icon = iconFor(category.icon);
                  const active = category.id === categoryId;
                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setCategoryId(category.id)}
                      aria-pressed={active}
                      className={cn(
                        'group flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] border px-2 py-3 text-center transition-all duration-[var(--duration-fast)]',
                        active
                          ? 'border-transparent shadow-[var(--shadow-sm)]'
                          : 'border-border-subtle bg-bg-surface hover:border-border-strong hover:bg-bg-surface-raised',
                      )}
                      style={
                        active
                          ? {
                              /* Tinted from the category's own token, so the
                                 selection is the colour that category carries
                                 everywhere else on the ledger. */
                              backgroundColor: `color-mix(in oklab, var(--${category.token}) 14%, var(--bg-surface))`,
                              borderColor: `color-mix(in oklab, var(--${category.token}) 45%, transparent)`,
                            }
                          : undefined
                      }
                    >
                      <Icon
                        className="h-4 w-4"
                        aria-hidden="true"
                        style={{ color: `var(--${category.token})` }}
                      />
                      <span
                        className={cn(
                          'text-micro leading-tight',
                          active ? 'font-semibold text-text-primary' : 'text-text-secondary',
                        )}
                      >
                        {category.name}
                      </span>
                    </button>
                  );
                })}
              </div>
              <input type="hidden" name="categoryId" value={categoryId} />
            </fieldset>

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

            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary" size="md" disabled={busy || categoryId === ''}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-4 w-4" aria-hidden="true" />
                )}
                File expense
              </Button>

              {result && (
                <p
                  className="text-caption font-medium"
                  role="status"
                  style={{
                    color: result.ok ? 'var(--feedback-success)' : 'var(--feedback-error)',
                  }}
                >
                  {result.message}
                </p>
              )}
            </div>
          </form>
        </CardBody>
      </Card>

      {/* ── What happens next ──────────────────────────────────────────────
          Explains the absence rather than leaving it to be discovered. A
          Coordinator who files something and sees nothing come back will
          otherwise reasonably assume the button is broken and file it again. */}
      <Card>
        <CardHeader>
          <CardTitle>What happens to it</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3 text-caption text-text-secondary">
          <p>
            Filed expenses go straight to Finance. They are counted in the division&rsquo;s
            monthly profit and loss from the date you enter, not the date they are paid.
          </p>
          <p>
            <strong className="font-semibold text-text-primary">Every expense needs its
            proof</strong> — the bill, the slip or a screenshot of the payment. An entry
            without one is not recorded.
          </p>
          <p>
            The ledger, its totals and its reports are visible to Admins only, so nothing
            appears back on this screen once you file. Your submission is recorded against
            your name.
          </p>
          <p className="text-text-tertiary">
            Salaries and AI tool subscriptions are posted automatically each month — you do
            not need to file those.
          </p>
          <p className="text-text-tertiary">
            A filed expense cannot be edited afterwards. If something is wrong, an Admin
            deletes it and you file it again.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
