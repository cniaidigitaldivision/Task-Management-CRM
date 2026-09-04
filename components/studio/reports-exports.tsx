'use client';

import * as React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Gauge,
  History,
  Image as ImageIcon,
  Layers,
  Loader2,
  MoreVertical,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Signature,
  Sparkles,
  SquarePen,
  Star,
  Table as TableIcon,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
  Users,
  X,
} from 'lucide-react';

import {
  createCustomTemplateAction,
  createScheduleAction,
  deleteCustomTemplateAction,
  deleteScheduleAction,
  runReportTemplateAction,
  setScheduleActiveAction,
  toggleTemplateFavouriteAction,
} from '@/app/actions/report-templates';
import { FILE_TYPE_MARKS, FileTypeIcon } from '@/components/brand/file-type-icon';
import { FILE_TYPE_ORDER } from '@/lib/brand/file-type-marks';
import {
  CADENCES,
  CADENCE_LABEL,
  CATEGORY_LABEL,
  EMPTY_FILTER,
  PERIOD_TAG,
  TEMPLATE_CATEGORIES,
  fileSize,
  filterActive,
  filterTemplates,
  isInsightSection,
  previewBlocks,
  scheduleState,
  sectionLabel,
  sortTemplates,
  templateKpis,
  templateMeta,
  type Cadence,
  type ExportRecord,
  type PreviewBlock,
  type ReportSchedule,
  type ReportTemplate,
  type TemplateFilter,
} from '@/lib/domain/report-templates';
import { REPORT_KINDS, REPORT_KIND_LABEL } from '@/lib/domain/report-periods';
import { cn } from '@/lib/utils';

import { Panel, PanelEmpty } from './panels';
import { useInView } from './use-in-view';

/* ============================================================================
 * REPORTS & EXPORTS — the owner's reference, 2026-09-04
 * ----------------------------------------------------------------------------
 * *"I want the UI to be exactly the same, beautiful, sleek, and interactive…
 * exact icons, exact colors, exact spacing, exact sleekness… I'm not talking
 * about the template or the generated file being exactly the same. Right now I'm
 * focusing on the UI."*
 *
 * So the layout is the reference's, down to the drawer, and every template's
 * button produces a real file — while the DIFFERING per-template layouts are
 * later work, with `sections` (migration 098) as their brief.
 *
 * ── ⚠️ THE TWO COLUMNS ARE ONE GRID ROW, NOT TWO STACKS ────────────────────
 * *"Make sure that the left-hand side and right-hand side are equal so that it
 * looks better."* The grid row makes both columns the height of the taller, and
 * the drawer is `sticky` inside its own column so it stays beside the grid while
 * the page scrolls. Matching them by hand would break at every card count.
 *
 * ── ⚠️ WHERE A FIGURE DISAGREES WITH THE MOCKUP, THE FIGURE IS COUNTED ─────
 * "AI Summary Blocks 42" reads the real total of insight-written sections the
 * library declares; the reference's own footnote says "Across all templates",
 * so that is what it counts. See `templateKpis` — the reasoning and its test are
 * both in the domain layer.
 * ========================================================================= */

/** The one map from a domain icon key to a mark — keys live in migration 098. */
const ICONS: Readonly<Record<string, typeof FileText>> = {
  document: FileText,
  'calendar-day': CalendarDays,
  history: History,
  chart: BarChart3,
  client: Users,
  signature: Signature,
  table: TableIcon,
  people: Users,
  pulse: Gauge,
  image: ImageIcon,
  shield: ShieldCheck,
  presentation: Layers,
  play: Play,
  trophy: Trophy,
  growth: TrendingUp,
  compare: BarChart3,
  target: Target,
  edit: SquarePen,
  file: FileText,
  sparkles: Sparkles,
  clock: Clock,
};

function Mark({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? FileText;
  return <Icon className={className} aria-hidden="true" />;
}

export interface GeneratedReport {
  readonly id: string;
  readonly kind: string;
  readonly periodLabel: string;
  readonly summary: string;
  readonly createdByName: string | null;
  readonly createdAt: string;
}

type SubTab = 'reports' | 'scheduled' | 'history' | 'library';

const SUB_TABS: readonly { key: SubTab; label: string }[] = [
  { key: 'reports', label: 'Reports' },
  { key: 'scheduled', label: 'Scheduled Reports' },
  { key: 'history', label: 'Export History' },
  { key: 'library', label: 'Report Templates Library' },
];

const PAGE_SIZES = [8, 12, 24] as const;

export function ReportsExports({
  projectId,
  projectName,
  templates,
  schedules,
  exports: exportRows,
  reports,
  todayKarachi,
  nowMs,
  canSchedule,
}: {
  projectId: string;
  projectName: string;
  templates: readonly ReportTemplate[];
  schedules: readonly ReportSchedule[];
  exports: readonly ExportRecord[];
  reports: readonly GeneratedReport[];
  /** Today in Karachi — the server's answer, so "Overdue" cannot disagree. */
  todayKarachi: string;
  nowMs: number;
  canSchedule: boolean;
}) {
  const [tab, setTab] = React.useState<SubTab>('library');
  const [filter, setFilter] = React.useState<TemplateFilter>(EMPTY_FILTER);
  const [page, setPage] = React.useState(0);
  const [perPage, setPerPage] = React.useState<number>(8);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const kpis = React.useMemo(() => templateKpis({ templates, nowMs }), [templates, nowMs]);

  const matched = React.useMemo(
    () => sortTemplates(filterTemplates(templates, filter)),
    [templates, filter],
  );

  /* ⚠️ THE PAGE IS CLAMPED RATHER THAN RESET IN AN EFFECT. Narrowing a filter
     while on page 3 must not show an empty grid, and `set-state-in-effect` is
     lint-refused here for good reason — deriving costs nothing and cannot
     produce the one-render flash an effect would. */
  const pageCount = Math.max(1, Math.ceil(matched.length / perPage));
  const current = Math.min(page, pageCount - 1);
  const shown = matched.slice(current * perPage, current * perPage + perPage);

  /* ⚠️ RESOLVED FROM `templates` EVERY RENDER, not held as an object in state.
     A stored copy would keep showing "Used 12 times" after a run bumped it to
     13 — the drawer and the card behind it would disagree about the same row. */
  const open = openId ? (templates.find((t) => t.id === openId) ?? null) : null;

  const say = (tone: 'ok' | 'bad', text: string) => {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 7000);
  };

  const run = React.useCallback(
    async (template: ReportTemplate) => {
      setBusyId(template.id);
      try {
        const r = await runReportTemplateAction(template.id, projectId);
        if (!r.ok) {
          say('bad', r.error ?? 'That export could not be produced.');
          return;
        }

        if (r.csv && r.fileName) {
          /* ⚠️ A BLOB AND AN ANCHOR, NOT A DATA URI. A CSV of five thousand
             tasks exceeds what several browsers accept in a `data:` URL and
             fails silently — no error, no file. Revoked afterwards, or every
             export leaks its bytes for the life of the tab. */
          const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = r.fileName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          say('ok', `${r.fileName} — ${r.rowCount ?? 0} rows.`);
          return;
        }

        if (r.reportUrl) {
          window.open(r.reportUrl, '_blank', 'noopener,noreferrer');
          say('ok', `${template.name} generated. It is in the Reports tab.`);
        }
      } finally {
        setBusyId(null);
      }
    },
    [projectId],
  );

  return (
    <div className="space-y-3">
      {/* ── Sub-tabs ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border-subtle">
        {SUB_TABS.map((t) => {
          const count =
            t.key === 'reports'
              ? reports.length
              : t.key === 'scheduled'
                ? schedules.length
                : t.key === 'history'
                  ? exportRows.length
                  : templates.length;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'relative inline-flex items-center gap-1.5 px-3 py-2.5 text-caption transition-colors',
                tab === t.key
                  ? 'font-semibold text-text-primary'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {t.label}
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[0.58rem] font-bold tabular-nums',
                  tab === t.key ? 'bg-bg-subtle text-text-secondary' : 'text-text-tertiary',
                )}
              >
                {count}
              </span>
              {tab === t.key && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-primary" />
              )}
            </button>
          );
        })}
      </div>

      {toast && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border px-3 py-2"
          style={{
            borderColor: `color-mix(in oklab, var(--${toast.tone === 'ok' ? 'feedback-success' : 'feedback-error'}) 30%, transparent)`,
            backgroundColor: `color-mix(in oklab, var(--${toast.tone === 'ok' ? 'feedback-success' : 'feedback-error'}) 8%, transparent)`,
          }}
        >
          {toast.tone === 'ok' ? (
            <CheckCircle2
              className="mt-px size-3.5 shrink-0"
              style={{ color: 'var(--feedback-success)' }}
            />
          ) : (
            <AlertTriangle
              className="mt-px size-3.5 shrink-0"
              style={{ color: 'var(--feedback-error)' }}
            />
          )}
          <span className="min-w-0 flex-1 text-micro text-text-primary">{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-text-tertiary hover:text-text-primary"
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {tab === 'library' ? (
        /* ⚠️ ONE GRID ROW, AND NO `items-start`. Owner: *"Make sure that the
           left-hand side and right-hand side are equal."* A grid row stretches
           both columns to the height of the taller one by default —
           `items-start` would have collapsed the drawer to its content and left
           the mismatch the owner is looking at. The drawer then pins its actions
           to the bottom with `mt-auto`, so the slack lands between the content
           and the buttons rather than as a gap below them. */
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="min-w-0">
            <h2 className="text-h3 font-semibold text-text-primary">Report Templates Library</h2>
            <p className="mt-1 text-caption text-text-secondary">
              Pre-built report templates for Meta performance analysis.
            </p>

            {/* ── The six figures ───────────────────────────────────────── */}
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {kpis.map((k, i) => (
                <LibraryKpi key={k.key} kpi={k} index={i} />
              ))}
            </div>

            <FilterBar
              filter={filter}
              onChange={(f) => {
                setFilter(f);
                setPage(0);
              }}
            />

            {shown.length === 0 ? (
              <div className="mt-3">
                <PanelEmpty>
                  Nothing matches those filters. {templates.length} templates exist.
                </PanelEmpty>
              </div>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {shown.map((t, i) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    index={i}
                    active={openId === t.id}
                    busy={busyId === t.id}
                    onOpen={() => setOpenId(t.id)}
                    onRun={() => void run(t)}
                    onStar={async () => {
                      await toggleTemplateFavouriteAction(t.id);
                    }}
                    onDelete={async () => {
                      const r = await deleteCustomTemplateAction(t.id);
                      say(r.ok ? 'ok' : 'bad', r.ok ? `${t.name} removed.` : (r.error ?? ''));
                      if (r.ok && openId === t.id) setOpenId(null);
                    }}
                  />
                ))}

                {/* The reference's dashed tile, on the last page only. */}
                {current === pageCount - 1 && (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="group flex min-h-[13.5rem] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-default bg-bg-surface p-4 text-center transition-colors hover:border-accent-primary hover:bg-bg-subtle"
                  >
                    <span className="grid size-11 place-items-center rounded-full bg-bg-subtle transition-transform group-hover:scale-110">
                      <Plus className="size-5 text-text-secondary" aria-hidden="true" />
                    </span>
                    <span className="text-body-sm font-semibold text-text-primary">
                      Create Custom Template
                    </span>
                    <span className="max-w-[14rem] text-[0.65rem] leading-snug text-text-tertiary">
                      Build your own preset over one of the report generators.
                    </span>
                    <span
                      className="mt-1 rounded-lg border px-3 py-1.5 text-micro font-semibold"
                      style={{
                        borderColor: 'color-mix(in oklab, var(--accent-primary) 40%, transparent)',
                        color: 'var(--accent-primary)',
                      }}
                    >
                      Create New
                    </span>
                  </button>
                )}
              </div>
            )}

            {/* ── Pagination ────────────────────────────────────────────── */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-caption text-text-tertiary">
                {matched.length === 0
                  ? 'No templates'
                  : `Showing ${current * perPage + 1} to ${Math.min(matched.length, current * perPage + perPage)} of ${matched.length} templates`}
              </p>

              <div className="flex items-center gap-2">
                {pageCount > 1 && (
                  <div className="flex items-center gap-1">
                    <PageButton
                      disabled={current === 0}
                      onClick={() => setPage(current - 1)}
                      label="Previous page"
                    >
                      <ChevronLeft className="size-3.5" />
                    </PageButton>
                    {Array.from({ length: pageCount }, (_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setPage(i)}
                        aria-current={i === current ? 'page' : undefined}
                        className={cn(
                          'size-7 rounded-lg text-micro font-medium tabular-nums transition-colors',
                          i === current
                            ? 'font-semibold text-accent-foreground'
                            : 'border border-border-subtle text-text-secondary hover:bg-bg-subtle',
                        )}
                        style={
                          i === current ? { backgroundColor: 'var(--accent-primary)' } : undefined
                        }
                      >
                        {i + 1}
                      </button>
                    ))}
                    <PageButton
                      disabled={current >= pageCount - 1}
                      onClick={() => setPage(current + 1)}
                      label="Next page"
                    >
                      <ChevronRight className="size-3.5" />
                    </PageButton>
                  </div>
                )}

                <select
                  aria-label="Templates per page"
                  value={perPage}
                  onChange={(e) => {
                    setPerPage(Number(e.target.value));
                    setPage(0);
                  }}
                  className="rounded-lg border border-border-subtle bg-bg-surface px-2 py-1.5 text-micro text-text-secondary transition-colors hover:border-border-default"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n} per page
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── The drawer ─────────────────────────────────────────────── */}
          <aside className="min-w-0">
            {open ? (
              <TemplateDrawer
                template={open}
                projectName={projectName}
                busy={busyId === open.id}
                canSchedule={canSchedule}
                /* ⚠️ THE LAST REPORT THIS TEMPLATE ACTUALLY PRODUCED, from the
                   export history — which is why that history carries both
                   `template_id` and `report_id`. `exportRows` is newest first,
                   so the first match is the most recent. */
                lastReportId={
                  exportRows.find(
                    (e) => e.templateId === open.id && e.status === 'ready' && e.reportId,
                  )?.reportId ?? null
                }
                onRun={() => void run(open)}
                onClose={() => setOpenId(null)}
                onSchedule={async (cadence) => {
                  const r = await createScheduleAction({
                    projectId,
                    templateId: open.id,
                    cadence,
                  });
                  say(
                    r.ok ? 'ok' : 'bad',
                    r.ok
                      ? `${open.name} will file ${CADENCE_LABEL[cadence].toLowerCase()}.`
                      : (r.error ?? 'That schedule could not be created.'),
                  );
                  if (r.ok) setTab('scheduled');
                }}
              />
            ) : (
              <Panel title="Pick a template" className="h-full">
                <p className="text-caption leading-relaxed text-text-secondary">
                  Choose one on the left to see the sections its report contains, a preview of
                  its blocks, and the formats it offers — then run it against{' '}
                  <strong className="font-semibold text-text-primary">{projectName}</strong>.
                </p>
                <div className="mt-3 grid grid-cols-5 gap-1.5 border-t border-border-subtle pt-3">
                  {FILE_TYPE_ORDER.map((key) => (
                    <span
                      key={key}
                      title={FILE_TYPE_MARKS[key].note}
                      className="flex cursor-help flex-col items-center gap-1 rounded-lg border border-border-subtle px-1 py-2"
                    >
                      <FileTypeIcon type={key} size={20} />
                      <span className="text-center text-[0.55rem] font-semibold leading-tight text-text-secondary">
                        {FILE_TYPE_MARKS[key].label}
                      </span>
                    </span>
                  ))}
                </div>
              </Panel>
            )}
          </aside>
        </div>
      ) : tab === 'reports' ? (
        <ReportsList reports={reports} nowMs={nowMs} projectName={projectName} />
      ) : tab === 'scheduled' ? (
        <SchedulesList
          schedules={schedules}
          todayKarachi={todayKarachi}
          canSchedule={canSchedule}
          onToggle={async (id, active) => {
            const r = await setScheduleActiveAction(id, active);
            if (!r.ok) say('bad', r.error ?? '');
          }}
          onDelete={async (id) => {
            const r = await deleteScheduleAction(id);
            if (!r.ok) say('bad', r.error ?? '');
          }}
          onBrowse={() => setTab('library')}
        />
      ) : (
        <HistoryList rows={exportRows} nowMs={nowMs} />
      )}

      {creating && (
        <CreateTemplate
          onClose={() => setCreating(false)}
          onDone={(message, ok) => {
            say(ok ? 'ok' : 'bad', message);
            if (ok) setCreating(false);
          }}
        />
      )}
    </div>
  );
}

/* ---- The KPI card ------------------------------------------------------- */

/**
 * ⚠️ NOT `KpiCard` FROM panels.tsx, AND THE DIFFERENCE IS THE POINT. That one is
 * built for a measured quantity — a big tabular figure, a sparkline, a count-up.
 * The reference's cards here are a small icon chip beside a compact figure, and
 * one of them holds a TEMPLATE NAME rather than a number. Reusing the Studio's
 * card would either stretch these to twice the height or force `textValue` on
 * half of them. Same tokens, different instrument.
 */
function LibraryKpi({
  kpi,
  index,
}: {
  kpi: { key: string; label: string; value: string; icon: string; token: string; footnote: string };
  index: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const isName = kpi.key === 'most-used';

  return (
    <div
      ref={ref}
      className={cn(
        'studio-reveal rounded-xl border border-border-subtle bg-bg-surface p-3 transition-all duration-300 hover:-translate-y-px hover:shadow-[0_6px_18px_rgb(6_35_42_/_0.08)]',
        'motion-safe:animate-[studio-rise_560ms_cubic-bezier(0.16,1,0.3,1)_backwards]',
        inView && 'is-visible',
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center gap-2">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-[10px]"
          style={{ backgroundColor: `var(--${kpi.token}-wash)` }}
        >
          <Mark name={kpi.icon} className="size-4" />
        </span>
        <p className="min-w-0 flex-1 text-[0.62rem] font-medium leading-tight text-text-secondary">
          {kpi.label}
        </p>
      </div>

      <p
        className={cn(
          'mt-1.5 font-bold text-text-primary',
          isName ? 'line-clamp-2 text-body-sm leading-tight' : 'text-h2 leading-none tabular-nums',
        )}
        title={isName ? kpi.value : undefined}
      >
        {kpi.value}
      </p>

      <p className="mt-1 truncate text-[0.6rem] text-text-tertiary">{kpi.footnote}</p>
    </div>
  );
}

function PageButton({
  disabled,
  onClick,
  label,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className="grid size-7 place-items-center rounded-lg border border-border-subtle text-text-secondary transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/* ---- Filter bar ---------------------------------------------------------- */

function FilterBar({
  filter,
  onChange,
}: {
  filter: TemplateFilter;
  onChange: (f: TemplateFilter) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label className="relative min-w-[11rem] flex-1 sm:max-w-[16rem]">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary"
          aria-hidden="true"
        />
        <input
          type="search"
          value={filter.query}
          onChange={(e) => onChange({ ...filter, query: e.target.value })}
          placeholder="Search templates…"
          aria-label="Search templates"
          className="w-full rounded-lg border border-border-subtle bg-bg-surface py-2 pl-8 pr-2.5 text-micro text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
        />
      </label>

      {/* The reference's stacked label-over-value selects. */}
      <StackedSelect
        label="Category"
        value={filter.category}
        onChange={(v) => onChange({ ...filter, category: v as TemplateFilter['category'] })}
        options={[
          { value: 'all', label: 'All Categories' },
          ...TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })),
        ]}
      />

      <StackedSelect
        label="Format"
        value={filter.format}
        onChange={(v) => onChange({ ...filter, format: v as TemplateFilter['format'] })}
        options={[
          { value: 'all', label: 'All Formats' },
          { value: 'pdf', label: 'PDF' },
          { value: 'csv', label: 'CSV' },
        ]}
      />

      {/* ⚠️ THE REFERENCE'S THIRD SELECT IS "All Teams" AND THERE IS NOTHING TO
          FILTER BY — a template belongs to the division, not a team, and no
          column says otherwise. The real distinction in this list is who made
          it, which is what somebody scanning for "the one I built" wants. */}
      <StackedSelect
        label="Origin"
        value={filter.origin}
        onChange={(v) => onChange({ ...filter, origin: v as TemplateFilter['origin'] })}
        options={[
          { value: 'all', label: 'Everyone’s' },
          { value: 'builtin', label: 'Built-in' },
          { value: 'custom', label: 'Custom' },
        ]}
      />

      <button
        type="button"
        onClick={() => onChange({ ...filter, favouritesOnly: !filter.favouritesOnly })}
        aria-pressed={filter.favouritesOnly}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-micro font-medium transition-colors',
          filter.favouritesOnly
            ? 'border-transparent text-accent-foreground'
            : 'border-border-subtle text-text-secondary hover:bg-bg-subtle',
        )}
        style={filter.favouritesOnly ? { backgroundColor: 'var(--accent-primary)' } : undefined}
      >
        <Star
          className={cn('size-3.5', filter.favouritesOnly && 'fill-current')}
          aria-hidden="true"
        />
        Favorites
      </button>

      {/* ⚠️ ALWAYS PRESENT, DISABLED WHEN THERE IS NOTHING TO CLEAR. The
          reference shows it permanently; a control that appears and disappears
          shifts the whole row sideways as somebody types into the search box
          beside it. */}
      <button
        type="button"
        disabled={!filterActive(filter)}
        onClick={() => onChange(EMPTY_FILTER)}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-micro font-semibold text-text-brand transition-opacity hover:underline disabled:cursor-not-allowed disabled:text-text-tertiary disabled:no-underline"
      >
        <RotateCcw className="size-3.5" aria-hidden="true" />
        Clear Filters
      </button>
    </div>
  );
}

function StackedSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <label className="relative rounded-lg border border-border-subtle bg-bg-surface px-2.5 pb-1 pt-3.5 transition-colors focus-within:border-accent-primary hover:border-border-default">
      <span className="pointer-events-none absolute left-2.5 top-1 text-[0.55rem] font-medium uppercase tracking-wide text-text-tertiary">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="w-full cursor-pointer appearance-none bg-transparent pr-4 text-micro font-medium text-text-primary focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronRight
        className="pointer-events-none absolute right-2 top-1/2 size-3 rotate-90 text-text-tertiary"
        aria-hidden="true"
      />
    </label>
  );
}

/* ---- One template card --------------------------------------------------- */

function TemplateCard({
  template,
  index,
  active,
  busy,
  onOpen,
  onRun,
  onStar,
  onDelete,
}: {
  template: ReportTemplate;
  index: number;
  active: boolean;
  busy: boolean;
  onOpen: () => void;
  onRun: () => void;
  onStar: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  /* Optimistic, so the star fills the instant it is pressed rather than after a
     round trip and a revalidate. The server is the truth on the next load. */
  const [starred, setStarred] = React.useState(template.isFavourite);
  const [menu, setMenu] = React.useState(false);

  return (
    <div
      ref={ref}
      onClick={onOpen}
      className={cn(
        'studio-reveal group relative flex min-h-[13.5rem] cursor-pointer flex-col rounded-xl border bg-bg-surface p-3.5 transition-all duration-300 hover:-translate-y-px hover:shadow-[0_8px_22px_rgb(6_35_42_/_0.1)]',
        'motion-safe:animate-[studio-rise_560ms_cubic-bezier(0.16,1,0.3,1)_backwards]',
        active
          ? 'shadow-[0_4px_16px_rgb(6_35_42_/_0.1)]'
          : 'border-border-subtle',
        inView && 'is-visible',
      )}
      style={{
        animationDelay: `${index * 55}ms`,
        ...(active
          ? { borderColor: 'var(--accent-primary)', backgroundColor: 'var(--bg-surface)' }
          : {}),
      }}
    >
      {/* The reference's selected tick, top-right, over the star's place. */}
      {active && (
        <span
          className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full shadow-[0_2px_6px_rgb(6_35_42_/_0.2)]"
          style={{ backgroundColor: 'var(--accent-primary)' }}
        >
          <Check className="size-3.5 text-accent-foreground" aria-hidden="true" />
        </span>
      )}

      <div className="flex items-start justify-between gap-2">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-xl transition-transform duration-300 group-hover:scale-105"
          style={{ backgroundColor: `var(--${template.accent}-wash)` }}
        >
          <Mark
            name={template.icon}
            className="size-[21px]"
          />
        </span>

        {!active && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setStarred((s) => !s);
              void onStar();
            }}
            aria-pressed={starred}
            aria-label={starred ? 'Remove from favourites' : 'Add to favourites'}
            className="rounded-md p-1 transition-colors hover:bg-bg-subtle"
          >
            <Star
              className={cn('size-4', starred ? 'fill-current' : 'text-text-tertiary')}
              style={starred ? { color: 'var(--chart-6)' } : undefined}
            />
          </button>
        )}
      </div>

      <h3 className="mt-2.5 text-body-sm font-semibold leading-tight text-text-primary">
        {template.name}
      </h3>
      <p className="mt-1 line-clamp-2 flex-1 text-[0.68rem] leading-relaxed text-text-secondary">
        {template.description}
      </p>

      {/* ── Two tags, as the reference draws ────────────────────────────── */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Tag token={template.accent}>{CATEGORY_LABEL[template.category]}</Tag>
        <Tag token={template.accent}>
          {template.kind ? PERIOD_TAG[template.kind] : template.format.toUpperCase()}
        </Tag>
      </div>

      <div className="mt-2.5 flex items-center gap-2 border-t border-border-subtle pt-2.5">
        <span className="flex-1 truncate text-[0.62rem] text-text-tertiary">
          {/* ⚠️ "Never used" rather than "Used 0 times". Nought times is not a
              count worth printing, it is a different fact. */}
          {template.usageCount === 0
            ? 'Never used'
            : `Used ${template.usageCount} ${template.usageCount === 1 ? 'time' : 'times'}`}
        </span>

        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenu((m) => !m);
            }}
            aria-label="More actions"
            aria-expanded={menu}
            className="grid size-6 place-items-center rounded-md text-text-tertiary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <MoreVertical className="size-3.5" />
          </button>

          {menu && (
            <>
              {/* Click-away, behind the menu and above everything else. */}
              <span
                className="fixed inset-0 z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(false);
                }}
              />
              <div className="absolute bottom-full right-0 z-20 mb-1 w-40 overflow-hidden rounded-lg border border-border-subtle bg-bg-surface py-1 shadow-[0_8px_24px_rgb(6_35_42_/_0.16)]">
                <MenuItem
                  icon={Download}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu(false);
                    onRun();
                  }}
                  disabled={busy}
                >
                  {busy ? 'Working…' : 'Run now'}
                </MenuItem>
                <MenuItem
                  icon={Eye}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu(false);
                    onOpen();
                  }}
                >
                  View details
                </MenuItem>
                {/* ⚠️ Only a CUSTOM template can be removed — 096's policy
                    refuses a built-in outright, so offering it would be offering
                    a button the database will decline. */}
                {!template.isBuiltin && (
                  <MenuItem
                    icon={Trash2}
                    tone="var(--feedback-error)"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenu(false);
                      void onDelete();
                    }}
                  >
                    Delete
                  </MenuItem>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Tag({ token, children }: { token: string; children: React.ReactNode }) {
  return (
    <span
      className="rounded-md px-1.5 py-0.5 text-[0.58rem] font-semibold"
      style={{
        backgroundColor: `color-mix(in oklab, var(--${token}) 12%, transparent)`,
        color: `var(--${token})`,
      }}
    >
      {children}
    </span>
  );
}

function MenuItem({
  icon: Icon,
  onClick,
  disabled,
  tone,
  children,
}: {
  icon: typeof Download;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-micro text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-50"
      style={tone ? { color: tone } : undefined}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </button>
  );
}

/* ---- The drawer ---------------------------------------------------------- */

function TemplateDrawer({
  template,
  projectName,
  busy,
  canSchedule,
  lastReportId,
  onRun,
  onClose,
  onSchedule,
}: {
  template: ReportTemplate;
  projectName: string;
  busy: boolean;
  canSchedule: boolean;
  /** The most recent report this template produced, or null. */
  lastReportId: string | null;
  onRun: () => void;
  onClose: () => void;
  onSchedule: (cadence: Cadence) => Promise<void>;
}) {
  const [scheduling, setScheduling] = React.useState(false);
  const [cadence, setCadence] = React.useState<Cadence>('monthly');
  const blocks = React.useMemo(() => previewBlocks(template), [template]);

  return (
    <div className="flex h-full flex-col rounded-xl border border-border-subtle bg-bg-surface p-4">
      {/* ── Head ────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-xl"
          style={{ backgroundColor: `var(--${template.accent}-wash)` }}
        >
          <Mark name={template.icon} className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-h3 font-semibold leading-tight text-text-primary">
            {template.name}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Tag token={template.accent}>{CATEGORY_LABEL[template.category]}</Tag>
            <Tag token={template.accent}>{templateMeta(template)}</Tag>
            <span className="text-[0.62rem] text-text-tertiary">
              {template.usageCount === 0
                ? 'Never used'
                : `Used ${template.usageCount} ${template.usageCount === 1 ? 'time' : 'times'}`}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-subtle hover:text-text-primary"
        >
          <X className="size-4" />
        </button>
      </div>

      <p className="mt-3 text-caption leading-relaxed text-text-secondary">
        {template.description}
      </p>

      {/* ── Sections Included ──────────────────────────────────────────── */}
      <h3 className="mt-4 text-body-sm font-semibold text-text-primary">Sections Included</h3>
      <ul className="mt-2 space-y-1.5">
        {template.sections.map((key) => (
          <li key={key} className="flex items-center gap-2">
            {/* ⚠️ A TICK, NOT A CHECKBOX. The reference draws these as if they
                were choices; they are not yet — the composer's geometry is fixed
                and per-template layouts are later work. A tick states what the
                report contains, which is the fact somebody needs when choosing
                between two templates anyway. */}
            <CheckCircle2
              className="size-4 shrink-0"
              style={{ color: 'var(--feedback-success)' }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-caption text-text-primary">
              {sectionLabel(key)}
              {isInsightSection(key) && (
                <span className="ml-1 text-[0.58rem] font-semibold text-text-tertiary">
                  (AI Summary)
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {/* ── Sample Preview ─────────────────────────────────────────────── */}
      <h3 className="mt-4 text-body-sm font-semibold text-text-primary">Sample Preview</h3>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {blocks.map((b) => (
          <PreviewTile key={b} block={b} token={template.accent} />
        ))}
      </div>

      {/* ── Export Formats ─────────────────────────────────────────────── */}
      <h3 className="mt-4 text-body-sm font-semibold text-text-primary">Export Formats</h3>
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {FILE_TYPE_ORDER.map((key) => {
          const mark = FILE_TYPE_MARKS[key];
          const offered = template.formats.includes(key);
          /* ⚠️ THREE STATES, NOT TWO. A format can be offered by this template
             and writable (solid), offered but with no writer yet (dashed, with
             the reason), or not part of this template at all (dimmed). Collapsing
             the last two would claim the template offers something it does not. */
          return (
            <span
              key={key}
              title={
                !offered
                  ? `${mark.label} is not one of this template's formats.`
                  : mark.writable
                    ? mark.note
                    : `Not available yet — ${mark.note}`
              }
              className={cn(
                'flex cursor-help flex-col items-center gap-1 rounded-lg border px-1 py-2 transition-colors',
                !offered
                  ? 'border-border-subtle opacity-35'
                  : mark.writable
                    ? 'border-border-default bg-bg-surface hover:bg-bg-subtle'
                    : 'border-dashed border-border-default opacity-70',
              )}
            >
              <FileTypeIcon type={key} size={22} />
              <span className="text-center text-[0.55rem] font-semibold leading-tight text-text-secondary">
                {mark.label}
              </span>
            </span>
          );
        })}
      </div>

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={onRun}
        disabled={busy}
        /* ⚠️ `mt-auto` — the actions sit at the foot of the column however tall
           it has been stretched, which is where a reader looks for them. */
        className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg py-3 text-body-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ backgroundColor: 'var(--accent-primary)' }}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <>
            Use This Template
            <ArrowRight className="size-4" aria-hidden="true" />
          </>
        )}
      </button>

      {/* ⚠️ IT OPENS THE LAST REPORT THIS TEMPLATE PRODUCED, and is disabled
          until there is one. The reference implies a preview of the template's
          output, which does not exist before it has been run — and a button that
          silently triggered a generation to satisfy the word "preview" would be
          an expensive surprise, not a preview. Disabled it says exactly what to
          do about it. */}
      {lastReportId ? (
        <a
          href={`/api/project-report/${lastReportId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border-default py-2.5 text-body-sm font-medium text-text-primary transition-colors hover:bg-bg-subtle"
        >
          <Eye className="size-4" aria-hidden="true" />
          Preview Full Report
        </a>
      ) : (
        <span
          title="Run this template once and its report opens here."
          className="mt-1.5 inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-dashed border-border-default py-2.5 text-body-sm font-medium text-text-tertiary"
        >
          <Eye className="size-4" aria-hidden="true" />
          Preview Full Report
        </span>
      )}

      <button
        type="button"
        onClick={() => setScheduling((v) => !v)}
        aria-expanded={scheduling}
        className="mt-2 inline-flex w-full items-center justify-center gap-1.5 text-micro font-semibold text-text-brand hover:underline"
      >
        <CalendarClock className="size-3.5" aria-hidden="true" />
        {scheduling ? 'Hide scheduling' : 'Run it on a schedule'}
      </button>

      {scheduling && (
        <div className="mt-2 rounded-lg border border-border-subtle bg-bg-subtle p-2.5">
          {canSchedule ? (
            <>
              <div className="space-y-1">
                {CADENCES.map((c) => (
                  <label
                    key={c}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors',
                      cadence === c
                        ? 'border-accent-primary bg-bg-surface'
                        : 'border-transparent hover:bg-bg-surface',
                    )}
                  >
                    <input
                      type="radio"
                      name="cadence"
                      checked={cadence === c}
                      onChange={() => setCadence(c)}
                      className="size-3 accent-[var(--accent-primary)]"
                    />
                    <span className="text-micro text-text-primary">{CADENCE_LABEL[c]}</span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void onSchedule(cadence)}
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-default bg-bg-surface py-2 text-micro font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
              >
                Schedule it for {projectName}
              </button>
              {/* ⚠️ IT DOES NOT EMAIL ANYBODY, AND THE PAGE SAYS SO. Outbound
                  mail is dead — Resend's domain is `status: failed` — so there is
                  deliberately nowhere to type a recipient. */}
              <p className="mt-2 text-[0.58rem] leading-snug text-text-tertiary">
                A scheduled report files itself into the Reports tab on its due date. It is not
                emailed to anyone yet.
              </p>
            </>
          ) : (
            <p className="text-micro leading-relaxed text-text-secondary">
              Only a Coordinator and above can put a report on a schedule. You can still run
              this one whenever you need it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- The preview tiles --------------------------------------------------- */

/**
 * A miniature of a block the report contains.
 *
 * ⚠️ DRAWN, NOT SCREENSHOTTED, and not fed live figures either. It is a shape —
 * the silhouette of a line chart, a donut, bars — at 60px tall, where a real
 * number would be four illegible pixels. Wiring live data in would cost queries
 * to render something nobody can read, and putting FAKE numbers on it would be
 * the one thing this page has consistently refused to do. The labels name the
 * block; the figures live in the report.
 */
function PreviewTile({ block, token }: { block: PreviewBlock; token: string }) {
  const title: Readonly<Record<PreviewBlock, string>> = {
    overview: 'Overview',
    channels: 'Channel Breakdown',
    campaigns: 'Top Posts',
    growth: 'Growth',
    columns: 'Columns',
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-surface">
      <p className="truncate border-b border-border-subtle px-1.5 py-1 text-[0.5rem] font-semibold text-text-secondary">
        {title[block]}
      </p>
      <div className="grid h-[58px] place-items-center px-1.5 py-1">
        <svg viewBox="0 0 60 40" className="h-full w-full" aria-hidden="true">
          {block === 'overview' && (
            <>
              <rect x="2" y="3" width="24" height="9" rx="2" fill={`var(--${token}-wash)`} />
              <rect x="30" y="3" width="24" height="9" rx="2" fill="var(--chart-grid)" />
              <path
                d="M3 34 L13 27 L21 30 L31 20 L41 22 L53 12"
                fill="none"
                stroke={`var(--${token})`}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}

          {block === 'channels' && (
            <>
              <circle
                cx="20"
                cy="20"
                r="12"
                fill="none"
                stroke="var(--chart-1)"
                strokeWidth="7"
                strokeDasharray="34 42"
              />
              <circle
                cx="20"
                cy="20"
                r="12"
                fill="none"
                stroke="var(--chart-2)"
                strokeWidth="7"
                strokeDasharray="22 54"
                strokeDashoffset="-34"
              />
              <circle
                cx="20"
                cy="20"
                r="12"
                fill="none"
                stroke="var(--chart-3)"
                strokeWidth="7"
                strokeDasharray="20 56"
                strokeDashoffset="-56"
              />
              {[0, 1, 2].map((i) => (
                <g key={i}>
                  <circle cx="40" cy={12 + i * 8} r="2" fill={`var(--chart-${i + 1})`} />
                  <rect
                    x="45"
                    y={10.5 + i * 8}
                    width="13"
                    height="3"
                    rx="1.5"
                    fill="var(--chart-grid)"
                  />
                </g>
              ))}
            </>
          )}

          {block === 'campaigns' &&
            [26, 34, 18, 30, 12].map((h, i) => (
              <rect
                key={i}
                x={4 + i * 11}
                y={38 - h}
                width="7"
                height={h}
                rx="1.5"
                fill={`var(--chart-${(i % 4) + 1})`}
                opacity={0.85}
              />
            ))}

          {block === 'growth' && (
            <>
              <path
                d="M3 33 L15 28 L27 29 L39 18 L51 8 L57 6 L57 38 L3 38 Z"
                fill={`var(--${token})`}
                opacity="0.14"
              />
              <path
                d="M3 33 L15 28 L27 29 L39 18 L51 8 L57 6"
                fill="none"
                stroke={`var(--${token})`}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="57" cy="6" r="2.4" fill={`var(--${token})`} />
            </>
          )}

          {block === 'columns' &&
            [0, 1, 2, 3, 4].map((i) => (
              <g key={i}>
                <rect
                  x="3"
                  y={4 + i * 7}
                  width="16"
                  height="4"
                  rx="1"
                  fill={i === 0 ? `var(--${token})` : 'var(--chart-grid)'}
                />
                <rect x="22" y={4 + i * 7} width="14" height="4" rx="1" fill="var(--chart-grid)" />
                <rect x="39" y={4 + i * 7} width="18" height="4" rx="1" fill="var(--chart-grid)" />
              </g>
            ))}
        </svg>
      </div>
    </div>
  );
}

/* ---- Reports ------------------------------------------------------------- */

function ReportsList({
  reports,
  nowMs,
  projectName,
}: {
  reports: readonly GeneratedReport[];
  nowMs: number;
  projectName: string;
}) {
  return (
    <Panel
      title={`Reports generated for ${projectName}`}
      info="Every report ever made for this project. The PDF is drawn from the stored row on demand, so an old report opens as the document that was sent."
    >
      {reports.length === 0 ? (
        <PanelEmpty>
          No report has been generated for this project yet. Run a template from the library.
        </PanelEmpty>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {reports.map((r) => (
            <li key={r.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--chart-1-wash)]">
                <FileTypeIcon type="pdf" size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-micro font-semibold text-text-primary">
                  {r.periodLabel}
                </span>
                <span className="block truncate text-[0.62rem] text-text-tertiary">
                  {r.summary || r.kind}
                </span>
                <span className="mt-0.5 block text-[0.6rem] text-text-tertiary">
                  {ago(nowMs - Date.parse(r.createdAt))}
                  {r.createdByName ? ` · ${r.createdByName}` : ''}
                </span>
              </span>
              <a
                href={`/api/project-report/${r.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1 text-micro font-medium text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
              >
                Open
                <ExternalLink className="size-3 opacity-70" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---- Schedules ----------------------------------------------------------- */

function SchedulesList({
  schedules,
  todayKarachi,
  canSchedule,
  onToggle,
  onDelete,
  onBrowse,
}: {
  schedules: readonly ReportSchedule[];
  todayKarachi: string;
  canSchedule: boolean;
  onToggle: (id: string, active: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onBrowse: () => void;
}) {
  return (
    <Panel title="Scheduled reports">
      {schedules.length === 0 ? (
        <div className="grid place-items-center rounded-lg border border-dashed border-border-subtle px-4 py-12 text-center">
          <p className="text-body-sm font-semibold text-text-primary">Nothing is scheduled</p>
          <p className="mt-1 max-w-md text-caption text-text-secondary">
            Pick a template and choose a cadence, and it will file itself into the Reports tab
            on its due date.
          </p>
          <button
            type="button"
            onClick={onBrowse}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-micro font-semibold text-accent-foreground"
            style={{ backgroundColor: 'var(--accent-primary)' }}
          >
            <Layers className="size-3.5" aria-hidden="true" />
            Browse templates
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {schedules.map((s) => {
            const state = scheduleState(s, todayKarachi);
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-bg-subtle">
                  <CalendarClock className="size-4 text-text-secondary" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-micro font-semibold text-text-primary">
                    {s.templateName}
                  </span>
                  <span className="block text-[0.62rem] text-text-tertiary">
                    {CADENCE_LABEL[s.cadence]} · {s.format.toUpperCase()}
                    {s.createdByName ? ` · set up by ${s.createdByName}` : ''}
                  </span>
                  <span className="block text-[0.6rem] leading-snug text-text-tertiary">
                    {state.detail}
                  </span>
                </span>

                <span
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.6rem] font-bold"
                  style={{
                    backgroundColor: `color-mix(in oklab, var(--${state.token}) 14%, transparent)`,
                    color: `var(--${state.token})`,
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: `var(--${state.token})` }}
                  />
                  {state.label}
                </span>

                {canSchedule && (
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => void onToggle(s.id, !s.isActive)}
                      title={s.isActive ? 'Pause' : 'Resume'}
                      aria-label={s.isActive ? 'Pause schedule' : 'Resume schedule'}
                      className="rounded-md border border-border-subtle p-1.5 text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
                    >
                      {s.isActive ? <Pause className="size-3" /> : <Play className="size-3" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDelete(s.id)}
                      aria-label="Delete schedule"
                      className="rounded-md border border-border-subtle p-1.5 transition-colors hover:bg-bg-subtle"
                      style={{ color: 'var(--feedback-error)' }}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ---- Export history ------------------------------------------------------ */

function HistoryList({ rows, nowMs }: { rows: readonly ExportRecord[]; nowMs: number }) {
  return (
    <Panel
      title="Export history"
      info="Every export anybody took, successful or not. Append-only: once a file is in a Downloads folder, this is the only record of when it left."
    >
      {rows.length === 0 ? (
        <PanelEmpty>Nothing has been exported for this project yet.</PanelEmpty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-border-default">
                {['Template', 'Format', 'Size', 'Rows', 'Taken by', 'When', ''].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-2 pb-1.5 text-[0.6rem] font-bold uppercase tracking-wide text-text-tertiary first:pl-0"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border-subtle last:border-0">
                  <td className="max-w-[14rem] truncate px-2 py-2 pl-0 text-micro font-medium text-text-primary">
                    <span className="inline-flex items-center gap-1.5">
                      {r.status === 'failed' ? (
                        <AlertTriangle
                          className="size-3 shrink-0"
                          style={{ color: 'var(--feedback-error)' }}
                          aria-hidden="true"
                        />
                      ) : (
                        <CheckCircle2
                          className="size-3 shrink-0"
                          style={{ color: 'var(--feedback-success)' }}
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate">{r.templateName}</span>
                    </span>
                    {/* ⚠️ THE FAILURE'S REASON IS SHOWN, not just a red mark. A
                        history that records failures without saying why makes the
                        same export fail again tomorrow. */}
                    {r.error && (
                      <span
                        className="mt-0.5 block truncate text-[0.6rem] font-normal"
                        style={{ color: 'var(--feedback-error)' }}
                        title={r.error}
                      >
                        {r.error}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <FileTypeIcon type={r.format} size={14} />
                      <span className="text-micro text-text-secondary">
                        {r.format.toUpperCase()}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-2 text-micro tabular-nums text-text-secondary">
                    {fileSize(r.byteSize)}
                  </td>
                  <td className="px-2 py-2 text-micro tabular-nums text-text-secondary">
                    {r.rowCount ?? '—'}
                  </td>
                  <td className="max-w-[9rem] truncate px-2 py-2 text-micro text-text-secondary">
                    {r.requestedByName ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-micro text-text-tertiary">
                    {ago(nowMs - Date.parse(r.createdAt))}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {/* ⚠️ ONLY A PDF CAN BE RE-OPENED, and only a successful one.
                        A CSV was streamed to the browser and never stored, so
                        there is nothing to link to — offering a dead download
                        would be worse than offering none. */}
                    {r.status === 'ready' && r.reportId ? (
                      <a
                        href={`/api/project-report/${r.reportId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-micro font-medium text-text-brand hover:underline"
                      >
                        Open
                        <ExternalLink className="size-3 opacity-70" aria-hidden="true" />
                      </a>
                    ) : (
                      <span
                        className="text-[0.6rem] text-text-tertiary"
                        title={
                          r.status === 'failed'
                            ? 'This export failed, so there is no file.'
                            : 'A CSV is streamed straight to the browser and not stored, so there is nothing to re-open. Run the template again.'
                        }
                      >
                        {r.status === 'failed' ? 'no file' : 'not stored'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ---- Creating a custom template ------------------------------------------ */

const ENGINE_CHOICES = [
  { value: 'project_report', label: 'Project report (drawn PDF)', needsKind: true },
  { value: 'tasks_csv', label: 'Task export (CSV)', needsKind: false },
  { value: 'workload_csv', label: 'Team workload (CSV)', needsKind: false },
  { value: 'meta_metrics_csv', label: 'Meta daily metrics (CSV)', needsKind: false },
  { value: 'meta_posts_csv', label: 'Meta post performance (CSV)', needsKind: false },
] as const;

function CreateTemplate({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string, ok: boolean) => void;
}) {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState<string>('performance');
  const [engine, setEngine] = React.useState<string>('project_report');
  const [kind, setKind] = React.useState<string>('month');
  const [saving, setSaving] = React.useState(false);

  const needsKind = ENGINE_CHOICES.find((e) => e.value === engine)?.needsKind ?? false;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgb(6_35_42_/_0.45)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create a custom template"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border-subtle bg-bg-surface p-4 shadow-[0_20px_50px_rgb(6_35_42_/_0.25)]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-body font-semibold text-text-primary">Create a custom template</h2>
            <p className="mt-0.5 text-caption text-text-secondary">
              A name over one of the generators. Everyone in the division sees it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-3 space-y-2.5">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Client recap"
              className="w-full rounded-lg border border-border-subtle bg-bg-base px-2.5 py-1.5 text-micro text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
            />
          </Field>

          <Field label="What it is for">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={400}
              placeholder="The sheet we send on the last Friday of the month."
              className="w-full resize-none rounded-lg border border-border-subtle bg-bg-base px-2.5 py-1.5 text-micro text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
            />
          </Field>

          <Field label="What it produces">
            {/* ⚠️ A LIST OF GENERATORS THAT EXIST. No free-text field here on
                purpose: a template whose engine nothing implements is a button
                that does nothing, which is the one thing this tab is built not to
                have. */}
            <select
              value={engine}
              onChange={(e) => setEngine(e.target.value)}
              className="w-full rounded-lg border border-border-subtle bg-bg-base px-2.5 py-1.5 text-micro text-text-primary focus:border-accent-primary focus:outline-none"
            >
              {ENGINE_CHOICES.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </Field>

          {needsKind && (
            <Field label="Period">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="w-full rounded-lg border border-border-subtle bg-bg-base px-2.5 py-1.5 text-micro text-text-primary focus:border-accent-primary focus:outline-none"
              >
                {REPORT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PERIOD_TAG[k]} — {REPORT_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-border-subtle bg-bg-base px-2.5 py-1.5 text-micro text-text-primary focus:border-accent-primary focus:outline-none"
            >
              {TEMPLATE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-border-subtle py-2 text-micro font-medium text-text-secondary transition-colors hover:bg-bg-subtle"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || name.trim().length < 2}
            onClick={async () => {
              setSaving(true);
              try {
                const r = await createCustomTemplateAction({
                  name,
                  description,
                  category,
                  engine,
                  kind: needsKind ? kind : null,
                });
                onDone(
                  r.ok ? `${name.trim()} added to the library.` : (r.error ?? 'Could not save it.'),
                  r.ok,
                );
              } finally {
                setSaving(false);
              }
            }}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-micro font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent-primary)' }}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            Create template
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wide text-text-tertiary">
        {label}
      </span>
      {children}
    </label>
  );
}

/* ---- Helpers ------------------------------------------------------------- */

function ago(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}
