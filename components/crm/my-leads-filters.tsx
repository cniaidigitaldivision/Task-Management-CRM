'use client';

import * as React from 'react';
import { ChevronDown, X } from 'lucide-react';

import { SourceMark } from '@/components/crm/source-mark';
import { sourceLabel } from '@/lib/domain/lead-source';
import { priorityLabel, priorityToken } from '@/lib/domain/lead-priority';
import {
  STAGE_ORDER,
  stageLabel,
  TEMPERATURES,
  temperatureLabel,
  temperatureToken,
} from '@/lib/domain/crm-stages';
import { cn } from '@/lib/utils';

/* ============================================================================
 * MORE FILTERS — the drawer on /my-leads
 * ----------------------------------------------------------------------------
 * Owner, 2026-10-01: *"when I click on the More filter, it is not showing me
 * anything. I want that when I click on the More filter, it shows me a drawer.
 * The drawer will show all the respective filters… priority-wise, source-wise,
 * stages… project-wise… hot or normal."*
 *
 * ── ⚠️ WHAT THE BUTTON USED TO DO ──────────────────────────────────────────
 * `onClick={() => setDue('no-plan')}`. It opened nothing and silently applied
 * an unrelated filter — leads with no next action — so the list changed under
 * the reader and no panel appeared. That is worse than a dead button: a dead
 * button looks broken, and this looked like the data had gone.
 *
 * ── ⚠️ IT DRAFTS, THEN APPLIES ONCE ────────────────────────────────────────
 * Every other control on that page is one filter and one navigation, which is
 * right for one control and wrong for seven: three filters would cost three
 * full server renders of a page that also holds the diary, the approvals and
 * the counts. The panel holds a draft and commits it in a single push.
 *
 * ⚠️ AND OPENING IT IS FREE — client state, and every option it offers travelled
 * in the page's own query wave. Rule Zero, laws 1 and 4.
 *
 * ── ⚠️ "PRIORITY" AND "HOT OR NORMAL" ARE TWO COLUMNS, NOT ONE ────────────
 * My first draft of this panel folded them together, on the assumption that
 * `temperature` was what the owner meant by both. It was not, and the page they
 * were looking at proves it: the table already prints a **Priority** column of
 * High/Normal beside nothing else, and `lib/domain/lead-priority.ts` keeps the
 * two deliberately apart —
 *
 *     temperature → will they buy?       set by a salesperson, after talking
 *     priority    → who do I ring first? set by the clock
 *
 * So there are two sections. Priority is DERIVED, so nothing is stored to
 * filter on and the rule is transcribed into SQL beside the reader — with
 * `lib/db/queries/__tests__/lead-priority-agrees.test.ts` driving the same
 * inputs through both and refusing to pass if one case differs. That file's own
 * header says why: *"Two definitions of 'high priority' on two screens is how
 * somebody stops trusting both."*
 *
 * ⚠️ AND THERE IS NO CATEGORY ON A LEAD. It exists on a PROPERTY — Corner, Park
 * facing, Boulevard — and a lead is not a plot. An empty Category section would
 * be a control that filters nothing; "Came from" is the question that was
 * actually being asked, and it has real answers behind it.
 * ========================================================================= */

export interface MyLeadsFilterState {
  readonly stage: string | null;
  readonly due: string | null;
  readonly temperature: string | null;
  readonly priority: string | null;
  readonly source: string | null;
  readonly formId: string | null;
  readonly from: string | null;
  readonly to: string | null;
}

interface ProjectChoice {
  readonly id: string;
  readonly name: string;
}

const EMPTY = {
  project: '', stage: '', due: '', temp: '', priority: '', source: '', form: '', from: '', to: '',
};
type Draft = typeof EMPTY;

export function MyLeadsFilterDrawer({
  close,
  apply,
  filters,
  projects,
  selectedProjectId,
  stageCounts,
  sources,
  forms,
}: {
  close: () => void;
  apply: (patch: Readonly<Record<string, string | null>>) => void;
  filters: MyLeadsFilterState;
  projects: readonly ProjectChoice[];
  selectedProjectId: string | null;
  stageCounts: Record<string, number>;
  sources: readonly { id: string; leads: number }[];
  forms: readonly { id: string; name: string; leads: number }[];
}) {
  /* Seeded from what is live, so the panel opens telling the truth about the
     list behind it. */
  const [draft, setDraft] = React.useState<Draft>({
    project: selectedProjectId ?? '',
    stage: filters.stage ?? '',
    due: filters.due ?? '',
    temp: filters.temperature ?? '',
    priority: filters.priority ?? '',
    source: filters.source ?? '',
    form: filters.formId ?? '',
    from: filters.from ?? '',
    to: filters.to ?? '',
  });
  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const commit = (next: Draft) => {
    apply({
      project: next.project || null,
      stage: next.stage || null,
      due: next.due || null,
      temp: next.temp || null,
      priority: next.priority || null,
      source: next.source || null,
      form: next.form || null,
      from: next.from || null,
      to: next.to || null,
    });
    close();
  };

  const chosen = Object.values(draft).filter(Boolean).length;

  return (
    /* ⚠️ THE SAME SHELL AS THE LEAD DRAWER on this page — `fixed inset-0 z-50
       flex justify-end`, a scrim BUTTON rather than a div so it is dismissable
       without a mouse, a bordered panel. Two panels sliding in from the same
       edge that do not match is how one screen starts to feel like two
       products. */
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close filters"
        onClick={close}
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="More filters"
        /* 24rem — 346px on screen under the app's 0.9 zoom. Narrower than the
           lead drawer's 38rem on purpose: this holds one column of controls,
           and a wide panel of half-empty rows reads as unfinished. */
        className="relative flex h-full w-full max-w-[24rem] flex-col border-l border-border-default bg-bg-surface shadow-2xl outline-none"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-h3 font-semibold text-text-primary">More filters</h2>
            <p className="mt-0.5 text-caption text-text-secondary">
              {chosen === 0
                ? 'Nothing narrowed yet.'
                : `${chosen} ${chosen === 1 ? 'filter' : 'filters'} ready to apply.`}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-border-default text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <Block label="Project" hint="Which scheme or client these leads belong to.">
            <Pick
              label="Project"
              value={draft.project}
              onChange={(v) => set('project', v)}
              options={[
                { value: '', label: 'All my projects' },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </Block>

          <Block label="Stage" hint="Where the conversation has reached.">
            <Pick
              label="Stage"
              value={draft.stage}
              onChange={(v) => set('stage', v)}
              options={[
                { value: '', label: 'Any stage' },
                ...STAGE_ORDER.map((st) => ({
                  value: st,
                  label: `${stageLabel(st)}${stageCounts[st] ? ` (${stageCounts[st]})` : ''}`,
                })),
              ]}
            />
          </Block>

          {/* ── ⚠️ PRIORITY AND TEMPERATURE ARE TWO COLUMNS, NOT ONE ────────
              The owner listed "priority-wise" and "hot or normal" as separate
              lines and they were right to: this page shows BOTH, and they
              answer different questions. `lib/domain/lead-priority.ts` puts it
              in a table of its own —

                  temperature → will they buy?      set by a salesperson
                  priority    → who do I ring first? set by the clock

              Priority is the column the table already prints as High/Normal;
              it is DERIVED, so there is nothing stored to filter on and the
              rule is transcribed into SQL beside the reader, with a test that
              refuses to pass if the two ever disagree. */}
          <Block
            label="Priority"
            hint="Who to ring first. Worked out from the clock — an unanswered message or an overdue action."
          >
            <div className="flex flex-wrap gap-1.5">
              <Chip on={draft.priority === ''} onClick={() => set('priority', '')} label="Any" />
              {(['high', 'normal', 'low'] as const).map((lv) => (
                <Chip
                  key={lv}
                  on={draft.priority === lv}
                  onClick={() => set('priority', draft.priority === lv ? '' : lv)}
                  label={priorityLabel(lv)}
                  dot={`var(--${priorityToken(lv)})`}
                />
              ))}
            </div>
          </Block>

          {/* ⚠️ CHIPS, NOT A DROPDOWN. Three values, each with a colour this
              product already uses for it everywhere else. A select would hide
              the one thing that makes the row readable at a glance. */}
          <Block
            label="Temperature"
            hint="How warm they are — the priority a salesperson works to."
          >
            <div className="flex flex-wrap gap-1.5">
              <Chip on={draft.temp === ''} onClick={() => set('temp', '')} label="Any" />
              {TEMPERATURES.map((t) => (
                <Chip
                  key={t}
                  on={draft.temp === t}
                  onClick={() => set('temp', draft.temp === t ? '' : t)}
                  label={temperatureLabel(t)}
                  dot={`var(--${temperatureToken(t)})`}
                />
              ))}
            </div>
          </Block>

          {sources.length > 0 && (
            <Block label="Came from" hint="The channel the enquiry arrived on.">
              <div className="flex flex-wrap gap-1.5">
                <Chip
                  on={draft.source === ''}
                  onClick={() => set('source', '')}
                  label="Any channel"
                />
                {sources.map((sc) => (
                  <Chip
                    key={sc.id}
                    on={draft.source === sc.id}
                    onClick={() => set('source', draft.source === sc.id ? '' : sc.id)}
                    label={`${sourceLabel(sc.id)} (${sc.leads})`}
                    mark={sc.id}
                  />
                ))}
              </div>
            </Block>
          )}

          <Block
            label="What is owed"
            hint="The same tabs as above, kept here so one panel holds everything."
          >
            <Pick
              label="What is owed"
              value={draft.due}
              onChange={(v) => set('due', v)}
              options={[
                { value: '', label: 'Anything' },
                { value: 'overdue', label: 'Needs attention' },
                { value: 'today', label: 'Due today' },
                { value: 'waiting', label: 'Waiting for reply' },
                { value: 'no-plan', label: 'No next action set' },
                { value: 'upcoming', label: 'Upcoming' },
                { value: 'closed', label: 'Closed' },
              ]}
            />
          </Block>

          {/* ⚠️ ONLY WITH A PROJECT IN VIEW. A form belongs to one client, and
              offering Chitral's forms while the list spans every project filters
              to something nobody meant. The page sends an empty list otherwise
              and this section simply does not appear. */}
          {forms.length > 0 && (
            <Block label="Form" hint="The Meta lead form the enquiry came through.">
              <Pick
                label="Form"
                value={draft.form}
                onChange={(v) => set('form', v)}
                options={[
                  { value: '', label: 'All forms' },
                  ...forms.map((f) => ({ value: f.id, label: `${f.name} (${f.leads})` })),
                ]}
              />
            </Block>
          )}

          <Block
            label="Enquired between"
            hint="When THEY got in touch — not when we imported them."
          >
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label="Enquired from"
                value={draft.from}
                onChange={(e) => set('from', e.target.value)}
                className="min-h-[2.4rem] min-w-0 flex-1 rounded-lg border border-border-subtle bg-bg-surface px-2 text-caption text-text-primary focus:border-accent-primary focus:outline-none"
              />
              <span className="text-caption text-text-tertiary">to</span>
              <input
                type="date"
                aria-label="Enquired to"
                value={draft.to}
                onChange={(e) => set('to', e.target.value)}
                className="min-h-[2.4rem] min-w-0 flex-1 rounded-lg border border-border-subtle bg-bg-surface px-2 text-caption text-text-primary focus:border-accent-primary focus:outline-none"
              />
            </div>
          </Block>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-5 py-3">
          {/* ⚠️ CLEAR APPLIES TOO. A "Clear all" that only empties the draft
              leaves the list still filtered behind a panel that says nothing is
              set — the one state in which this control would be a lie. */}
          <button
            type="button"
            onClick={() => { setDraft(EMPTY); commit(EMPTY); }}
            className="rounded-xl px-3 py-2 text-body-sm font-medium text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={() => commit(draft)}
            className="ml-auto rounded-xl bg-accent-primary px-4 py-2 text-body-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Apply filters
          </button>
        </div>
      </div>
    </div>
  );
}

/** One labelled section — the panel's whole rhythm lives here. */
function Block({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-caption font-semibold text-text-primary">{label}</p>
      {/* ⚠️ SECONDARY, NOT TERTIARY. Tertiary measures 3.94:1 in light against a
          4.5:1 floor — the same reading that moved the lead record's field
          labels up a step. */}
      <p className="mb-2 mt-0.5 text-micro leading-relaxed text-text-secondary">{hint}</p>
      {children}
    </div>
  );
}

function Pick({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[2.4rem] w-full cursor-pointer appearance-none rounded-lg border border-border-subtle bg-bg-surface px-3 pr-9 text-body-sm text-text-primary transition-colors hover:border-border-default focus:border-accent-primary focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
      />
    </div>
  );
}

/** A togglable pill. `dot` tints it; `mark` draws the channel's own logo. */
function Chip({
  on,
  onClick,
  label,
  dot,
  mark,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  dot?: string;
  mark?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-caption font-medium transition-colors',
        on
          ? 'border-accent-primary bg-[color-mix(in_oklab,var(--accent-primary)_10%,transparent)] text-text-primary'
          : 'border-border-subtle text-text-secondary hover:border-border-default hover:text-text-primary',
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: dot }}
        />
      )}
      {mark && <SourceMark source={mark} size={14} />}
      {label}
    </button>
  );
}
