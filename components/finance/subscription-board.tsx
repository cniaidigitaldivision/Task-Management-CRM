'use client';

import * as React from 'react';
import { Loader2, Plus, Sparkles, UserMinus, Wallet } from 'lucide-react';

import { assignSeatAction, endSeatAction, setToolCostAction } from '@/app/actions/subscriptions';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { pkr } from '@/lib/domain/money';
import type { FinanceBoard } from '@/lib/view/finance-board';

/* ============================================================================
 * AI TOOLS — WHO HAS WHAT, AND WHAT IT COSTS
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26: *"I want to track how many of each subscription — Claude,
 * ChatGPT, Canva, Gemini, Flow — and to whom they are provided."*
 *
 * ── ⚠️ THIS IS THE ADMIN'S VIEW AND IT SHOWS PRICES ────────────────────────
 * The person's own view is `components/team/my-tools.tsx`, which shows the same
 * seats WITHOUT a cost — and not because it declines to render one: the query
 * behind it never selects a price, and migration 063 puts prices in a table a
 * Member's role cannot read. The separation is real, not cosmetic.
 * ========================================================================= */

export function SubscriptionBoard({
  board,
  people,
  canManage,
}: {
  board: FinanceBoard;
  people: readonly { id: string; name: string; roleTitle: string | null }[];
  canManage: boolean;
}) {
  const [assigning, setAssigning] = React.useState<string | null>(null);
  const [pricing, setPricing] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const tool = (id: string | null) => board.tools.find((t) => t.id === id) ?? null;

  const endSeat = async (seatId: string) => {
    setBusy(seatId);
    setError(null);
    const result = await endSeatAction(seatId);
    setBusy(null);
    if (!result.ok) setError(result.error);
  };

  const unpriced = board.tools.filter((t) => t.monthlyCostPkr === null && t.holders.length > 0);

  return (
    <div className="space-y-5">
      {/* ── The three figures ─────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Figure label="Tools" value={String(board.tools.length)} icon={Sparkles} token="accent-primary" />
        <Figure label="Seats assigned" value={String(board.seatCount)} icon={Plus} token="status-todo" />
        <Figure
          label="Monthly cost"
          value={pkr(board.toolSpend)}
          icon={Wallet}
          token="status-progress"
        />
      </div>

      {/* ⚠️ Named rather than left to be noticed. A tool with holders and no
          price contributes ZERO to every total on this page, which looks exactly
          like a tool that is free. */}
      {unpriced.length > 0 && (
        <p className="rounded-[var(--radius-sm)] border border-border-subtle bg-bg-surface-sunken px-3 py-2 text-caption text-text-secondary">
          {unpriced.map((t) => t.name).join(', ')}{' '}
          {unpriced.length === 1 ? 'has' : 'have'} people assigned but no price recorded, so{' '}
          {unpriced.length === 1 ? 'it counts' : 'they count'} as nothing in the totals above.
        </p>
      )}

      {error && (
        <p className="text-caption font-medium" role="alert" style={{ color: 'var(--feedback-error)' }}>
          {error}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {board.tools.map((item) => (
          <Card key={item.id} accentToken={item.token}>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: `var(--${item.token})` }}
                  />
                  {item.name}
                </CardTitle>
                <CardDescription>
                  {item.vendor ?? '—'} ·{' '}
                  {item.holders.length === 0
                    ? 'nobody assigned'
                    : `${item.holders.length} seat${item.holders.length === 1 ? '' : 's'}`}
                </CardDescription>
              </div>
            </CardHeader>

            <CardBody className="space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-caption text-text-secondary">
                  {item.monthlyCostPkr === null
                    ? 'No price recorded'
                    : item.seatsIncluded === null
                      ? `${pkr(item.monthlyCostPkr, item.currency)} per seat`
                      : `${pkr(item.monthlyCostPkr, item.currency)} for ${item.seatsIncluded} seats`}
                  {item.billingCycle === 'yearly' && (
                    <span className="ml-1 text-micro text-text-tertiary">(billed yearly)</span>
                  )}
                </span>
                <span className="tabular shrink-0 text-body font-bold text-text-primary">
                  {pkr(item.monthlySpend)}
                </span>
              </div>

              {item.holders.length > 0 && (
                <ul className="space-y-1.5">
                  {item.holders.map((holder) => (
                    <li key={holder.seatId} className="flex items-center gap-2">
                      <Avatar name={holder.fullName} src={holder.avatarUrl} size="xs" />
                      <span className="min-w-0 flex-1 truncate text-caption text-text-secondary">
                        {holder.fullName}
                      </span>
                      {canManage && (
                        <button
                          type="button"
                          disabled={busy === holder.seatId}
                          onClick={() => void endSeat(holder.seatId)}
                          title="End this seat. Past months keep their cost."
                          className="shrink-0 rounded p-1 text-text-tertiary transition-colors hover:bg-bg-surface-sunken hover:text-text-primary"
                        >
                          {busy === holder.seatId ? (
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          ) : (
                            <UserMinus className="h-3 w-3" aria-hidden="true" />
                          )}
                          <span className="sr-only">End {holder.fullName}&rsquo;s seat</span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canManage && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="secondary" onClick={() => setAssigning(item.id)}>
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    Assign
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPricing(item.id)}>
                    {item.monthlyCostPkr === null ? 'Set price' : 'Change price'}
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        ))}
      </div>

      {/* ── Assign a seat ─────────────────────────────────────────────────── */}
      {assigning && (
        <Dialog
          open
          onClose={() => setAssigning(null)}
          title={`Assign ${tool(assigning)?.name ?? 'a tool'}`}
          description="The person will see this on their own profile. They will not see what it costs."
        >
          <form
            id="assign-form"
            action={async (form) => {
              setBusy('assign');
              setError(null);
              const result = await assignSeatAction(form);
              setBusy(null);
              if (!result.ok) setError(result.error);
              else setAssigning(null);
            }}
            className="space-y-4"
          >
            <input type="hidden" name="subscriptionId" value={assigning} />

            <Field label="Person" htmlFor="userId">
              <Select id="userId" name="userId" size="md" className="w-full" required>
                {people
                  .filter(
                    (person) =>
                      !(tool(assigning)?.holders ?? []).some((h) => h.userId === person.id),
                  )
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                      {person.roleTitle ? ` — ${person.roleTitle}` : ''}
                    </option>
                  ))}
              </Select>
            </Field>

            <Field label="Since" htmlFor="startedOn" hint="Defaults to today.">
              <Input id="startedOn" name="startedOn" type="date" />
            </Field>
          </form>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" size="md" onClick={() => setAssigning(null)}>
              Cancel
            </Button>
            <Button type="submit" form="assign-form" variant="primary" size="md" disabled={busy === 'assign'}>
              {busy === 'assign' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Assign
            </Button>
          </div>
        </Dialog>
      )}

      {/* ── Price a tool ──────────────────────────────────────────────────── */}
      {pricing && (
        <Dialog
          open
          onClose={() => setPricing(null)}
          title={`What ${tool(pricing)?.name ?? 'this'} costs`}
          description="Used to post the monthly subscription line. Changing it never alters a month already posted."
        >
          <form
            id="price-form"
            action={async (form) => {
              setBusy('price');
              setError(null);
              const result = await setToolCostAction(form);
              setBusy(null);
              if (!result.ok) setError(result.error);
              else setPricing(null);
            }}
            className="space-y-4"
          >
            <input type="hidden" name="subscriptionId" value={pricing} />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cost (PKR)" htmlFor="monthlyCostPkr">
                <Input
                  id="monthlyCostPkr"
                  name="monthlyCostPkr"
                  required
                  inputMode="decimal"
                  defaultValue={tool(pricing)?.monthlyCostPkr ?? ''}
                  placeholder="5,600"
                />
              </Field>

              <Field label="Billed" htmlFor="billingCycle">
                <Select
                  id="billingCycle"
                  name="billingCycle"
                  size="md"
                  className="w-full"
                  defaultValue={tool(pricing)?.billingCycle ?? 'monthly'}
                >
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </Select>
              </Field>
            </div>

            <Field
              label="Seats included"
              htmlFor="seatsIncluded"
              hint="Leave blank when the price is per seat — then it scales with how many people hold it."
            >
              <Input
                id="seatsIncluded"
                name="seatsIncluded"
                inputMode="numeric"
                defaultValue={tool(pricing)?.seatsIncluded ?? ''}
                placeholder="Blank = per seat"
              />
            </Field>
          </form>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" size="md" onClick={() => setPricing(null)}>
              Cancel
            </Button>
            <Button type="submit" form="price-form" variant="primary" size="md" disabled={busy === 'price'}>
              {busy === 'price' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Save
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  icon: Icon,
  token,
}: {
  label: string;
  value: string;
  /** `style` included — the figure tints the glyph with its own token. */
  icon: React.ComponentType<{
    className?: string;
    strokeWidth?: number;
    style?: React.CSSProperties;
  }>;
  token: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border-default bg-bg-surface p-4">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(120% 100% at 100% 0%, color-mix(in oklab, var(--${token}) 18%, transparent) 0%, transparent 62%)`,
        }}
      />
      <div className="relative flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-caption text-text-secondary">{label}</p>
          <p className="tabular mt-1 text-h2 leading-none font-bold text-text-primary">{value}</p>
        </div>
        <Icon className="h-5 w-5 shrink-0" strokeWidth={2} style={{ color: `var(--${token})` }} aria-hidden="true" />
      </div>
    </div>
  );
}
