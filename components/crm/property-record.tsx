'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Building2, Calendar, CalendarDays, ChevronRight, Clock, CreditCard, ExternalLink,
  FileText, HardHat, Layers, Link2, Pencil, Share2, Users,
} from 'lucide-react';

import { cv, OUTLINE, outlineStyle } from '@/components/crm/clients-ui';
import { SharePropertyDialog } from '@/components/crm/property-share';
import { useToast } from '@/components/ui/toast';
import type { PropertyEvent, PropertyRow, StatusSpan } from '@/lib/db/queries/crm-properties';
import {
  areaLabel, characterChips, displayArea, money, sizeLabel, statusLook,
} from '@/lib/domain/crm-property';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE PROPERTY RECORD — the owner's detail reference, 2026-09-27
 * ----------------------------------------------------------------------------
 * Seven tabs, a rail, and a breadcrumb back to the list.
 *
 * ── ⚠️ A TAB WITH NOTHING BEHIND IT SAYS SO ───────────────────────────────
 * Availability history needs a status-history table nobody has built; the
 * others read data that exists. Each empty tab names what it is waiting for
 * rather than showing a spinner or, worse, an empty table that reads as "this
 * plot has none" — the Performance page's rule, and the reason its unbuilt tabs
 * were written out rather than faked.
 *
 * ── ⚠️ EVERY TAB IS CLIENT STATE ──────────────────────────────────────────
 * The page arrived with everything it draws. Switching tabs must not re-run the
 * server render — Rule Zero, law 1.
 * ========================================================================= */

const TABS = [
  'Overview', 'Pricing & payment plan', 'Availability history',
  'Leads & quotations', 'Appointments', 'Documents', 'Activity',
] as const;
type Tab = (typeof TABS)[number];

function dayLabel(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')}`;
}

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

export function PropertyRecord({
  property: row,
  activity,
  spans,
  viewerName,
}: {
  property: PropertyRow;
  activity: readonly PropertyEvent[];
  spans: readonly StatusSpan[];
  viewerName: string;
}) {
  const [tab, setTab] = React.useState<Tab>('Overview');
  const [sharing, setSharing] = React.useState(false);
  const toast = useToast();

  const look = statusLook(row.status);
  const area = displayArea(row.areaSqft, row.sizeMarla, row.marlaStandard);
  const total = (row.basePrice ?? 0) + (row.premiumCharges ?? 0);

  const quotations = row.links.filter((l) => l.kind === 'quotation');
  const appointments = row.links.filter((l) => l.kind === 'appointment');
  const leads = row.links.filter((l) => l.kind === 'lead');

  return (
    <div className="prop-ui clients-ui mx-auto max-w-[var(--content-max)] space-y-[1rem]">
      {/* ── breadcrumb ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-[0.35rem] text-[0.85rem]">
          <Link href="/properties" className="shrink-0 font-medium hover:underline" style={{ color: cv('brand-ink') }}>
            Properties
          </Link>
          <ChevronRight className="size-[0.85rem] shrink-0" style={{ color: cv('mute') }} aria-hidden="true" />
          <span className="truncate" style={{ color: cv('soft') }}>{row.projectName}</span>
          <ChevronRight className="size-[0.85rem] shrink-0" style={{ color: cv('mute') }} aria-hidden="true" />
          <span className="shrink-0 font-medium" style={{ color: cv('ink') }}>{row.code}</span>
        </nav>
        {/* ⚠️ Said out loud. A demo plot that reads like a real one is how an
            invented price reaches a customer. */}
        {row.isTestData && (
          <span className="shrink-0 rounded-full px-[0.6rem] py-[0.2rem] text-[0.74rem] font-medium"
                style={{ background: cv('pill'), color: cv('soft') }}>
            Test data
          </span>
        )}
      </div>

      {/* ── title ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-[0.7rem] text-[1.75rem] font-bold leading-tight tracking-[-0.01em]"
              style={{ color: cv('ink') }}>
            {row.plotNumber ? `Plot ${row.plotNumber}` : row.code}
            {row.block ? <span style={{ color: cv('soft') }}>· Block {row.block}</span> : null}
            <span className="inline-flex items-center gap-[0.4rem] rounded-full px-[0.7rem] py-[0.25rem] text-[0.82rem] font-medium"
                  style={{ background: cv(`${look.tone}-bg`), color: cv(look.tone) }}>
              <span className="size-[0.45rem] rounded-full" style={{ background: cv(`${look.tone}-dot`) }} aria-hidden="true" />
              {look.label}
            </span>
          </h1>
          <p className="mt-[0.15rem] text-[0.95rem]" style={{ color: cv('soft') }}>
            {row.projectName}{row.projectCity ? ` · ${row.projectCity}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {/* ⚠️ Edit lives on the LIST, where the dialog and its change preview
              already are. A second copy here would be a second place for the
              reason-and-preview rules to drift. */}
          <Link href="/properties" className={`${OUTLINE} h-[2.5rem] px-4 text-[0.92rem]`} style={outlineStyle}>
            <Pencil className="size-[1rem]" aria-hidden="true" /> Edit
          </Link>
          <button type="button" onClick={() => setSharing(true)} className={`${OUTLINE} h-[2.5rem] px-4 text-[0.92rem]`} style={outlineStyle}>
            <Share2 className="size-[1rem]" aria-hidden="true" /> Share
          </button>
        </div>
      </div>

      {/* ── tabs ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-[1.3rem] border-b" style={{ borderColor: cv('line') }} role="tablist" aria-label="Property record">
        {TABS.map((t) => {
          const on = tab === t;
          return (
            <button key={t} type="button" role="tab" aria-selected={on} onClick={() => setTab(t)}
                    className="relative -mb-px h-[2.5rem] text-[0.93rem] font-medium transition-colors"
                    style={{ color: on ? cv('brand-ink') : cv('soft') }}>
              {t}
              {on && <span className="absolute inset-x-0 -bottom-px block h-[0.14rem] rounded-full" style={{ background: cv('brand') }} />}
            </button>
          );
        })}
      </div>

      <div className="grid min-w-0 gap-[1rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-[1rem]">
          {tab === 'Overview' && (
            <>
              <Card title="Core information" icon={FileText}>
                <div className="grid gap-x-8 gap-y-[0.35rem] sm:grid-cols-2">
                  <Row k="Property ID" v={row.code} />
                  <Row k="Dimensions" v={row.dimensions ?? '—'} />
                  <Row k="Property type" v={row.kind ?? '—'} />
                  <Row k="Facing" v={row.facing ?? '—'} />
                  <Row k="Project" v={row.projectName} />
                  <Row k="Road size" v={row.roadWidthFt ? `${row.roadWidthFt} ft road` : '—'} />
                  <Row k="Block" v={row.block ?? '—'} />
                  <Row k="Status" v={look.label} />
                  <Row k="Size" v={sizeLabel(row.sizeMarla)} />
                  <Row k="Project standard" v={`${row.marlaStandard} sq ft per Marla`} />
                  <Row k="Total area" v={areaLabel(area)} />
                </div>
                <div className="mt-[0.7rem] flex flex-wrap gap-[0.4rem]">
                  {characterChips(row).map((c) => (
                    <span key={c} className="inline-flex items-center gap-[0.35rem] rounded-[0.42rem] border px-[0.6rem] py-[0.3rem] text-[0.8rem]"
                          style={{ borderColor: cv('line'), color: cv('soft') }}>
                      <Layers className="size-[0.85rem]" aria-hidden="true" /> {c}
                    </span>
                  ))}
                </div>
              </Card>

              <Card title="Pricing" icon={Layers}>
                <div className="grid gap-[0.7rem] sm:grid-cols-3">
                  <Figure label="Base price" value={money(row.basePrice)} />
                  <Figure label="Premium" value={money(row.premiumCharges ?? 0)} />
                  <Figure label="Total price" value={money(total)} strong />
                </div>
                <p className="mt-[0.5rem] text-[0.78rem]" style={{ color: cv('mute') }}>
                  Last priced {dayLabel(row.priceUpdatedAt ?? row.updatedAt)}.
                </p>
              </Card>

              <Card title="Development" icon={Building2}>
                <div className="flex flex-wrap items-center gap-x-10 gap-y-2">
                  <span className="flex items-center gap-[0.5rem] text-[0.88rem]">
                    <span style={{ color: cv('soft') }}>Development status</span>
                    <span className="inline-flex items-center gap-[0.35rem] rounded-[0.35rem] px-[0.55rem] py-[0.2rem] font-medium"
                          style={{ background: cv('pick'), color: cv('brand-ink') }}>
                      <HardHat className="size-[0.85rem]" aria-hidden="true" />
                      {row.developmentStatus ?? 'Not recorded'}
                    </span>
                  </span>
                  <span className="flex items-center gap-[0.5rem] text-[0.88rem]">
                    <span style={{ color: cv('soft') }}>Expected possession</span>
                    <span className="inline-flex items-center gap-[0.35rem] font-medium" style={{ color: cv('ink') }}>
                      <CalendarDays className="size-[0.9rem]" style={{ color: cv('mute') }} aria-hidden="true" />
                      {row.expectedPossession ? dayLabel(row.expectedPossession) : 'Not recorded'}
                    </span>
                  </span>
                </div>
              </Card>

              <Card title="Recent activity" icon={Clock}
                    action={activity.length > 3 ? { label: 'View all activity', onClick: () => setTab('Activity') } : undefined}>
                <Timeline events={activity.slice(0, 3)} />
              </Card>
            </>
          )}

          {tab === 'Pricing & payment plan' && (
            <Card title="Payment plan" icon={CreditCard}>
              {row.stages.length === 0 ? (
                <Empty>
                  No payment plan is stored for this plot. One is generated from the price when a
                  quotation is raised.
                </Empty>
              ) : (
                <table className="w-full text-[0.86rem]">
                  <thead>
                    <tr style={{ color: cv('soft') }}>
                      <th className="py-[0.3rem] text-left font-medium">Stage</th>
                      <th className="py-[0.3rem] text-right font-medium">Share</th>
                      <th className="py-[0.3rem] text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.stages.map((st) => (
                      <tr key={st.label} className="border-t" style={{ borderColor: cv('grid') }}>
                        <td className="py-[0.4rem]" style={{ color: cv('ink') }}>{st.label}</td>
                        <td className="py-[0.4rem] text-right tabular-nums" style={{ color: cv('soft') }}>{st.percentage}%</td>
                        <td className="py-[0.4rem] text-right font-medium tabular-nums" style={{ color: cv('ink') }}>
                          {money(st.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2" style={{ borderColor: cv('line') }}>
                      <td className="py-[0.4rem] font-semibold" style={{ color: cv('ink') }}>Total</td>
                      <td />
                      <td className="py-[0.4rem] text-right font-bold tabular-nums" style={{ color: cv('ink') }}>
                        {money(row.stages.reduce((n, st) => n + st.amount, 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </Card>
          )}

          {tab === 'Availability history' && (
            <Card title="Availability history" icon={Calendar}>
              <Spans spans={spans} />
            </Card>
          )}

          {tab === 'Leads & quotations' && (
            <>
              <Card title="Quotations" icon={FileText}>
                {quotations.length === 0
                  ? <Empty>No quotation names this plot yet.</Empty>
                  : <LinkList items={quotations} />}
              </Card>
              <Card title="Leads" icon={Users}>
                {leads.length === 0
                  ? <Empty>No lead is attached to this plot yet.</Empty>
                  : <LinkList items={leads} />}
              </Card>
            </>
          )}

          {tab === 'Appointments' && (
            <Card title="Appointments" icon={Calendar}>
              {appointments.length === 0
                ? <Empty>No visit has been booked against this plot.</Empty>
                : <LinkList items={appointments} />}
            </Card>
          )}

          {tab === 'Documents' && (
            <Card title="Documents" icon={FileText}>
              <ul className="divide-y" style={{ borderColor: cv('grid') }}>
                {(['property_sheet', 'site_plan', 'payment_plan'] as const).map((kind) => {
                  const doc = row.documents.find((d) => d.kind === kind);
                  const label = kind === 'property_sheet' ? 'Property sheet'
                    : kind === 'site_plan' ? 'Site plan' : 'Payment plan';
                  return (
                    <li key={kind} className="flex items-center justify-between gap-2 py-[0.55rem]">
                      <span className="inline-flex items-center gap-[0.5rem] text-[0.88rem]"
                            style={{ color: doc ? cv('ink') : cv('mute') }}>
                        <FileText className="size-[1rem]" style={{ color: doc ? cv('red-strong') : cv('mute') }} aria-hidden="true" />
                        {label}
                      </span>
                      <span className="text-[0.82rem]" style={{ color: doc ? cv('brand-ink') : cv('mute') }}>
                        {doc ? 'View' : 'Not uploaded'}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {/* ⚠️ The owner's legal instruction, on the screen it applies to. */}
              <p className="mt-[0.6rem] text-[0.78rem]" style={{ color: cv('mute') }}>
                Allotment letters, agreements, NOCs and title documents are never generated here.
              </p>
            </Card>
          )}

          {tab === 'Activity' && (
            <Card title="Activity" icon={Clock}>
              <Timeline events={activity} />
            </Card>
          )}
        </div>

        {/* ── the rail ───────────────────────────────────────────────────── */}
        <aside className="space-y-[1rem]">
          <Card title="Availability" icon={Calendar}>
            <p className="mb-[0.6rem] flex items-center gap-[0.5rem] rounded-[0.45rem] px-[0.7rem] py-[0.5rem] text-[0.95rem] font-semibold"
               style={{ background: cv(`${look.tone}-soft`) || cv(`${look.tone}-bg`), color: cv(look.tone) }}>
              <span className="size-[0.6rem] rounded-full" style={{ background: cv(`${look.tone}-dot`) }} aria-hidden="true" />
              {look.label}
            </p>
            <p className="flex items-start gap-[0.5rem] text-[0.85rem]">
              <CalendarDays className="mt-[0.1rem] size-[1rem] shrink-0" style={{ color: cv('mute') }} aria-hidden="true" />
              <span>
                <span className="block font-medium" style={{ color: cv('ink') }}>
                  {row.activeBooking ?? 'No active booking'}
                </span>
                <span className="block text-[0.8rem]"
                      style={{ color: row.activeBooking && row.status === 'available' ? cv('amber') : cv('soft') }}>
                  {/* ⚠️ A PLOT WITH A BOOKING THAT STILL READS AVAILABLE IS A REAL
                      PROBLEM, and this page found one on the first row it drew.
                      Saying "held against that booking" would have described the
                      booking and contradicted the badge two inches above it. It
                      names the disagreement instead — somebody has to decide
                      which of the two is right, and they can only do that if the
                      screen admits they differ. */}
                  {row.activeBooking && row.status === 'available'
                    ? 'A booking is on record but this plot is still marked Available — one of the two needs correcting.'
                    : row.activeBooking
                      ? 'This plot is held against that booking.'
                      : row.status === 'available'
                        ? 'This property is available for booking.'
                        : `Marked ${look.label.toLowerCase()} with no booking reference.`}
                </span>
              </span>
            </p>
            <button type="button" onClick={() => setSharing(true)}
                    className={`${OUTLINE} mt-[0.7rem] h-[2.5rem] w-full text-[0.9rem]`} style={outlineStyle}>
              <Share2 className="size-[1rem]" aria-hidden="true" /> Share property
            </button>
          </Card>

          <Card title="Relationship" icon={Users}>
            <div className="grid grid-cols-3 gap-2">
              <Figure label="Leads" value={String(row.linkedLeads)} />
              <Figure label="Quotations" value={String(row.linkedQuotations)} />
              <Figure label="Appointments" value={String(row.linkedAppointments)} />
            </div>
          </Card>

          <Card title="Linked items" icon={Link2}>
            {row.links.length === 0
              ? <Empty>Nothing is linked to this plot yet.</Empty>
              : <LinkList items={row.links.slice(0, 8)} />}
          </Card>
        </aside>
      </div>

      <SharePropertyDialog
        open={sharing}
        onClose={() => setSharing(false)}
        row={row}
        viewerName={viewerName}
        onToast={(tone, text) => toast({ tone, text })}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * pieces
 * ------------------------------------------------------------------------- */

function Card({
  title, icon: Icon, action, children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties; 'aria-hidden'?: boolean }>;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[0.6rem] border" style={{ borderColor: cv('line'), background: cv('surface') }}>
      <header className="flex items-center justify-between gap-2 border-b px-[0.9rem] py-[0.65rem]" style={{ borderColor: cv('grid') }}>
        <h2 className="inline-flex items-center gap-[0.5rem] text-[1.02rem] font-semibold" style={{ color: cv('ink') }}>
          <Icon className="size-[1.05rem]" style={{ color: cv('brand-ink') }} aria-hidden />
          {title}
        </h2>
        {action && (
          <button type="button" onClick={action.onClick}
                  className="inline-flex items-center gap-[0.3rem] text-[0.84rem] font-medium" style={{ color: cv('brand-ink') }}>
            {action.label} <ChevronRight className="size-[0.85rem]" aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="p-[0.9rem]">{children}</div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <p className="flex min-w-0 items-baseline justify-between gap-4 text-[0.88rem]">
      <span className="shrink-0" style={{ color: cv('soft') }}>{k}</span>
      <span className="min-w-0 truncate text-right font-medium" style={{ color: cv('ink') }}>{v}</span>
    </p>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-[0.45rem] px-[0.7rem] py-[0.55rem]" style={{ background: strong ? cv('pick') : 'transparent' }}>
      <span className="block text-[0.78rem]" style={{ color: cv('soft') }}>{label}</span>
      <span className={cn('block tabular-nums', strong ? 'text-[1.1rem] font-bold' : 'text-[1.05rem] font-semibold')}
            style={{ color: cv('ink') }}>
        {value}
      </span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.86rem]" style={{ color: cv('mute') }}>{children}</p>;
}

function LinkList({ items }: { items: readonly { kind: string; id: string; label: string; detail: string | null }[] }) {
  return (
    <ul className="space-y-[0.4rem]">
      {items.map((l) => (
        <li key={`${l.kind}-${l.id}`} className="flex items-center justify-between gap-2 text-[0.86rem]">
          <span className="inline-flex min-w-0 items-center gap-[0.45rem]">
            <Link2 className="size-[0.9rem] shrink-0" style={{ color: cv('mute') }} aria-hidden="true" />
            <span className="truncate font-medium" style={{ color: cv('brand-ink') }}>{l.label}</span>
            {l.detail ? (
              <span className="shrink-0 rounded-full px-[0.45rem] py-[0.1rem] text-[0.72rem]"
                    style={{ background: cv('pill'), color: cv('soft') }}>{l.detail}</span>
            ) : null}
          </span>
          <span className="inline-flex shrink-0 items-center gap-[0.3rem] text-[0.78rem] capitalize" style={{ color: cv('soft') }}>
            {l.kind}
            <ExternalLink className="size-[0.8rem]" aria-hidden="true" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Timeline({ events }: { events: readonly PropertyEvent[] }) {
  if (events.length === 0) {
    return <Empty>Nothing has happened to this plot since it was added.</Empty>;
  }
  return (
    <ol className="space-y-[0.6rem]">
      {events.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex gap-[0.7rem]">
          <span className="mt-[0.4rem] size-[0.5rem] shrink-0 rounded-full" style={{ background: cv('grey-dot') }} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-3 text-[0.86rem]">
              <span className="tabular-nums" style={{ color: cv('soft') }}>{dayLabel(e.at)}</span>
              <span className="tabular-nums text-[0.8rem]" style={{ color: cv('mute') }}>{timeLabel(e.at)}</span>
              <span className="font-medium" style={{ color: cv('ink') }}>{e.action}</span>
            </span>
            <span className="block text-[0.82rem]" style={{ color: cv('soft') }}>
              {e.detail || '—'}
              {e.actor ? <> · by {e.actor}</> : null}
            </span>
            {/* ⚠️ The reason the editor typed, shown where it is useful. It is
                the whole point of asking for one. */}
            {e.reason ? (
              <span className="mt-[0.15rem] block text-[0.82rem] italic" style={{ color: cv('mute') }}>
                “{e.reason}”
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * How long this plot spent in each state — migration 268's spans.
 *
 * ⚠️ A SPAN, NOT AN EVENT. "Reserved for 19 days, by Sarah, because a
 * walk-in was deciding" is the answer somebody wants; "on the 14th the status
 * became reserved" makes them do the arithmetic and find the next row
 * themselves. The Activity tab still lists the events.
 */
function Spans({ spans }: { spans: readonly StatusSpan[] }) {
  if (spans.length === 0) {
    return <Empty>No availability history has been recorded for this plot yet.</Empty>;
  }
  return (
    <ol className="space-y-[0.55rem]">
      {spans.map((sp, i) => {
        const look = statusLook(sp.status);
        const open = sp.endedAt === null;
        return (
          <li key={`${sp.startedAt}-${i}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[0.5rem] border px-[0.7rem] py-[0.5rem]"
              style={{ borderColor: cv('line'), background: open ? cv('strip') : 'transparent' }}>
            <span className="inline-flex shrink-0 items-center gap-[0.4rem] rounded-full px-[0.6rem] py-[0.2rem] text-[0.78rem] font-medium"
                  style={{ background: cv(`${look.tone}-bg`), color: cv(look.tone) }}>
              <span className="size-[0.4rem] rounded-full" style={{ background: cv(`${look.tone}-dot`) }} aria-hidden="true" />
              {look.label}
            </span>

            <span className="text-[0.84rem]" style={{ color: cv('ink') }}>
              {dayLabel(sp.startedAt)}
              {open ? (
                <span style={{ color: cv('soft') }}> — now</span>
              ) : (
                <span style={{ color: cv('soft') }}> — {dayLabel(sp.endedAt)}</span>
              )}
            </span>

            {/* ⚠️ "Today" rather than "0 days" for a span opened this morning.
                Zero reads as an error; it is simply not a whole day old yet. */}
            <span className="shrink-0 text-[0.82rem] tabular-nums" style={{ color: cv('mute') }}>
              {open ? 'current' : sp.days === 0 ? 'same day' : `${sp.days} ${sp.days === 1 ? 'day' : 'days'}`}
            </span>

            {sp.previous ? (
              <span className="shrink-0 text-[0.8rem]" style={{ color: cv('mute') }}>
                from {statusLook(sp.previous).label.toLowerCase()}
              </span>
            ) : null}

            <span className="min-w-0 flex-1 text-right text-[0.82rem]" style={{ color: cv('soft') }}>
              {sp.by ? `by ${sp.by}` : 'by the system'}
              {sp.reason ? <span className="italic" style={{ color: cv('mute') }}> · “{sp.reason}”</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
