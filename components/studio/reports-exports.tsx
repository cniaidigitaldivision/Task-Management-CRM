'use client';

import * as React from 'react';
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Filter,
  Grid2x2Check,
  Image as ImageIcon,
  Layers,
  Link2,
  ListChecks,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ScrollText,
  Search,
  Signature,
  Sparkles,
  Star,
  Table as TableIcon,
  Target,
  Trash2,
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
import {
  CADENCES,
  CADENCE_LABEL,
  CATEGORY_ICON,
  CATEGORY_LABEL,
  CATEGORY_TOKEN,
  EMPTY_FILTER,
  EXPORT_FORMATS,
  PERIOD_TAG,
  TEMPLATE_CATEGORIES,
  fileSize,
  filterActive,
  filterTemplates,
  scheduleState,
  sortTemplates,
  templateKpis,
  templateMeta,
  templateSections,
  templateTags,
  type Cadence,
  type ExportRecord,
  type ReportSchedule,
  type ReportTemplate,
  type TemplateFilter,
} from '@/lib/domain/report-templates';
import { REPORT_KINDS, REPORT_KIND_LABEL } from '@/lib/domain/report-periods';
import { cn } from '@/lib/utils';

import { KpiCard, Panel, PanelEmpty } from './panels';
import { useInView } from './use-in-view';

/* ============================================================================
 * REPORTS & EXPORTS — built to the owner's reference, 2026-09-04
 * ----------------------------------------------------------------------------
 * *"I want the exact same UI for the Report and Export page. Plus everything
 * should be working and live data will be added. Put everything in logically and
 * make it work."*
 *
 * Every figure, card and row below comes from the database. There is no sample
 * data on this tab.
 *
 * ── ⚠️ THREE PLACES THE REFERENCE ASSERTS SOMETHING THIS SYSTEM CANNOT DO ───
 * Each is drawn, and each tells the truth instead of the drawing:
 *
 *   "Supported Formats · 5" and a row of PDF/Excel/PPT/CSV/Slides
 *       Two writers exist. All five are LISTED, because somebody asked for
 *       them and a short row looks like an unfinished page — but the three
 *       without a writer are disabled and carry the reason. A live button that
 *       produces nothing is the only genuinely bad option of the three.
 *
 *   "AI Summary Blocks · 42"
 *       Nothing here writes an AI summary. The one AI pass this feature ever
 *       had drew the client's name as "NAYA MARKITING", which is why the whole
 *       thing is typeset now. That slot holds reports actually generated.
 *
 *   "Sections Included ✓ ✓ ✓"
 *       Read-only, and `templateSections` explains why: the composers draw the
 *       owner's layouts at FIXED geometry. Ticking a box off would leave a hole
 *       in the page, not reflow it. So the drawer DESCRIBES the layout — which
 *       is the fact somebody needs when choosing between two templates anyway.
 * ========================================================================= */

const PAGE_SIZE = 6;

/** The one map from the domain's icon keys to marks — see CATEGORY_ICON. */
const ICONS: Readonly<Record<string, typeof FileText>> = {
  chart: BarChart3,
  image: ImageIcon,
  checks: ListChecks,
  users: Users,
  signature: Signature,
  table: TableIcon,
  target: Target,
  calendar: CalendarRange,
  marks: Grid2x2Check,
  link: Link2,
  notes: ScrollText,
  pdf: FileText,
  sheet: FileSpreadsheet,
  layers: Layers,
  star: Star,
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

export function ReportsExports({
  projectId,
  projectName,
  templates,
  schedules,
  exports: exportRows,
  reports,
  reportsGenerated,
  exportsTaken,
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
  reportsGenerated: number;
  exportsTaken: number;
  /** Today in Karachi — the server's answer, so "Overdue" cannot disagree. */
  todayKarachi: string;
  nowMs: number;
  canSchedule: boolean;
}) {
  const [tab, setTab] = React.useState<SubTab>('library');
  const [filter, setFilter] = React.useState<TemplateFilter>(EMPTY_FILTER);
  const [page, setPage] = React.useState(0);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const kpis = React.useMemo(
    () => templateKpis({ templates, reportsGenerated, exportsTaken, nowMs }),
    [templates, reportsGenerated, exportsTaken, nowMs],
  );

  const matched = React.useMemo(
    () => sortTemplates(filterTemplates(templates, filter)),
    [templates, filter],
  );

  /* ⚠️ THE PAGE IS CLAMPED RATHER THAN RESET IN AN EFFECT. Narrowing a filter
     while on page 3 must not show an empty grid, and `set-state-in-effect` is
     lint-refused here for good reason — deriving it costs nothing and cannot
     produce the one-render flash an effect would. */
  const pageCount = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const shown = matched.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const open = openId ? (templates.find((t) => t.id === openId) ?? null) : null;

  const say = (tone: 'ok' | 'bad', text: string) => {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 6000);
  };

  /* ── Running a template ─────────────────────────────────────────────────── */
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
             fails silently — no error, no file. `revokeObjectURL` afterwards,
             or every export leaks its bytes for the life of the tab. */
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
      {/* ── The six figures ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k, i) => (
          <KpiCard
            key={k.key}
            index={i}
            data={{
              key: k.key,
              label: k.label,
              value: k.value,
              /* ⚠️ "Most used" holds a TEMPLATE NAME. At the numeric size it set
                 its own card three lines tall and left the row ragged. */
              textValue: k.key === 'most-used',
              icon: ICONS[k.icon] ?? FileText,
              token: k.token,
              footnote: k.footnote,
            }}
          />
        ))}
      </div>

      {/* ── Sub-tabs ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-lg bg-bg-subtle p-0.5">
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
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-micro transition-all duration-200',
                  tab === t.key
                    ? 'bg-bg-surface font-semibold text-text-primary shadow-[0_1px_2px_rgb(6_35_42_/_0.08)]'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {t.label}
                <span className="tabular-nums text-text-tertiary">{count}</span>
              </button>
            );
          })}
        </div>
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
            <CheckCircle2 className="mt-px size-3.5 shrink-0" style={{ color: 'var(--feedback-success)' }} />
          ) : (
            <AlertTriangle className="mt-px size-3.5 shrink-0" style={{ color: 'var(--feedback-error)' }} />
          )}
          <span className="text-micro text-text-primary">{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-auto text-text-tertiary hover:text-text-primary"
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {tab === 'library' ? (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-3">
            <FilterBar
              filter={filter}
              onChange={(f) => {
                setFilter(f);
                setPage(0);
              }}
              matched={matched.length}
              total={templates.length}
            />

            {shown.length === 0 ? (
              <PanelEmpty>
                Nothing matches those filters. {templates.length} templates exist.
              </PanelEmpty>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {shown.map((t, i) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    index={i}
                    active={openId === t.id}
                    busy={busyId === t.id}
                    onOpen={() => setOpenId(t.id === openId ? null : t.id)}
                    onRun={() => void run(t)}
                    onStar={async () => {
                      await toggleTemplateFavouriteAction(t.id);
                    }}
                  />
                ))}

                {/* The reference's dashed tile, on the last page only. */}
                {current === pageCount - 1 && (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="group flex min-h-[13rem] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-default bg-bg-surface p-4 text-center transition-colors hover:border-accent-primary hover:bg-bg-subtle"
                  >
                    <span className="grid size-10 place-items-center rounded-full bg-bg-subtle transition-transform group-hover:scale-110">
                      <Plus className="size-5 text-text-secondary" aria-hidden="true" />
                    </span>
                    <span className="text-body-sm font-semibold text-text-primary">
                      Create custom template
                    </span>
                    <span className="max-w-[16rem] text-caption text-text-tertiary">
                      Name a preset over one of the generators, and it appears here for
                      everyone.
                    </span>
                  </button>
                )}
              </div>
            )}

            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-1.5">
                <button
                  type="button"
                  disabled={current === 0}
                  onClick={() => setPage(current - 1)}
                  className="rounded-lg border border-border-subtle px-2.5 py-1 text-micro text-text-secondary transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                {Array.from({ length: pageCount }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPage(i)}
                    aria-current={i === current ? 'page' : undefined}
                    className={cn(
                      'size-7 rounded-lg text-micro tabular-nums transition-colors',
                      i === current
                        ? 'font-semibold text-accent-foreground'
                        : 'border border-border-subtle text-text-secondary hover:bg-bg-subtle',
                    )}
                    style={i === current ? { backgroundColor: 'var(--accent-primary)' } : undefined}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={current >= pageCount - 1}
                  onClick={() => setPage(current + 1)}
                  className="rounded-lg border border-border-subtle px-2.5 py-1 text-micro text-text-secondary transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>

          {/* ── The detail drawer ──────────────────────────────────────── */}
          <aside className="space-y-3">
            {open ? (
              <TemplateDetail
                template={open}
                projectName={projectName}
                busy={busyId === open.id}
                canSchedule={canSchedule}
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
                onDelete={async () => {
                  const r = await deleteCustomTemplateAction(open.id);
                  say(r.ok ? 'ok' : 'bad', r.ok ? `${open.name} removed.` : (r.error ?? ''));
                  if (r.ok) setOpenId(null);
                }}
              />
            ) : (
              <Panel title="Pick a template">
                <p className="text-micro leading-relaxed text-text-secondary">
                  Choose one on the left to see what its output contains, which formats it
                  writes, and to run it against{' '}
                  <strong className="font-semibold text-text-primary">{projectName}</strong>.
                </p>
                <ul className="mt-3 space-y-2 border-t border-border-subtle pt-3">
                  {EXPORT_FORMATS.map((f) => (
                    <li key={f.key} className="flex items-start gap-2">
                      <Mark
                        name={f.icon}
                        className={cn(
                          'mt-px size-3.5 shrink-0',
                          f.available ? 'text-text-secondary' : 'text-text-tertiary',
                        )}
                      />
                      <span className="min-w-0">
                        <span
                          className={cn(
                            'text-micro font-semibold',
                            f.available ? 'text-text-primary' : 'text-text-tertiary',
                          )}
                        >
                          {f.label}
                          {!f.available && ' — not available'}
                        </span>
                        <span className="block text-[0.62rem] leading-snug text-text-tertiary">
                          {f.reason}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
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

/* ---- Filter bar ---------------------------------------------------------- */

function FilterBar({
  filter,
  onChange,
  matched,
  total,
}: {
  filter: TemplateFilter;
  onChange: (f: TemplateFilter) => void;
  matched: number;
  total: number;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-surface p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[12rem] flex-1">
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
            className="w-full rounded-lg border border-border-subtle bg-bg-base py-1.5 pl-8 pr-2.5 text-micro text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
          />
        </label>

        <Select
          label="Category"
          value={filter.category}
          onChange={(v) => onChange({ ...filter, category: v as TemplateFilter['category'] })}
          options={[
            { value: 'all', label: 'All categories' },
            ...TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })),
          ]}
        />

        <Select
          label="Format"
          value={filter.format}
          onChange={(v) => onChange({ ...filter, format: v as TemplateFilter['format'] })}
          options={[
            { value: 'all', label: 'All formats' },
            { value: 'pdf', label: 'PDF' },
            { value: 'csv', label: 'CSV' },
          ]}
        />

        {/* ⚠️ THE REFERENCE'S THIRD FILTER IS "TEAM" AND THERE IS NOTHING TO
            FILTER BY — a template belongs to the division, not a team, and no
            column says otherwise. The real distinction in this list is who made
            it, which is what somebody scanning for "the one I built" wants. */}
        <Select
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
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-micro font-medium transition-colors',
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
          Favourites
        </button>

        {filterActive(filter) && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTER)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-micro text-text-secondary transition-colors hover:text-text-primary"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Clear filters
          </button>
        )}
      </div>

      {filterActive(filter) && (
        <p className="mt-2 flex items-center gap-1.5 border-t border-border-subtle pt-2 text-[0.62rem] text-text-tertiary">
          <Filter className="size-3" aria-hidden="true" />
          {matched} of {total} templates
        </p>
      )}
    </div>
  );
}

function Select({
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
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-border-subtle bg-bg-surface px-2 py-1.5 text-micro text-text-secondary transition-colors hover:border-border-default focus:border-accent-primary focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
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
}: {
  template: ReportTemplate;
  index: number;
  active: boolean;
  busy: boolean;
  onOpen: () => void;
  onRun: () => void;
  onStar: () => Promise<void>;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const token = CATEGORY_TOKEN[template.category];
  /* Optimistic, so the star fills the instant it is pressed rather than after a
     round trip and a revalidate. The server is the truth on the next load. */
  const [starred, setStarred] = React.useState(template.isFavourite);

  return (
    <div
      ref={ref}
      className={cn(
        'studio-reveal flex min-h-[13rem] flex-col rounded-xl border bg-bg-surface p-3.5 transition-all duration-300 hover:-translate-y-px hover:shadow-[0_6px_18px_rgb(6_35_42_/_0.09)]',
        'motion-safe:animate-[studio-rise_620ms_cubic-bezier(0.16,1,0.3,1)_backwards]',
        active ? 'border-accent-primary shadow-[0_4px_14px_rgb(6_35_42_/_0.08)]' : 'border-border-subtle',
        inView && 'is-visible',
      )}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-[10px]"
          style={{ backgroundColor: `var(--${token}-wash)` }}
        >
          <Mark name={CATEGORY_ICON[template.category]} className="size-[18px]" />
        </span>

        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left"
          aria-expanded={active}
        >
          <span className="block truncate text-body-sm font-semibold text-text-primary">
            {template.name}
          </span>
          <span className="block text-[0.62rem] text-text-tertiary">{templateMeta(template)}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setStarred((s) => !s);
            void onStar();
          }}
          aria-pressed={starred}
          aria-label={starred ? 'Remove from favourites' : 'Add to favourites'}
          className="shrink-0 rounded-md p-1 transition-colors hover:bg-bg-subtle"
        >
          <Star
            className={cn('size-3.5', starred ? 'fill-current' : 'text-text-tertiary')}
            style={starred ? { color: 'var(--chart-2)' } : undefined}
          />
        </button>
      </div>

      <p className="mt-2 line-clamp-3 flex-1 text-caption leading-relaxed text-text-secondary">
        {template.description}
      </p>

      <div className="mt-2.5 flex flex-wrap gap-1">
        {templateTags(template).map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-bg-subtle px-1.5 py-0.5 text-[0.58rem] font-medium text-text-secondary"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-2.5 flex items-center gap-2 border-t border-border-subtle pt-2.5">
        <span className="flex-1 truncate text-[0.6rem] text-text-tertiary">
          {/* ⚠️ "Never used" RATHER THAN "Used 0 times". The reference prints a
              usage line on every card; nought times is not a count worth
              printing, it is a different fact. */}
          {template.usageCount === 0
            ? 'Never used'
            : `Used ${template.usageCount} ${template.usageCount === 1 ? 'time' : 'times'}`}
        </span>
        <button
          type="button"
          onClick={onRun}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-micro font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: 'var(--accent-primary)' }}
        >
          {busy ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-3" aria-hidden="true" />
          )}
          {busy ? 'Working' : 'Use'}
        </button>
      </div>
    </div>
  );
}

/* ---- The drawer ---------------------------------------------------------- */

function TemplateDetail({
  template,
  projectName,
  busy,
  canSchedule,
  onRun,
  onClose,
  onSchedule,
  onDelete,
}: {
  template: ReportTemplate;
  projectName: string;
  busy: boolean;
  canSchedule: boolean;
  onRun: () => void;
  onClose: () => void;
  onSchedule: (cadence: Cadence) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const summary = React.useMemo(() => templateSections(template), [template]);
  const [cadence, setCadence] = React.useState<Cadence>('monthly');

  return (
    <>
      <Panel
        title={template.name}
        action={
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-0.5 text-text-tertiary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <X className="size-3.5" />
          </button>
        }
      >
        <p className="text-caption leading-relaxed text-text-secondary">{template.description}</p>

        {/* ── Sections / columns ─────────────────────────────────────────── */}
        <h3 className="mt-3 border-t border-border-subtle pt-3 text-[0.62rem] font-bold uppercase tracking-wide text-text-tertiary">
          {summary.heading}
        </h3>
        <ul className="mt-2 space-y-2">
          {summary.sections.map((s) => (
            <li key={s.key} className="flex items-start gap-2">
              {/* ⚠️ A TICK, NOT A CHECKBOX. The reference draws these as choices;
                  they are not — the composer's geometry is fixed, so unticking
                  one would leave a hole rather than reflow the page. A tick
                  states what is there. See templateSections. */}
              <CheckCircle2
                className="mt-px size-3.5 shrink-0"
                style={{ color: 'var(--feedback-success)' }}
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block text-micro font-medium text-text-primary">{s.label}</span>
                {s.note && (
                  <span className="block text-[0.62rem] leading-snug text-text-tertiary">
                    {s.note}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-bg-subtle px-2 py-1.5 text-[0.6rem] leading-snug text-text-tertiary">
          <Sparkles className="mt-px size-3 shrink-0" aria-hidden="true" />
          <span>
            Fixed by the layout, not chosen — drawn by{' '}
            <code className="font-mono">{summary.describes}</code>.
          </span>
        </p>

        {/* ── Formats ────────────────────────────────────────────────────── */}
        <h3 className="mt-3 border-t border-border-subtle pt-3 text-[0.62rem] font-bold uppercase tracking-wide text-text-tertiary">
          Export formats
        </h3>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {EXPORT_FORMATS.map((f) => {
            const isThis = f.key === template.format;
            return (
              <span
                key={f.key}
                title={f.available ? f.reason : `Not available — ${f.reason}`}
                className={cn(
                  'flex cursor-help flex-col items-center gap-1 rounded-lg border px-1 py-1.5 text-center',
                  isThis
                    ? 'border-transparent'
                    : f.available
                      ? 'border-border-subtle'
                      : 'border-dashed border-border-default opacity-55',
                )}
                style={isThis ? { backgroundColor: `var(--${CATEGORY_TOKEN[template.category]}-wash)` } : undefined}
              >
                <Mark
                  name={f.icon}
                  className={cn('size-3.5', f.available ? 'text-text-secondary' : 'text-text-tertiary')}
                />
                <span
                  className={cn(
                    'text-[0.55rem] font-semibold leading-none',
                    f.available ? 'text-text-primary' : 'text-text-tertiary',
                  )}
                >
                  {f.label}
                </span>
              </span>
            );
          })}
        </div>
        <p className="mt-1.5 text-[0.6rem] text-text-tertiary">
          This template writes {template.format.toUpperCase()}. The dashed three have no
          writer — hover for why.
        </p>

        <div className="mt-3 space-y-1.5 border-t border-border-subtle pt-3">
          <button
            type="button"
            onClick={onRun}
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-micro font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: 'var(--accent-primary)' }}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="size-3.5" aria-hidden="true" />
            )}
            {busy ? 'Generating…' : `Use this template on ${projectName}`}
          </button>

          {template.usageCount > 0 && template.lastUsedAt && (
            <p className="text-center text-[0.6rem] text-text-tertiary">
              Last run {template.lastUsedAt.slice(0, 10)}
            </p>
          )}

          {!template.isBuiltin && (
            <button
              type="button"
              onClick={() => void onDelete()}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-subtle py-2 text-micro font-medium transition-colors hover:bg-bg-subtle"
              style={{ color: 'var(--feedback-error)' }}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Delete this template
            </button>
          )}
        </div>
      </Panel>

      {/* ── Scheduling ─────────────────────────────────────────────────── */}
      <Panel title="Run it on a schedule">
        {canSchedule ? (
          <>
            <div className="space-y-1.5">
              {CADENCES.map((c) => (
                <label
                  key={c}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors',
                    cadence === c ? 'border-accent-primary bg-bg-subtle' : 'border-border-subtle hover:bg-bg-subtle',
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
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-subtle py-2 text-micro font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
            >
              <CalendarClock className="size-3.5" aria-hidden="true" />
              Schedule it
            </button>

            {/* ⚠️ IT DOES NOT EMAIL ANYBODY, AND THE PAGE SAYS SO. Outbound mail
                is dead — the Resend domain has been `status: failed` since it was
                added — so there is no recipients field to fill in and no
                delivery to promise. A scheduled report FILES itself; somebody
                still sends it. */}
            <p className="mt-2 border-t border-border-subtle pt-2 text-[0.6rem] leading-snug text-text-tertiary">
              A scheduled report files itself into the Reports tab on its due date. It is
              not emailed to anyone — outbound mail is not working yet, so there is
              deliberately nowhere here to type a recipient.
            </p>
          </>
        ) : (
          <p className="text-micro leading-relaxed text-text-secondary">
            Only a Coordinator and above can put a report on a schedule. You can still run
            this one whenever you need it.
          </p>
        )}
      </Panel>
    </>
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
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--chart-1-wash)]">
                <FileText className="size-4" style={{ color: 'var(--chart-1)' }} aria-hidden="true" />
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
            Pick a template and choose a cadence, and it will file itself into the Reports
            tab on its due date.
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
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-bg-subtle">
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
                    {/* ⚠️ THE FAILURE'S REASON IS SHOWN, not just a red mark.
                        A history that records failures without saying why makes
                        the same export fail again tomorrow. */}
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
                  <td className="px-2 py-2 text-micro text-text-secondary">
                    {r.format.toUpperCase()}
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

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgb(6_35_42_/_0.45)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create a custom template"
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
            {/* ⚠️ A LIST OF GENERATORS THAT EXIST. There is no free-text field
                here on purpose: a template whose engine nothing implements is a
                button that does nothing, which is the one thing this tab is
                built not to have. */}
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
