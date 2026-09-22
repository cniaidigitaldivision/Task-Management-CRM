'use client';

import * as React from 'react';
import {
  ArrowRight,
  Building2,
  CalendarClock,
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

import { ink, RowMenu, tint } from '@/components/crm/appointments-board-parts';
import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import type { ClientMoment, ClientRow } from '@/lib/db/queries/crm-client-board';
import {
  attention,
  avatarTone,
  CHANNEL_LABEL,
  displayStatus,
  initials,
  money,
  nextLine,
  phoneLabel,
  refLabel,
  shortDay,
  STATUS_LOOK,
  valueOf,
  type Tone,
} from '@/lib/domain/crm-client-board';
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
 * only WhatsApp and email go to Conversations, which the owner said is fine.
 * ========================================================================= */

/** The shared tokens have no violet; onboarding borrows the gold one. */
export const T = (t: Tone) => (t === 'violet' ? 'gold' : t) as 'green' | 'amber' | 'blue' | 'red' | 'grey' | 'gold';

export function Avatar({ id, name, size = 'md' }: { id: string; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const tone = T(avatarTone(id));
  const cls = size === 'lg' ? 'size-14 text-[1.15rem]' : size === 'sm' ? 'size-7 text-[0.7rem]' : 'size-10 text-body-sm';
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-bold ${cls}`}
      style={{ background: tint(tone, 18), color: ink(tone) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function StatusChip({ c, nowMs }: { c: ClientRow; nowMs: number }) {
  const look = STATUS_LOOK[displayStatus(c, nowMs)];
  const tone = T(look.tone);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold leading-tight"
      style={{ background: tint(tone, 14), color: ink(tone) }}
    >
      <span className="size-1.5 rounded-full" style={{ background: ink(tone) }} aria-hidden="true" />
      {look.label}
    </span>
  );
}

function IconButton({
  label,
  onClick,
  href,
  children,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  children: React.ReactNode;
}) {
  const cls =
    'grid size-9 shrink-0 place-items-center rounded-xl border border-border-default text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary';
  return href ? (
    <a href={href} aria-label={label} title={label} className={cls}>
      {children}
    </a>
  ) : (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cls}>
      {children}
    </button>
  );
}

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
  const next = nextLine(c, nowMs);
  const why = attention(c, nowMs);
  const hasLead = Boolean(c.primaryLeadId);

  return (
    <aside className="flex min-w-0 flex-col rounded-2xl border border-border-subtle bg-bg-surface shadow-sm">
      {/* ── Who ─────────────────────────────────────────────────────────── */}
      {/* ⚠️ WHO FIRST, THEN WHAT YOU CAN DO. With the five buttons on the name's
          row the name was squeezed to "Demo — Product Enquir…" (measured at
          1512px); on their own row everything reads in full. */}
      <div className="flex items-start gap-3 px-5 pt-5">
        <Avatar id={c.id} name={c.name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 break-words text-[1.3rem] font-bold leading-tight text-text-primary">{c.name}</h2>
            <StatusChip c={c} nowMs={nowMs} />
          </div>
          <p className="text-body-sm text-text-secondary">
            {[c.company, c.primaryProjectName, c.city].filter(Boolean).join(' · ') || '—'}
          </p>
          <p className="text-caption text-text-tertiary">{refLabel(c.refNo)}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5 px-5 pt-3">
        <div className="flex shrink-0 items-center gap-1.5">
          {c.phoneE164 && (
            <IconButton label={`Call ${phoneLabel(c.phoneE164)}`} href={`tel:${c.phoneE164}`}>
              <Phone className="size-4" aria-hidden="true" />
            </IconButton>
          )}
          {hasLead && (
            <IconButton label="Open the WhatsApp conversation" onClick={onConversation}>
              <span style={{ color: WA_GREEN }}>
                <WhatsAppMark className="size-4" />
              </span>
            </IconButton>
          )}
          {c.email && (
            <IconButton label={`Email ${c.email}`} href={`mailto:${c.email}`}>
              <Mail className="size-4" aria-hidden="true" />
            </IconButton>
          )}
          <RowMenu
            label={`More for ${c.name}`}
            items={[
              ...(c.status !== 'active' ? [{ label: 'Mark active', onSelect: () => onStatus('active') }] : []),
              ...(c.status !== 'onboarding' ? [{ label: 'Mark onboarding', onSelect: () => onStatus('onboarding') }] : []),
              ...(c.status !== 'prospect' ? [{ label: 'Mark prospect', onSelect: () => onStatus('prospect') }] : []),
              ...(c.status !== 'dormant' ? [{ label: 'Mark dormant', onSelect: () => onStatus('dormant') }] : []),
              { label: c.archivedAt ? 'Restore from archive' : 'Archive client', onSelect: onArchive, danger: !c.archivedAt },
            ]}
          />
          <button
            type="button"
            onClick={onEdit}
            className="rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
          >
            Edit
          </button>
        </div>
      </div>

      {/* ── How to reach them ───────────────────────────────────────────── */}
      <dl className="mx-5 mt-3 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-bg-subtle/60 px-3.5 py-3">
        <Fact label="Phone" value={phoneLabel(c.phoneE164)} />
        <Fact label="Email" value={c.email ?? '—'} />
        <div className="min-w-0">
          <dt className="text-caption text-text-secondary">Assigned to</dt>
          <dd className="mt-0.5 flex min-w-0 items-center gap-1.5">
            {c.ownerId && c.ownerName ? (
              <>
                <Avatar id={c.ownerId} name={c.ownerName} size="sm" />
                <span className="truncate text-body-sm font-medium text-text-primary">{c.ownerName}</span>
              </>
            ) : (
              <span className="text-body-sm text-text-tertiary">Nobody yet</span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption text-text-secondary">Preferred channel</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 text-body-sm font-medium text-text-primary">
            {c.preferredChannel === 'whatsapp' && (
              <span style={{ color: WA_GREEN }}>
                <WhatsAppMark className="size-4" />
              </span>
            )}
            {c.preferredChannel === 'call' && <Phone className="size-4 text-text-secondary" aria-hidden="true" />}
            {c.preferredChannel === 'email' && <Mail className="size-4 text-text-secondary" aria-hidden="true" />}
            {c.preferredChannel ? CHANNEL_LABEL[c.preferredChannel] : 'No preference'}
          </dd>
        </div>
      </dl>

      {why && (
        <p className="mx-5 mt-3 rounded-xl px-3 py-2 text-caption font-semibold" style={{ background: tint('amber', 12), color: ink('amber') }}>
          Needs attention — {why.text}
        </p>
      )}

      {/* ── Relationship overview ───────────────────────────────────────── */}
      <Block title="Relationship overview">
        <div className="grid grid-cols-2 gap-2">
          <Metric
            icon={Coins}
            tone="green"
            label={value.kind === 'quoted' ? 'Quoted value' : 'Total value'}
            value={value.kind === 'none' ? '—' : money(value.amount)}
          />
          <Metric icon={FileText} tone="blue" label="Open deals" value={String(c.openDeals)} />
          <Metric icon={CalendarDays} tone="amber" label="Last contacted" value={c.lastContactAt ? shortDay(c.lastContactAt) : 'Never'} />
          <Metric
            icon={CalendarClock}
            tone="red"
            label="Next follow-up"
            value={c.nextAt ? shortDay(c.nextAt) : '—'}
            hint={c.nextAt ? next.text : undefined}
          />
        </div>
      </Block>

      {/* ── Linked project ──────────────────────────────────────────────── */}
      <Block title={c.projectNames.length > 1 ? `Linked projects · ${c.projectNames.length}` : 'Linked project'}>
        <div className="flex items-center gap-3 rounded-xl border border-border-subtle px-3.5 py-3">
          <Building2 className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body-sm font-semibold text-text-primary">{c.primaryProjectName ?? 'No project'}</span>
            <span className="block truncate text-caption text-text-secondary">
              {c.projectNames.length > 1 ? `Also ${c.projectNames.filter((p) => p !== c.primaryProjectName).join(', ')}` : c.city ?? '—'}
            </span>
          </span>
          {c.primaryProjectId && (
            <button type="button" onClick={onViewProject} className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold text-text-brand hover:underline">
              View project <ArrowRight className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </Block>

      {/* ── Related records ─────────────────────────────────────────────── */}
      <Block
        title="Related records"
        action={hasLead ? { label: 'View all', onClick: () => onRelated('quotations') } : undefined}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Related icon={Home} label="Properties" n={c.properties} onClick={hasLead ? () => onRelated('properties') : undefined} />
          <Related icon={FileText} label="Quotations" n={c.quotations} onClick={hasLead ? () => onRelated('quotations') : undefined} />
          <Related icon={CalendarDays} label="Appointments" n={c.appointments} onClick={hasLead ? () => onRelated('appointments') : undefined} />
          <Related icon={KeyRound} label="Bookings" n={c.bookings} onClick={hasLead ? () => onRelated('bookings') : undefined} />
          <Related
            icon={Receipt}
            label="Invoices"
            n={c.invoices}
            badge={c.unpaidInvoices ? `${c.unpaidInvoices} unpaid` : undefined}
            badgeTone={c.overdueInvoices ? 'red' : 'amber'}
            onClick={hasLead ? () => onRelated('invoices') : undefined}
          />
        </div>
      </Block>

      {/* ── Recent activity ─────────────────────────────────────────────── */}
      <Block
        title="Recent activity"
        action={activity && activity.length > 3 ? { label: allActivity ? 'Show less' : 'View all', onClick: () => setAllActivity((v) => !v) } : undefined}
      >
        {activity === undefined ? (
          <p className="flex items-center gap-2 px-1 py-2 text-caption text-text-secondary">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Reading what happened with {c.name.split(' ')[0]}…
          </p>
        ) : activity.length === 0 ? (
          <p className="px-1 py-2 text-caption text-text-secondary">Nothing has happened with this client yet.</p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
            {(allActivity ? activity : activity.slice(0, 3)).map((m, i) => (
              <li key={`${m.at}-${i}`} className="flex items-start gap-3 px-3.5 py-2.5">
                <MomentIcon kind={m.kind} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-medium text-text-primary">{m.title}</span>
                  {m.detail && <span className="block truncate text-caption text-text-secondary">{m.detail}</span>}
                </span>
                <span className="shrink-0 text-caption text-text-secondary">{shortDay(m.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {/* ── What a person can do next ───────────────────────────────────── */}
      <div className="mt-auto grid grid-cols-2 gap-2 px-5 pb-5 pt-4">
        <button
          type="button"
          disabled={!hasLead}
          onClick={() => onRelated('quotations')}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border-default px-3 py-2.5 text-body-sm font-semibold text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-40"
        >
          <ExternalLink className="size-4" aria-hidden="true" /> Open related items
        </button>
        <button
          type="button"
          disabled={!hasLead}
          onClick={onFullRecord}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent-primary px-3 py-2.5 text-body-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          View full record <ArrowRight className="size-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-text-secondary">{label}</dt>
      <dd className="mt-0.5 break-all text-body-sm font-medium text-text-primary" title={value}>
        {value}
      </dd>
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
    <section className="px-5 pt-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="flex-1 text-body-sm font-semibold text-text-primary">{title}</h3>
        {action && (
          <button type="button" onClick={action.onClick} className="inline-flex items-center gap-1 text-caption font-semibold text-text-brand hover:underline">
            {action.label} <ArrowRight className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Metric({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  tone: 'green' | 'blue' | 'amber' | 'red';
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border-subtle px-3 py-2.5" title={hint}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: tint(tone, 14) }}>
        <Icon className="size-4" style={{ color: ink(tone) }} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-caption text-text-secondary">{label}</span>
        <span className="block truncate text-body font-bold text-text-primary">{value}</span>
      </span>
    </div>
  );
}

function Related({
  icon: Icon,
  label,
  n,
  badge,
  badgeTone = 'amber',
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  n: number;
  badge?: string;
  badgeTone?: 'amber' | 'red';
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className="flex min-w-0 items-center gap-3 rounded-xl border border-border-subtle px-3.5 py-2.5 text-left transition-colors hover:bg-bg-subtle disabled:cursor-default disabled:hover:bg-transparent"
    >
      <Icon className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-medium text-text-primary">{label}</span>
        <span className="block text-caption text-text-secondary">{n}</span>
      </span>
      {badge && (
        <span className="shrink-0 rounded-full px-2 py-0.5 text-caption font-semibold" style={{ background: tint(badgeTone, 14), color: ink(badgeTone) }}>
          {badge}
        </span>
      )}
      {onClick && <ChevronRight className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />}
    </button>
  );
}

function MomentIcon({ kind }: { kind: string }) {
  const isChat = kind === 'conversation' || kind === 'whatsapp_sent';
  const tone = kind === 'quotation' || kind === 'won' ? 'green' : kind === 'invoice' ? 'amber' : kind === 'booking' ? 'blue' : 'grey';
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: isChat ? tint('green', 12) : tint(tone, 14) }}>
      {isChat ? (
        <span style={{ color: WA_GREEN }}>
          <WhatsAppMark className="size-4" />
        </span>
      ) : kind === 'quotation' ? (
        <FileText className="size-4" style={{ color: ink('green') }} aria-hidden="true" />
      ) : kind === 'invoice' ? (
        <Receipt className="size-4" style={{ color: ink('amber') }} aria-hidden="true" />
      ) : kind === 'booking' ? (
        <KeyRound className="size-4" style={{ color: ink('blue') }} aria-hidden="true" />
      ) : kind.startsWith('call') ? (
        <Phone className="size-4 text-text-secondary" aria-hidden="true" />
      ) : (
        <MessageSquare className="size-4 text-text-secondary" aria-hidden="true" />
      )}
    </span>
  );
}
