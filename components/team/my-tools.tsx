import * as React from 'react';
import { Sparkles } from 'lucide-react';

import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { MyTool } from '@/lib/db/queries/subscriptions';

/* ============================================================================
 * THE TOOLS ONE PERSON HOLDS
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26: *"each person can see which subscriptions they have, for
 * example Gemini, but the subscription cost is not compulsory to show them."*
 *
 * ── ⚠️ THERE IS NO PRICE HERE, AND NOT BECAUSE THIS DECLINES TO SHOW ONE ───
 * `MyTool` has no cost field. The query behind it never selects one, and
 * migration 063 puts every price in `public.subscription_costs`, whose policy is
 * Admin-and-above for reads. So a Member's RSC payload cannot contain a price
 * even by accident — there is nothing to redact, which is the only version of
 * this that survives somebody editing the component later.
 *
 * Compare `lib/view/project-finance.ts`, which is candid that its own fee-hiding
 * is a display gate a determined Coordinator could still get around. This is the
 * other kind.
 *
 * ── A SERVER COMPONENT ──────────────────────────────────────────────────────
 * Nothing here is interactive.
 * ========================================================================= */

export function MyTools({
  tools,
  isSelf,
  personName,
}: {
  tools: readonly MyTool[];
  /** Changes the wording only — whose tools these are is decided by RLS. */
  isSelf: boolean;
  personName?: string;
}) {
  const who = isSelf ? 'you' : (personName ?? 'they');

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent-primary" aria-hidden="true" />
            {isSelf ? 'Tools assigned to you' : 'Tools assigned'}
          </CardTitle>
          <CardDescription>
            {tools.length === 0
              ? `No AI tools are assigned to ${who} right now.`
              : `${tools.length} tool${tools.length === 1 ? '' : 's'} provided by the division.`}
          </CardDescription>
        </div>
      </CardHeader>

      <CardBody>
        {tools.length === 0 ? (
          <p className="py-4 text-caption text-text-tertiary">
            An Admin assigns these from the Finance page.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {tools.map((tool) => (
              <li
                key={tool.id}
                className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border-subtle bg-bg-surface-sunken px-3 py-2.5"
                style={{
                  /* Tinted from the tool's own token so the card reads as that
                     tool at a glance, in both themes. */
                  borderColor: `color-mix(in oklab, var(--${tool.token}) 32%, transparent)`,
                  backgroundColor: `color-mix(in oklab, var(--${tool.token}) 7%, var(--bg-surface))`,
                }}
              >
                <span
                  aria-hidden="true"
                  className="h-8 w-8 shrink-0 rounded-full"
                  style={{
                    background: `color-mix(in oklab, var(--${tool.token}) 22%, transparent)`,
                    border: `1px solid color-mix(in oklab, var(--${tool.token}) 45%, transparent)`,
                  }}
                />
                <div className="min-w-0">
                  <p className="truncate text-caption font-semibold text-text-primary">
                    {tool.name}
                  </p>
                  <p className="truncate text-micro text-text-tertiary">
                    {tool.vendor ? `${tool.vendor} · ` : ''}since {monthYear(tool.startedOn)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Jun 2026`. A seat's day of the month is noise nobody needs. */
function monthYear(date: string): string {
  const [y, m] = date.split('-');
  return `${MONTHS[Number(m)] ?? ''} ${y}`.trim();
}
