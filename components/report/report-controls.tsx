'use client';

import * as React from 'react';
import {
  ArrowDownUp,
  ChevronDown,
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  Loader2,
  Printer,
} from 'lucide-react';

import type { FilterOptions } from '@/app/actions/reports';
import { PlatformIcon } from '@/components/brand/platform-icon';
import { Select } from '@/components/ui/select';
import {
  CONTENT_KINDS,
  CONTENT_KIND_LABEL,
  STATUS_META,
  TASK_STATUSES,
  type ContentKind,
  type TaskStatus,
} from '@/lib/domain/constants';
import { PERIOD_LABEL, PERIOD_PRESETS, REPORT_META, REPORT_TYPES, type PeriodPreset, type ReportFilters, type ReportType } from '@/lib/domain/reports';
import { WORK_SORTS, WORK_SORT_LABEL, type WorkSort } from '@/lib/domain/work-report';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE CONTROL PANEL
 * ----------------------------------------------------------------------------
 * The owner's mockup: one card, eight controls in two rows, labels above each,
 * and Export sitting at the end of the second row.
 *
 * ── ⚠️ WHY LABELS ABOVE AND NOT A TOOLBAR ───────────────────────────────────
 * This replaced an inline toolbar where each control carried only an aria-label
 * and its current value. That works for two or three controls and stops working
 * at eight: "All projects", "All members", "All statuses" and "All content types"
 * are four dropdowns that read almost identically, and with nothing above them a
 * reader has to open one to find out which is which. The mockup labels every one,
 * and that is why.
 *
 * ── ⚠️ SINGLE-SELECT, MATCHING THE MOCKUP ───────────────────────────────────
 * An earlier build made Project, Status and Content multi-select popovers. The
 * mockup draws plain dropdowns reading "All projects", so these are single-choice
 * and "All" is the empty filter. The underlying `ReportFilters` still holds arrays
 * — the engine, the exports and the audit row all speak arrays — so a dropdown
 * simply writes an array of one or an empty one. Nothing downstream had to change,
 * and multi-select stays possible later without another migration of the shape.
 *
 * PLATFORM is the exception and stays multi-select, because the mockup draws it as
 * a row of brand tiles rather than a dropdown — five toggles, any combination.
 * ========================================================================= */

export interface ControlState {
  readonly work: boolean;
  readonly type: ReportType;
  readonly preset: PeriodPreset | 'custom';
  readonly start?: string;
  readonly end?: string;
  readonly subjectId: string | null;
  readonly filters: ReportFilters;
  readonly workSort: WorkSort;
  readonly workDirection: 'asc' | 'desc';
}

export type ExportFormat = 'pdf' | 'xlsx' | 'csv' | 'print';

/** `work` plus the four analytical types, in one control — as the mockup draws it. */
const TYPE_OPTIONS = [
  { value: 'work', label: 'Work reports' },
  ...REPORT_TYPES.map((t) => ({ value: t, label: REPORT_META[t].label })),
];

export function ReportControls({
  state,
  options,
  people,
  busy,
  downloading,
  onChange,
  onExport,
}: {
  state: ControlState;
  options: FilterOptions;
  people: ReadonlyArray<{ id: string; name: string }>;
  busy: boolean;
  downloading: ExportFormat | null;
  onChange: (next: ControlState) => void;
  onExport: (format: ExportFormat) => void;
}) {
  const set = (patch: Partial<ControlState>) => onChange({ ...state, ...patch });

  /* The arrays the engine wants, written from a single-choice dropdown. */
  const one = <T extends string>(list: readonly T[]): string => (list.length === 1 ? list[0] : '');

  return (
    <section
      aria-label="Report filters"
      className="rounded-2xl border border-border-default bg-bg-surface p-4 print:hidden"
    >
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <Field label="Report type">
          <Select
            label="Report type"
            value={state.work ? 'work' : state.type}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'work') set({ work: true });
              else set({ work: false, type: value as ReportType });
            }}
            options={TYPE_OPTIONS}
            className="w-[11rem]"
          />
        </Field>

        <Field label="Period">
          <Select
            label="Period"
            value={state.preset}
            onChange={(event) => set({ preset: event.target.value as PeriodPreset | 'custom' })}
            options={[
              ...PERIOD_PRESETS.map((p) => ({ value: p, label: PERIOD_LABEL[p] })),
              { value: 'custom', label: 'Custom range…' },
            ]}
            className="w-[9.5rem]"
          />
        </Field>

        <Field label="Project">
          <Select
            label="Project"
            value={one(state.filters.projectIds)}
            onChange={(event) =>
              set({
                filters: {
                  ...state.filters,
                  projectIds: event.target.value ? [event.target.value] : [],
                },
              })
            }
            options={[
              { value: '', label: 'All projects' },
              ...options.projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
            className="w-[11rem]"
          />
        </Field>

        <Field label="Person">
          <Select
            label="Person"
            value={state.subjectId ?? ''}
            onChange={(event) => set({ subjectId: event.target.value || null })}
            options={[
              { value: '', label: 'All members' },
              ...people.map((p) => ({ value: p.id, label: p.name })),
            ]}
            className="w-[11rem]"
          />
        </Field>

        <Field label="Status">
          <Select
            label="Status"
            value={one(state.filters.statuses)}
            onChange={(event) =>
              set({
                filters: {
                  ...state.filters,
                  statuses: event.target.value ? [event.target.value as TaskStatus] : [],
                },
              })
            }
            options={[
              { value: '', label: 'All statuses' },
              ...TASK_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label })),
            ]}
            className="w-[10rem]"
          />
        </Field>

        {options.platforms.length > 0 && (
          <Field label="Platform">
            <PlatformToggles
              all={options.platforms}
              selected={state.filters.platforms}
              onChange={(platforms) => set({ filters: { ...state.filters, platforms } })}
            />
          </Field>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
        <Field label="Content type">
          <Select
            label="Content type"
            value={one(state.filters.contentKinds)}
            onChange={(event) =>
              set({
                filters: {
                  ...state.filters,
                  contentKinds: event.target.value
                    ? [event.target.value as ContentKind | 'none']
                    : [],
                },
              })
            }
            options={[
              { value: '', label: 'All content types' },
              ...CONTENT_KINDS.map((k) => ({ value: k, label: CONTENT_KIND_LABEL[k] })),
              /* ⚠️ How the executives' oversight work is selected — it has no
                 content kind at all, so no list of real kinds can reach it. */
              { value: 'none', label: 'Not content (reviews, calls)' },
            ]}
            className="w-[13rem]"
          />
        </Field>

        <Field label="Sort by">
          <div className="flex items-center gap-2">
            <Select
              label="Sort by"
              value={state.workSort}
              onChange={(event) => set({ workSort: event.target.value as WorkSort })}
              options={WORK_SORTS.map((s) => ({ value: s, label: WORK_SORT_LABEL[s] }))}
              className="w-[11rem]"
            />
            <button
              type="button"
              onClick={() =>
                set({ workDirection: state.workDirection === 'desc' ? 'asc' : 'desc' })
              }
              aria-label={
                state.workDirection === 'desc'
                  ? 'Sorted highest first — switch to lowest first'
                  : 'Sorted lowest first — switch to highest first'
              }
              title={state.workDirection === 'desc' ? 'Highest first' : 'Lowest first'}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                'border-border-default text-text-secondary',
                'hover:border-border-strong hover:bg-bg-hover hover:text-text-primary',
              )}
            >
              <ArrowDownUp
                className={cn('size-4 transition-transform', state.workDirection === 'asc' && 'scale-y-[-1]')}
                strokeWidth={2.25}
                aria-hidden="true"
              />
            </button>
          </div>
        </Field>

        <div className="ml-auto flex items-end gap-2">
          {busy && (
            <span className="mb-2 flex items-center gap-1.5 text-caption text-text-secondary">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Recalculating
            </span>
          )}
          <ExportMenu downloading={downloading} onChoose={onExport} />
        </div>
      </div>

      {state.preset === 'custom' && (
        <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
          <Field label="From">
            <input
              type="date"
              aria-label="Period start"
              value={state.start ?? ''}
              onChange={(event) => set({ start: event.target.value })}
              className={DATE_FIELD}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              aria-label="Period end"
              value={state.end ?? ''}
              onChange={(event) => set({ end: event.target.value })}
              className={DATE_FIELD}
            />
          </Field>
        </div>
      )}
    </section>
  );
}

const DATE_FIELD =
  'h-9 rounded-lg border border-border-default bg-bg-surface px-2.5 text-caption ' +
  'text-text-primary focus-visible:outline-none focus-visible:border-border-brand';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-micro font-medium text-text-tertiary">{label}</span>
      {children}
    </div>
  );
}

/* ---- Platform tiles ------------------------------------------------------ */

/**
 * The mockup draws platforms as brand tiles, not as a dropdown — so they toggle.
 *
 * ── ⚠️ THE SELECTED STATE, WHICH TOOK THREE ATTEMPTS ────────────────────────
 * Owner, having raised it more than once: *"the hover is not prominently
 * permanently visible. If I select any platform it couldn't be easily prominent…
 * I want the card in which the platforms are displayed, the small boxes' border,
 * to be in black or the theme's dark green colour so it could be easily visible
 * that it is selected… I told you about this issue in a lot of other places but
 * you didn't resolve it."*
 *
 * What was wrong was not the colour — it was the WIDTH. This drew a 1px
 * `border-border-brand` when selected. At one pixel, against a white card, teal
 * reads as a slightly darker grey outline; next to an unselected tile with a 1px
 * grey border, the difference is a shade, and a shade is not a state.
 *
 * The fix is the one already signed off for the Access tab's credential rows, and
 * it is used here verbatim rather than reinvented:
 *
 *   · `border-2`, CONSTANT — never 1px→2px on selection, or every tile shifts a
 *     pixel as you click along the row and the whole panel twitches.
 *   · `--border-brand` — #0e5c63, teal-700, the core brand teal and the colour of
 *     the sidebar. Named by the owner directly: *"border-color: #0e5c63 … that
 *     platform's border colour should be this."*
 *
 *     ⚠️ NOT `--border-brand-strong` (teal-800, #0a4046), which is what the Access
 *     tab uses and what this had first. That token exists because teal-700 at ONE
 *     pixel reads as grey — at two pixels with a tinted ground under it, it does
 *     not, and it is the colour the rest of the product means by "our green". The
 *     width was doing the work all along, not the extra shade.
 *
 *     The token, never the hex, so dark mode still resolves to teal-400 rather
 *     than painting a near-black line on a dark card.
 *   · ⚠️ A SOLID `bg-accent-primary` FILL, not a tint. This is the third attempt
 *     at this control and the first two failed the same way, so the reason is
 *     worth stating: `bg-bg-selected` is teal-50, #e9f6f6, which is a hair off
 *     white. A 2px teal outline around a near-white chip, sitting in a row of four
 *     other near-white chips, is *technically* different and is not *visibly*
 *     different — owner, twice: *"it's not easily prominent."*
 *
 *     They were right both times, and neither the colour nor the border width was
 *     the fix. A selected filter chip has to read as FILLED. One dark tile among
 *     four light ones is legible at a glance across a room; an outlined tile among
 *     outlined tiles has to be looked for. The brand marks keep their own colours
 *     on top, which is what stops the filled state looking like a disabled one.
 *   · ⚠️ HOVER DOES **NOT** GET THE BRAND COLOUR. This is the opposite of the
 *     Access tab, deliberately, and the owner corrected it here after seeing the
 *     first version: *"I want that only when a platform is selected… only when any
 *     platform is selected as a filter, that platform's border colour should be
 *     this."*
 *
 *     The Access tab is a single-selection master list where hovering previews
 *     "this is what you would open", and exactly one row can ever be selected. A
 *     filter row is multi-select and the pointer is usually resting on one of the
 *     tiles — so "green border" meaning both "selected" and "under the cursor"
 *     leaves no way to read off which platforms are actually filtering. Two states
 *     that look identical are one state.
 *
 *     Hover therefore moves the border to a neutral `border-border-strong` and
 *     tints the ground. Feedback, without the one colour that has been given a
 *     meaning.
 *
 * ⚠️ Nothing selected still means EVERY platform, which is why an unselected tile
 * is not dimmed. Until somebody picks one, none of them is excluded.
 */
function PlatformToggles({
  all,
  selected,
  onChange,
}: {
  all: FilterOptions['platforms'];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const chosen = new Set(selected);

  return (
    <div className="flex items-center gap-1.5">
      {all.map((platform) => {
        const on = chosen.has(platform.slug);
        return (
          <button
            key={platform.slug}
            type="button"
            aria-pressed={on}
            aria-label={
              on ? `${platform.label} — included, click to remove` : `Filter to ${platform.label}`
            }
            title={platform.label}
            onClick={() =>
              onChange(
                on ? selected.filter((s) => s !== platform.slug) : [...selected, platform.slug],
              )
            }
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-lg border-2 px-2.5',
              'transition-[border-color,background-color] duration-[140ms]',
              on
                ? 'border-border-brand bg-accent-primary'
                : 'border-border-default hover:border-border-strong hover:bg-bg-hover',
            )}
          >
            <PlatformIcon slug={platform.slug} size={18} />
            {/* The mockup labels only the one with no recognisable mark. A tile
                showing the Facebook glyph does not need the word beside it, and
                five labelled tiles would not fit the row. */}
            {!hasMark(platform.slug) && (
              <span className={cn('text-caption', on ? 'text-text-on-brand' : 'text-text-secondary')}>
                {platform.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* `PlatformIcon` falls back to a lettered tile for an unknown slug, which is the
   right thing in a table but leaves a filter button meaningless — hence the label
   beside it. Kept as a list rather than reaching into the mark table so this file
   does not depend on how marks are stored. */
const MARKED = new Set([
  'facebook',
  'instagram',
  'linkedin',
  'tiktok',
  'youtube',
  'x',
  'twitter',
  'threads',
  'pinterest',
  'snapchat',
  'whatsapp',
]);
const hasMark = (slug: string) => MARKED.has(slug);

/* ---- Export -------------------------------------------------------------- */

const EXPORT_OPTIONS: ReadonlyArray<{
  readonly format: ExportFormat;
  readonly icon: typeof Printer;
  readonly label: string;
  readonly hint: string;
}> = [
  {
    format: 'pdf',
    icon: FileDown,
    label: 'PDF report',
    hint: 'Branded, laid out, ready to circulate',
  },
  { format: 'xlsx', icon: FileSpreadsheet, label: 'Excel spreadsheet', hint: '.xlsx — real numbers you can sum' },
  { format: 'csv', icon: FileText, label: 'CSV', hint: 'Plain text, opens anywhere' },
  { format: 'print', icon: Printer, label: 'Print this page', hint: 'Opens your browser’s print dialogue' },
];

function ExportMenu({
  downloading,
  onChoose,
}: {
  downloading: ExportFormat | null;
  onChoose: (format: ExportFormat) => void;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);

  /* ── ⚠️ `<details>` DOES NOT CLOSE ON AN OUTSIDE CLICK ───────────────────
     Owner: *"When I click on Export for the first time, it shows me a modal. When
     I click somewhere else, it should close that popup or dropdown."*

     They are right and it is a genuine gap in the element: `<details>` gives
     keyboard toggling and the disclosure semantics for free, but the browser only
     ever closes it by clicking the summary again. Every other dropdown in this
     codebase is a `<details>` too, so the gap is shared — this is the one the
     owner hit, because it is the one with a menu big enough to get in the way.

     Escape is handled here for the same reason: that is `<dialog>` behaviour, not
     `<details>` behaviour, and people reach for it anyway.

     ⚠️ `mousedown`, not `click`. On `click` the menu would still be open while the
     browser dispatches the press, so choosing an item would race the close. */
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const close = (event: Event) => {
      if (!node.open) return;
      if (event.type === 'mousedown' && node.contains(event.target as Node)) return;
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      node.removeAttribute('open');
    };

    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label="Export this report"
        className={cn(
          'flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-4',
          'bg-accent-primary text-caption font-semibold text-text-on-brand',
          'marker:content-none hover:bg-accent-primary-hover [&::-webkit-details-marker]:hidden',
        )}
      >
        {downloading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="size-4" strokeWidth={2.25} aria-hidden="true" />
        )}
        {downloading ? 'Building…' : 'Export'}
        <ChevronDown className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
      </summary>

      {/* One click handler on the panel — every item here is a one-shot action, so
          there is none that should leave the menu open. Same pattern as the files
          tab; the filter popovers are the deliberate exception. */}
      <div
        onClick={() => ref.current?.removeAttribute('open')}
        className="absolute right-0 z-30 mt-1 w-[17rem] overflow-hidden rounded-xl border border-border-default bg-bg-surface py-1 shadow-[var(--shadow-xl)]"
      >
        {EXPORT_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.format}
              type="button"
              onClick={() => onChoose(option.format)}
              className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-bg-hover"
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-text-tertiary" strokeWidth={2} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-caption font-medium text-text-primary">
                  {option.label}
                </span>
                <span className="block text-micro text-text-tertiary">{option.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </details>
  );
}

