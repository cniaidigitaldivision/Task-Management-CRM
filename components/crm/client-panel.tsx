'use client';

import * as React from 'react';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  ChevronRight,
  Coins,
  ExternalLink,
  FileText,
  Home,
  KeyRound,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Receipt,
} from 'lucide-react';

import { Avatar, cv, IconTile, Kebab, OUTLINE, outlineStyle, SOLID, solidStyle, Square, StatusChip } from '@/components/crm/clients-ui';
import { WhatsAppMark } from '@/components/crm/whatsapp-mark';
import type { ClientMoment, ClientRow } from '@/lib/db/queries/crm-client-board';
import { attention, CHANNEL_LABEL, money, phoneLabel, refLabel, shortDay, valueOf } from '@/lib/domain/crm-client-board';
import type { TabKey as RelatedTab } from '@/components/crm/related-items';

/* ============================================================================
 * THE CLIENT PREVIEW — the right-hand column of the owner's design
 * ----------------------------------------------------------------------------
 * ⚠️ DRAWN FROM THE ROW (Rule Zero, law 3). Everything here except "Recent
 * activity" is already on the row the list holds, so the panel paints in the
 * frame the row was clicked in. Activity is read on selection and says so while
 * it is — never "No activity" for a list still in flight.
 *
 * ⚠️ NOTHING HERE LEAVES THE PAGE FOR A DETAIL. Owner, 2026-09-22: *"for the
 * detail of a lead it should not bring me to the lead page."* Related records
 * open the Related items dialog; View full record opens the lead's own modal;
 * only WhatsApp goes to Conversations, which the owner said is fine.
 *
 * ⚠️ ONE LINE EACH, AS THE DESIGN HAS IT. Owner: *"their details (phone, email,
 * assigned to, preferred channel) are all on one line while we have them in two
 * rows. In the relationship overview these are all on one row."* The panel is
 * the design's 40% of the row now (it was 27rem), which is what lets the name,
 * its chip and the five buttons share a line without truncating anything.
 * ========================================================================= */

export function ClientPanel({
  c,
  nowMs,
  activity,
  onEdit,
  onConversation,
  onRelated,
  onFullRecord,
  onArchive,
  onStatus,
  onViewProject,
}: {
  c: ClientRow;
  nowMs: number;
  /** `undefined` while it is being read — the panel says so. */
  activity: ClientMoment[] | undefined;
  onEdit: () => void;
  onConversation: () => void;
  onRelated: (tab: RelatedTab) => void;
  onFullRecord: () => void;
  onArchive: () => void;
  onStatus: (s: 'prospect' | 'onboarding' | 'active' | 'dormant') => void;
  onViewProject: () => void;
}) {
  const [allActivity, setAllActivity] = React.useState(false);
  const value = valueOf(c);
  const why = attention(c, nowMs);
  const hasLead = Boolean(c.primaryLeadId);

  return (
    <aside
      className="flex min-w-0 flex-col rounded-[0.6rem] border px-[1rem] pb-[1rem] pt-[1rem]"
      style={{ borderColor: cv('line'), background: cv('surface') }}
    >
      {/* ── Who, and what you can do — one row ─────────────────────────── */}
      <div className="flex items-start gap-3">
        <Avatar id={c.id} name={c.name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h2 className="min-w-0 truncate text-[1.07rem] font-bold leading-tight" style={{ color: cv('ink') }}>
              {c.name}
            </h2>
            <StatusChip c={c} nowMs={nowMs} />
          </div>
          <p className="mt-0.5 truncate text-[0.82rem]" style={{ color: cv('soft') }}>
            {[c.company ?? c.primaryProjectName, c.city].filter(Boolean).join(' · ') || '—'}
          </p>
          <p className="text-[0.83rem]" style={{ color: cv('soft') }}>
            {refLabel(c.refNo)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-[0.45rem]">
          <Square label={c.phoneE164 ? `Call ${phoneLabel(c.phoneE164)}` : 'No phone number on file'} href={c.phoneE164 ? `tel:${c.phoneE164}` : null}>
            <Phone className="size-[1.15rem]" style={{ color: cv('brand-ink') }} aria-hidden="true" />
          </Square>
          <Square label={hasLead ? 'Open the WhatsApp conversation' : 'No conversation yet'} onClick={hasLead ? onConversation : undefined}>
            <span style={{ color: cv('wa') }}>
              <WhatsAppMark className="size-[1.2rem]" />
            </span>
          </Square>
          <Square label={c.email ? `Email ${c.email}` : 'No email on file'} href={c.email ? `mailto:${c.email}` : null}>
            <Mail className="size-[1.15rem]" style={{ color: cv('brand-ink') }} aria-hidden="true" />
          </Square>
          <Kebab
            label={`More for ${c.name}`}
            items={[
              ...(c.status !== 'active' ? [{ label: 'Mark active', onSelect: () => onStatus('active') }] : []),
              ...(c.status !== 'onboarding' ? [{ label: 'Mark onboarding', onSelect: () => onStatus('onboarding') }] : []),
              ...(c.status !== 'prospect' ? [{ label: 'Mark prospect', onSelect: () => onStatus('prospect') }] : []),
              ...(c.status !== 'dormant' ? [{ label: 'Mark dormant', onSelect: () => onStatus('dormant') }] : []),
              { label: c.archivedAt ? 'Restore from archive' : 'Archive client', onSelect: onArchive, danger: !c.archivedAt },
            ]}
          />
          <button type="button" onClick={onEdit} className={`${OUTLINE} h-[2.4rem] px-[1.05rem] text-[0.9rem]`} style={outlineStyle}>
            Edit
          </button>
        </div>
      </div>

      {/* ── How to reach them — four across ─────────────────────────────── */}
      <dl className="mt-[0.85rem] grid grid-cols-[1.3fr_1.5fr_1.1fr_1.1fr] rounded-[0.55rem] py-[0.7rem]" style={{ background: cv('strip') }}>
        <Fact label="Phone" first>
          <span className="truncate text-[0.84rem]" style={{ color: cv('ink') }}>
            {phoneLabel(c.phoneE164)}
          </span>
        </Fact>
        <Fact label="Email">
          <span className="truncate text-[0.72rem]" style={{ color: cv('soft') }} title={c.email ?? undefined}>
            {c.email ?? '—'}
          </span>
        </Fact>
        <Fact label="Assigned to">
          {c.ownerId && c.ownerName ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <Avatar id={c.ownerId} name={c.ownerName} size="xs" owner />
              <span className="truncate text-[0.88rem]" style={{ color: cv('ink') }}>
                {c.ownerName}
              </span>
            </span>
          ) : (
            <span className="text-[0.88rem]" style={{ color: cv('mute') }}>
              Nobody yet
            </span>
          )}
        </Fact>
        <Fact label="Preferred channel">
          <span className="flex min-w-0 items-center gap-1.5 text-[0.88rem]" style={{ color: cv('ink') }}>
            {c.preferredChannel === 'whatsapp' && (
              <span style={{ color: cv('wa') }}>
                <WhatsAppMark className="size-[1.15rem]" />
              </span>
            )}
            {c.preferredChannel === 'call' && <Phone className="size-4" style={{ color: cv('phone') }} aria-hidden="true" />}
            {c.preferredChannel === 'email' && <Mail className="size-4" style={{ color: cv('blue-strong') }} aria-hidden="true" />}
            <span className="truncate">{c.preferredChannel ? CHANNEL_LABEL[c.preferredChannel] : 'No preference'}</span>
          </span>
        </Fact>
      </dl>

      {why && (
        <p className="mt-[0.6rem] rounded-[0.45rem] px-3 py-[0.4rem] text-[0.8rem] font-medium" style={{ background: cv('amber-bg'), color: cv('amber') }}>
          Needs attention — {why.text}
        </p>
      )}

      {/* ── Relationship overview — four across ─────────────────────────── */}
      <Block title="Relationship overview">
        <div className="grid grid-cols-4 gap-[0.35rem]">
          <Metric
            icon={Coins}
            tone="green"
            label={value.kind === 'quoted' ? 'Quoted value' : 'Total value'}
            value={value.kind === 'none' ? '—' : money(value.amount)}
          />
          <Metric icon={FileText} tone="blue" label="Open deals" value={String(c.openDeals)} valueTone="blue" />
          <Metric
            icon={CalendarDays}
            tone="amber"
            label="Last contacted"
            value={c.lastContactAt ? shortDay(c.lastContactAt) : 'Never'}
            valueTone="brand"
          />
          <Metric icon={CalendarDays} tone="red" label="Next follow-up" value={c.nextAt ? shortDay(c.nextAt) : '—'} />
        </div>
      </Block>

      {/* ── Linked project ──────────────────────────────────────────────── */}
      <Block title={c.projectNames.length > 1 ? `Linked projects · ${c.projectNames.length}` : 'Linked project'}>
        <div className="flex items-center gap-3 rounded-[0.55rem] border px-[0.75rem] py-[0.55rem]" style={{ borderColor: cv('line') }}>
          <IconTile icon={Building2} bg={cv('tile')} ink={cv('tile-ink')} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.86rem] font-medium" style={{ color: cv('ink') }}>
              {c.primaryProjectName ?? 'No project'}
            </span>
            <span className="block truncate text-[0.8rem]" style={{ color: cv('soft') }}>
              {c.projectNames.length > 1 ? `Also ${c.projectNames.filter((p) => p !== c.primaryProjectName).join(', ')}` : (c.city ?? '—')}
            </span>
          </span>
          {c.primaryProjectId && (
            <button
              type="button"
              onClick={onViewProject}
              className="inline-flex shrink-0 items-center gap-1.5 text-[0.84rem] font-medium underline underline-offset-2"
              style={{ color: cv('brand-ink') }}
            >
              View project <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </Block>

      {/* ── Related records ─────────────────────────────────────────────── */}
      <Block title="Related records" action={hasLead ? { label: 'View all', onClick: () => onRelated('quotations') } : undefined}>
        <div className="grid grid-cols-2 gap-[0.76rem] gap-y-[0.55rem]">
          <Related icon={Home} label="Properties" n={c.properties} onClick={hasLead ? () => onRelated('properties') : undefined} />
          <Related icon={FileText} label="Quotations" n={c.quotations} onClick={hasLead ? () => onRelated('quotations') : undefined} />
          <Related icon={CalendarDays} label="Appointments" n={c.appointments} onClick={hasLead ? () => onRelated('appointments') : undefined} />
          <Related icon={KeyRound} label="Bookings" n={c.bookings} onClick={hasLead ? () => onRelated('bookings') : undefined} />
          <Related
            icon={Receipt}
            label="Invoices"
            n={c.invoices}
            badge={c.unpaidInvoices ? `${c.unpaidInvoices} unpaid` : undefined}
            onClick={hasLead ? () => onRelated('invoices') : undefined}
          />
        </div>
      </Block>

      {/* ── Recent activity ─────────────────────────────────────────────── */}
      <Block
        title="Recent activity"
        action={activity && activity.length > 2 ? { label: allActivity ? 'Show less' : 'View all', onClick: () => setAllActivity((v) => !v) } : undefined}
      >
        {activity === undefined ? (
          <p className="flex items-center gap-2 rounded-[0.55rem] border px-3 py-[0.8rem] text-[0.8rem]" style={{ borderColor: cv('line'), color: cv('soft') }}>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Reading what happened with {c.name.split(' ')[0]}…
          </p>
        ) : activity.length === 0 ? (
          <p className="rounded-[0.55rem] border px-3 py-[0.8rem] text-[0.8rem]" style={{ borderColor: cv('line'), color: cv('soft') }}>
            Nothing has happened with this client yet.
          </p>
        ) : (
          <ul className="rounded-[0.55rem] border px-[0.75rem]" style={{ borderColor: cv('line') }}>
            {(allActivity ? activity : activity.slice(0, 2)).map((m, i) => (
              <li
                key={`${m.at}-${i}`}
                className="flex items-center gap-3 py-[0.5rem]"
                style={i > 0 ? { borderTop: `1px solid ${cv('grid')}` } : undefined}
              >
                <MomentIcon kind={m.kind} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.84rem] font-medium" style={{ color: cv('ink') }}>
                    {m.title}
                  </span>
                  {m.detail && (
                    <span className="block truncate text-[0.76rem]" style={{ color: cv('soft') }}>
                      {m.detail}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[0.76rem]" style={{ color: cv('soft') }}>
                  {shortDay(m.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {/* ── What a person can do next ───────────────────────────────────── */}
      <div className="mt-auto grid grid-cols-2 gap-[0.7rem] pt-[1rem]">
        <button
          type="button"
          disabled={!hasLead}
          onClick={() => onRelated('quotations')}
          className={`${OUTLINE} h-[2.4rem] text-[0.9rem]`}
          style={outlineStyle}
        >
          <ExternalLink className="size-[1.1rem]" style={{ color: cv('brand-ink') }} aria-hidden="true" /> Open related items
        </button>
        <button type="button" disabled={!hasLead} onClick={onFullRecord} className={`${SOLID} h-[2.4rem] text-[0.9rem]`} style={solidStyle}>
          View full record <ArrowRight className="size-[1.1rem]" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}

function Fact({ label, first = false, children }: { label: string; first?: boolean; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-[0.7rem]" style={first ? undefined : { borderLeft: `1px solid ${cv('line')}` }}>
      <dt className="truncate text-[0.65rem]" style={{ color: cv('soft') }}>
        {label}
      </dt>
      <dd className="mt-[0.3rem] flex min-w-0">{children}</dd>
    </div>
  );
}

function Block({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <section className="pt-[0.85rem]">
      <div className="mb-[0.45rem] flex items-center gap-2">
        <h3 className="flex-1 text-[0.86rem] font-semibold" style={{ color: cv('ink') }}>
          {title}
        </h3>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="inline-flex items-center gap-1.5 text-[0.84rem] font-medium underline underline-offset-2"
            style={{ color: cv('brand-ink') }}
          >
            {action.label} <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Metric({
  icon,
  tone,
  label,
  value,
  valueTone,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  tone: 'green' | 'blue' | 'amber' | 'red';
  label: string;
  value: string;
  valueTone?: 'blue' | 'brand';
}) {
  return (
    <div className="flex min-w-0 items-center gap-[0.45rem] rounded-[0.55rem] border px-[0.45rem] py-[0.5rem]" style={{ borderColor: cv('line') }}>
      <IconTile icon={icon} bg={cv(`${tone}-soft`)} ink={cv(`${tone}-strong`)} size="metric" />
      <span className="min-w-0">
        <span className="block truncate text-[0.64rem]" style={{ color: cv('soft') }}>
          {label}
        </span>
        <span
          className="block truncate text-[1rem] font-bold leading-tight"
          style={{ color: valueTone === 'blue' ? cv('blue-strong') : valueTone === 'brand' ? cv('brand-ink') : cv('ink') }}
        >
          {value}
        </span>
      </span>
    </div>
  );
}

function Related({
  icon,
  label,
  n,
  badge,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  n: number;
  badge?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className="flex min-w-0 items-center gap-[0.7rem] rounded-[0.55rem] border px-[0.55rem] py-[0.4rem] text-left transition-colors hover:bg-[var(--cl-head)] disabled:cursor-default disabled:hover:bg-transparent"
      style={{ borderColor: cv('line') }}
    >
      <IconTile icon={icon} bg={cv('tile')} ink={cv('tile-ink')} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.84rem] leading-tight" style={{ color: cv('ink') }}>
          {label}
        </span>
        <span className="block text-[0.8rem] leading-tight" style={{ color: cv('ink') }}>
          {n}
        </span>
      </span>
      {badge && (
        <span className="shrink-0 rounded-full px-2.5 py-[0.15rem] text-[0.74rem]" style={{ background: cv('red-bg'), color: cv('red') }}>
          {badge}
        </span>
      )}
      <ChevronRight className="size-[1.1rem] shrink-0" style={{ color: cv('soft') }} aria-hidden="true" />
    </button>
  );
}

/* The design's two: a green document for a quotation, the WhatsApp mark for a
   conversation — and a colour of its own for everything else it can say. */
function MomentIcon({ kind }: { kind: string }) {
  if (kind === 'conversation' || kind === 'whatsapp_sent') {
    return (
      <span className="grid size-[2.2rem] shrink-0 place-items-center rounded-[0.45rem]" style={{ background: cv('green-soft') }}>
        <span style={{ color: cv('wa') }}>
          <WhatsAppMark className="size-[1.25rem]" />
        </span>
      </span>
    );
  }
  if (kind === 'quotation' || kind === 'won') return <IconTile icon={FileText} bg={cv('green-soft')} ink={cv('green-strong')} />;
  if (kind === 'invoice') return <IconTile icon={Receipt} bg={cv('amber-soft')} ink={cv('amber-strong')} />;
  if (kind === 'booking') return <IconTile icon={KeyRound} bg={cv('blue-soft')} ink={cv('blue-strong')} />;
  if (kind.startsWith('call')) return <IconTile icon={Phone} bg={cv('green-soft')} ink={cv('phone')} />;
  return <IconTile icon={MessageSquare} bg={cv('tile')} ink={cv('tile-ink')} />;
}
