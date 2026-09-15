'use client';

import * as React from 'react';
import { X } from 'lucide-react';

import type { CrmLeadRow } from '@/lib/db/queries/crm-leads';
import { displayPhone } from '@/lib/domain/phone';
import { stageLabel, stageToken } from '@/lib/domain/crm-stages';
import { sourceDetail, sourceLabel } from '@/lib/domain/lead-source';
import { relativeAge } from '@/lib/view/relative-age';
import { cn } from '@/lib/utils';
import { TABS } from './lead-drawer';

/* ============================================================================
 * THE DRAWER, BEFORE THE SERVER HAS ANSWERED
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-15: *"if I click on a row, the drawer should open instantly
 * instead of it rendering… These are just UI clicks to view the same data in
 * detail, which is already loaded."*
 *
 * The second half of that sentence is the important one, and it is true. The row
 * that was just clicked already carries the name, the project, the stage, the
 * phone, the email, the city, the next action and the last message. Every one of
 * those was serialised into this page minutes ago. Waiting for Singapore to send
 * them a second time before drawing a panel is work nobody asked for.
 *
 * ⚠️ SO THIS OPENS IN THE CLICK'S OWN FRAME, from the row. What it genuinely
 * cannot know — the notes, the full message thread, the activity log, the
 * related quotations and appointments — is the only thing that waits, and it
 * waits inside an open panel rather than behind a blank screen.
 *
 * ⚠️ AND IT IS THE SAME FRAME, TO THE PIXEL, AS `LeadDrawer`. Identical width,
 * border, header layout and spacing — so when the real one replaces it nothing
 * jumps. A skeleton that resizes on arrival is worse than no skeleton: it draws
 * the eye to exactly the moment you wanted to hide.
 * ========================================================================= */

export function LeadDrawerShell({
  row,
  tab,
  nowMs,
  onTab,
  onClose,
}: {
  row: CrmLeadRow;
  /** Which tab was asked for, so the bar matches what arrives. */
  tab: string;
  /** Switching is instant — it never waits on the record. */
  onTab: (tab: string) => void;
  nowMs: number;
  onClose: () => void;
}) {
  const panel = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const phone = displayPhone(row.phoneE164, row.phone);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${row.fullName ?? 'Lead'} — details`}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-[36rem] flex-col border-l border-border-default bg-bg-surface shadow-2xl outline-none"
      >
        <div className="border-b border-border-subtle px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-body font-semibold text-text-primary">
                {row.fullName ?? 'Unnamed lead'}
              </h2>
              <p className="mt-0.5 truncate text-caption text-text-secondary">
                {[row.projectName, row.city].filter(Boolean).join(' · ') || '—'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-bg-subtle"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="rounded-lg border px-2 py-0.5 text-caption font-medium"
              style={{
                borderColor: `var(--${stageToken(row.stage)})`,
                color: `var(--${stageToken(row.stage)})`,
                backgroundColor: `color-mix(in oklab, var(--${stageToken(row.stage)}) 12%, transparent)`,
              }}
            >
              {stageLabel(row.stage)}
            </span>
            {phone !== '—' && (
              <span className="text-caption text-text-secondary">{phone}</span>
            )}
            {row.email && (
              <span className="truncate text-caption text-text-secondary">{row.email}</span>
            )}
          </div>
        </div>

        {/* ⚠️ THE TAB BAR IS HERE TOO, AND FROM THE SAME `TABS` DEFINITION.
            Leaving it out would mean a whole strip of interface appearing the
            instant the real drawer arrived, shoving the facts below it down —
            the exact jump this shell exists to avoid.

            ⚠️ AND THE TABS ARE REAL BUTTONS. They were spans, with a comment
            saying that was honest because "there is nothing yet to switch to".
            That reasoning was wrong, and the owner found why: *"while the notes
            are loading it's still waiting and not responding… don't I have to
            wait to view the notes while I have to switch the tab and see the
            other things?"*

            Quite. WHICH TAB IS OPEN IS THE READER'S CHOICE, NOT THE DATA'S. A
            bar that refuses to move until a fetch lands makes somebody wait for
            notes they did not ask to see in order to reach the conversation they
            did. The choice is recorded the instant it is made, and whatever is
            in hand for that tab is shown — which, from the row, is more than
            nothing for every one of them.

            ⚠️ AND NO COUNTS ON IT. The real bar shows "Conversations (4)" once it
            knows; a zero invented here would be read as "no messages" and is the
            kind of small lie somebody makes a decision on. */}
        <div className="flex gap-1 overflow-x-auto border-b border-border-subtle px-3 py-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onTab(t.key)}
              aria-pressed={t.key === tab}
              className={cn(
                'shrink-0 rounded-lg px-3 py-1.5 text-caption font-medium transition-colors',
                t.key === tab
                  ? 'bg-accent-primary text-white'
                  : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ⚠️ THE OVERVIEW IS DRAWN IN FULL, FROM THE ROW. Owner, 2026-09-15:
            *"the drawer is open but not showing any information instantly, while
            the same information is still displaying in the rows."* They were
            right — every line below was already on this page. Project, city,
            phone, email, source, what it came from, when they enquired and the
            next action are all carried by the row that was clicked, so asking
            Singapore for them again before drawing anything was pure waste.

            Only two things here genuinely need the server: what the person typed
            into the form, and the notes. Those say they are coming rather than
            pretending to be absent — ⚠️ "No notes yet" would be a LIE at this
            moment, and a lie somebody would act on. */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4" aria-busy="true">
          {/* ⚠️ EVERY TAB SHOWS WHAT THE ROW ALREADY KNOWS, not a spinner. The
              row carries the last message, the next action, the quotation and
              when something last happened — so a reader who switches tabs before
              the record lands still gets the headline of the thing they asked
              for, with only the depth still coming. */}
          {tab === 'overview' && (
            <>
          <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-4 gap-y-2">
                {(
                  [
                    ['Project', row.projectName],
                    ['City', row.city],
                    ['Phone', phone === '—' ? null : phone],
                    ['Email', row.email],
                    [
                      'Source',
                      row.source
                        ? `${sourceLabel(row.source)}${
                            sourceDetail(row.source, row.sourceDetail)
                              ? ` · ${sourceDetail(row.source, row.sourceDetail)}`
                              : ''
                          }`
                        : null,
                    ],
                    ['Came from', row.campaignName ?? row.formName],
                    ['Enquired', relativeAge(row.submittedAt, nowMs)],
                    ['Next action', row.nextAction],
                    ['Unit', row.propertyLabel],
                  ] as ReadonlyArray<readonly [string, string | null]>
                )
                  .filter(([, value]) => Boolean(value))
                  .map(([label, value]) => (
                    <React.Fragment key={label}>
                      <dt className="text-caption text-text-tertiary">{label}</dt>
                      <dd className="min-w-0 break-words text-body-sm text-text-primary">{value}</dd>
                    </React.Fragment>
                  ))}
              </dl>

              {row.lastMessageBody && (
                <section>
                  <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
                    Last message
                  </h3>
                  <p className="rounded-lg border border-border-subtle px-3 py-2 text-body-sm text-text-primary">
                    {row.lastMessageBody}
                  </p>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
                  Notes ({row.noteCount})
                </h3>
                <p className="text-caption text-text-tertiary">
                  {row.noteCount === 0 ? 'Checking…' : 'Loading…'}
                </p>
              </section>

            </>
          )}

          {tab === 'conversations' && (
            <section>
              {row.lastMessageBody ? (
                <>
                  <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
                    Last message · {relativeAge(row.lastMessageAt ?? row.submittedAt, nowMs)}
                  </h3>
                  <p className="rounded-lg border border-border-subtle px-3 py-2 text-body-sm text-text-primary">
                    {row.lastMessageBody}
                  </p>
                  <p className="mt-2 text-caption text-text-tertiary">Loading the rest of the thread…</p>
                </>
              ) : (
                <p className="text-caption text-text-tertiary">Loading the conversation…</p>
              )}
            </section>
          )}

          {tab === 'followups' && (
            <section>
              {row.nextAction ? (
                <>
                  <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
                    Next action
                  </h3>
                  <p className="text-body-sm text-text-primary">{row.nextAction}</p>
                  {row.nextActionAt && (
                    <p className="mt-0.5 text-caption text-text-secondary">
                      {relativeAge(row.nextActionAt, nowMs)}
                    </p>
                  )}
                  <p className="mt-2 text-caption text-text-tertiary">Loading the rest…</p>
                </>
              ) : (
                <p className="text-caption text-text-tertiary">Loading follow-ups…</p>
              )}
            </section>
          )}

          {tab === 'related' && (
            <section>
              {row.quotationNumber ? (
                <>
                  <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
                    Quotation
                  </h3>
                  <p className="text-body-sm text-text-primary">
                    {row.quotationNumber}
                    {row.quotationAmount !== null && (
                      <span className="tabular-nums text-text-secondary">
                        {' '}· PKR {row.quotationAmount.toLocaleString('en-PK')}
                      </span>
                    )}
                  </p>
                  {row.propertyLabel && (
                    <p className="mt-0.5 text-caption text-text-secondary">{row.propertyLabel}</p>
                  )}
                  <p className="mt-2 text-caption text-text-tertiary">Loading the rest…</p>
                </>
              ) : (
                <p className="text-caption text-text-tertiary">Loading related items…</p>
              )}
            </section>
          )}

          {tab === 'activity' && (
            <p className="text-caption text-text-tertiary">Loading the activity log…</p>
          )}

          <span className="sr-only">Loading the rest of the record</span>
        </div>
      </div>
    </div>
  );
}
