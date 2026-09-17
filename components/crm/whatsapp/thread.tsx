'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  Ban,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  Forward,
  Info,
  Pin,
  PinOff,
  Plus,
  Reply,
  Smile,
  SmilePlus,
  Sparkles,
  Star,
  StarOff,
  Trash2,
  X,
} from 'lucide-react';

import type { CrmMessage } from '@/lib/db/queries/crm-leads';
import { cn } from '@/lib/utils';
import { EMOJI_FONT, QUICK_REACTIONS } from './emoji-picker';
import { MessageMedia, type LocalMedia } from './media';
import { dayKey, dayLabel, mediaShape, mediaUrl, snippet, timeOf } from './shared';

/* ============================================================================
 * THE WHATSAPP CHAT — bubbles, and everything a bubble's arrow opens
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17: *"when there is an arrow sign displaying on every message,
 * when I click on it, they are showing expressions — emojis — plus message info,
 * reply, copy, react, forward, pin or ask Meta AI, star or delete."*
 *
 * ⚠️ WHAT EACH ONE REALLY DOES, because some are WhatsApp's and some cannot be:
 *   · React, Reply        → WhatsApp's own; the client sees them on the phone
 *   · Forward             → re-sent to another lead through WhatsApp
 *   · Copy, Download      → this browser
 *   · Pin                 → the CRM's, for everybody on the lead (no API exists)
 *   · Star                → the CRM's, yours alone (no API exists)
 *   · Ask AI              → the CRM's AI drafts a reply (Meta AI has no API)
 *   · Delete              → for you only — WhatsApp cannot unsend for a business
 * ========================================================================= */

export interface ThreadHandlers {
  readonly onReply: (m: CrmMessage) => void;
  readonly onReact: (m: CrmMessage, emoji: string | null) => void;
  readonly onMoreReactions: (m: CrmMessage) => void;
  readonly onForward: (m: CrmMessage) => void;
  readonly onPin: (m: CrmMessage, pinned: boolean) => void;
  readonly onStar: (m: CrmMessage, starred: boolean) => void;
  readonly onDelete: (m: CrmMessage) => void;
  readonly onInfo: (m: CrmMessage) => void;
  readonly onAskAI: (m: CrmMessage) => void;
  readonly onCopy: (m: CrmMessage) => void;
  readonly onOpenMedia: (kind: 'image' | 'video', src: string, m: CrmMessage) => void;
  readonly onJumpTo: (m: CrmMessage) => void;
}

const REACT_WINDOW_MS = 30 * 86_400_000;

export function WhatsAppThread({
  messages,
  leadName,
  viewerName,
  locals,
  flashId,
  nowMs,
  handlers,
}: {
  messages: readonly CrmMessage[];
  leadName: string;
  viewerName: string;
  locals: Readonly<Record<string, LocalMedia>>;
  flashId: string | null;
  nowMs: number;
  handlers: ThreadHandlers;
}) {
  const byWamid = React.useMemo(() => {
    const map = new Map<string, CrmMessage>();
    for (const m of messages) if (m.waMessageId) map.set(m.waMessageId, m);
    return map;
  }, [messages]);

  const days = React.useMemo(() => {
    const out: Array<{ key: string; label: string; items: CrmMessage[] }> = [];
    for (const m of messages) {
      const key = dayKey(m.occurredAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(m);
      else out.push({ key, label: dayLabel(m.occurredAt, nowMs), items: [m] });
    }
    return out;
  }, [messages, nowMs]);

  return (
    /* `mt-auto`: a short chat sits at the foot, above the reply box, as in the app. */
    <div className="mt-auto flex flex-col px-[5%] pb-3 pt-1">
      {days.map((day) => (
        <section key={day.key} aria-label={day.label}>
          {/* ⚠️ STICKY WITHIN ITS OWN DAY, so the next day's pill pushes it away. */}
          <div className="sticky top-2 z-10 flex justify-center py-2">
            <span
              className="rounded-lg px-3 py-1 text-[12.5px] leading-4"
              style={{ background: 'var(--wa-date-pill)', color: 'var(--wa-date-ink)', boxShadow: '0 1px 0.5px var(--wa-shadow)' }}
            >
              {day.label}
            </span>
          </div>
          <ol className="flex flex-col">
            {day.items.map((m, i) => (
              <Bubble
                key={m.id}
                message={m}
                first={i === 0 || day.items[i - 1].direction !== m.direction}
                quoted={m.replyToWamid ? (byWamid.get(m.replyToWamid) ?? null) : null}
                leadName={leadName}
                viewerName={viewerName}
                local={locals[m.id]}
                flash={flashId === m.id}
                nowMs={nowMs}
                handlers={handlers}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/* ── One bubble ───────────────────────────────────────────────────────────── */

function Bubble({
  message,
  first,
  quoted,
  leadName,
  viewerName,
  local,
  flash,
  nowMs,
  handlers,
}: {
  message: CrmMessage;
  first: boolean;
  quoted: CrmMessage | null;
  leadName: string;
  viewerName: string;
  local: LocalMedia | undefined;
  flash: boolean;
  nowMs: number;
  handlers: ThreadHandlers;
}) {
  const mine = message.direction === 'outbound';
  const fill = mine ? 'var(--wa-bubble-out)' : 'var(--wa-bubble-in)';
  const hidden = Boolean(message.hiddenAt);
  const pending = message.id.startsWith('pending-');
  const shape = mediaShape(message);
  const media = shape !== 'none';
  const bareMedia = media && (shape === 'image' || shape === 'video' || shape === 'sticker') && !message.body;
  const [menu, setMenu] = React.useState<null | 'menu' | 'react'>(null);
  const li = React.useRef<HTMLLIElement>(null);
  const bubble = React.useRef<HTMLDivElement>(null);

  const canReact = !hidden && !pending && Boolean(message.waMessageId) && nowMs - Date.parse(message.occurredAt) < REACT_WINDOW_MS;

  const open = (which: 'menu' | 'react') => setMenu(which);

  const reactions = [
    message.theirReaction ? { emoji: message.theirReaction, who: leadName } : null,
    message.ourReaction ? { emoji: message.ourReaction, who: 'You' } : null,
  ].filter(Boolean) as Array<{ emoji: string; who: string }>;

  return (
    <li
      ref={li}
      data-message-id={message.id}
      className={cn(
        'group relative flex flex-col',
        mine ? 'items-end' : 'items-start',
        first ? 'mt-2.5' : 'mt-0.5',
        reactions.length > 0 && 'mb-3.5',
      )}
    >
      <div className={cn('flex max-w-[82%] items-center gap-1.5', mine && 'flex-row-reverse')}>
        <div
          ref={bubble}
          className={cn(
            'relative min-w-0 rounded-lg transition-shadow duration-500',
            first && (mine ? 'rounded-tr-none' : 'rounded-tl-none'),
            bareMedia ? 'p-[3px]' : media ? 'px-[3px] pb-2 pt-[3px]' : 'pb-2 pl-2.5 pr-2 pt-1.5',
          )}
          style={{
            background: fill,
            color: 'var(--wa-ink)',
            boxShadow: flash ? '0 0 0 3px color-mix(in oklab, #00a884 55%, transparent)' : '0 1px 0.5px var(--wa-shadow)',
          }}
          title={mine && message.sentByName ? `Sent by ${message.sentByName}` : undefined}
        >
          {first && (
            <svg aria-hidden="true" viewBox="0 1 8 12" width="8" height="12" className={cn('absolute top-0', mine ? '-right-2' : '-left-2')}>
              <path
                fill={fill}
                d={mine ? 'M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z' : 'M1.533 3.568 8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z'}
              />
            </svg>
          )}

          {/* ⚠️ THE ARROW. Appears on hover, like WhatsApp Web — and stays while its menu is open. */}
          {!hidden && !pending && (
            <button
              type="button"
              aria-label="Message menu"
              aria-expanded={menu === 'menu'}
              onClick={() => (menu === 'menu' ? setMenu(null) : open('menu'))}
              className={cn(
                'absolute right-1 top-1 z-10 grid size-6 place-items-center rounded-full transition-opacity',
                menu === 'menu' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              )}
              style={{
                color: bareMedia ? '#fff' : 'var(--wa-meta)',
                background: bareMedia
                  ? 'radial-gradient(circle, rgba(0,0,0,.35) 40%, transparent 72%)'
                  : `radial-gradient(circle at 60% 40%, ${fill} 55%, transparent 75%)`,
              }}
            >
              <ChevronDown className="size-5" aria-hidden="true" />
            </button>
          )}

          {hidden ? (
            <p className="flex items-center gap-1.5 pr-14 text-[13.5px] italic leading-5" style={{ color: 'var(--wa-meta)' }}>
              <Ban className="size-4 shrink-0" aria-hidden="true" />
              {message.hiddenByName && message.hiddenByName === viewerName ? 'You' : (message.hiddenByName ?? 'Someone')} deleted this message
            </p>
          ) : (
            <>
              {message.forwarded && (
                <p className={cn('mb-0.5 flex items-center gap-1 text-[12px] italic', media && 'px-1.5 pt-1')} style={{ color: 'var(--wa-meta)' }}>
                  <Forward className="size-3.5" aria-hidden="true" /> Forwarded
                </p>
              )}

              {message.replyToWamid && (
                <button
                  type="button"
                  onClick={() => quoted && handlers.onJumpTo(quoted)}
                  className={cn('mb-1 flex w-full min-w-[12rem] overflow-hidden rounded-md text-left', media && 'mb-1')}
                  style={{ background: 'color-mix(in oklab, var(--wa-ink) 6%, transparent)' }}
                >
                  <span className="w-1 shrink-0" style={{ background: quoted?.direction === 'outbound' ? '#06cf9c' : '#53bdeb' }} />
                  <span className="min-w-0 px-2 py-1.5">
                    <span className="block text-[12.5px] font-semibold" style={{ color: quoted?.direction === 'outbound' ? '#06cf9c' : '#53bdeb' }}>
                      {quoted ? (quoted.direction === 'outbound' ? 'You' : leadName) : 'Earlier message'}
                    </span>
                    <span className="line-clamp-2 text-[12.5px] leading-4" style={{ color: 'var(--wa-meta)' }}>
                      {quoted ? snippet(quoted) : 'Not in the loaded conversation'}
                    </span>
                  </span>
                </button>
              )}

              {media && (
                <div className="relative">
                  <MessageMedia message={message} local={local} mine={mine} onOpen={handlers.onOpenMedia} />
                  {bareMedia && (
                    <span className="absolute bottom-1.5 right-2 rounded-full bg-black/35 px-1.5">
                      <Stamp message={message} tone="light" />
                    </span>
                  )}
                </div>
              )}

              {message.body && (
                <p className={cn('whitespace-pre-wrap break-words text-[14.2px] leading-[19px]', media && 'px-1.5 pt-1.5')}>
                  {message.body}
                  {/* ⚠️ THE SPACER reserves the stamp's width at the end of the last
                      line, so the time never sits over the words. */}
                  <span aria-hidden="true" className={cn('inline-block h-px', mine ? 'w-[5.4rem]' : 'w-[4rem]')} />
                </p>
              )}
              {!message.body && !media && (
                <p className="text-[14.2px] italic leading-[19px]" style={{ color: 'var(--wa-meta)' }}>
                  {snippet(message)}
                  <span aria-hidden="true" className="inline-block h-px w-[5.4rem]" />
                </p>
              )}
            </>
          )}

          {!bareMedia && (
            <span className="absolute bottom-1 right-2">
              <Stamp message={message} tone="plain" />
            </span>
          )}
          {hidden && <span aria-hidden="true" className="inline-block h-px w-10" />}

          {reactions.length > 0 && (
            <span
              className={cn('absolute -bottom-3.5 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[13px] leading-none', mine ? 'right-2' : 'left-2')}
              style={{ background: 'var(--wa-date-pill)', boxShadow: '0 1px 2px var(--wa-shadow)', fontFamily: EMOJI_FONT }}
              title={reactions.map((r) => `${r.who}: ${r.emoji}`).join(' · ')}
            >
              {reactions.length === 2 && reactions[0].emoji === reactions[1].emoji ? (
                <>
                  {reactions[0].emoji}
                  <span className="ml-0.5 font-sans text-[11px]" style={{ color: 'var(--wa-meta)' }}>2</span>
                </>
              ) : (
                reactions.map((r) => <span key={r.who}>{r.emoji}</span>)
              )}
            </span>
          )}
        </div>

        {/* ⚠️ THE SMILEY BESIDE THE BUBBLE — one tap to a reaction, as on WhatsApp Web. */}
        {canReact && (
          <button
            type="button"
            aria-label="React"
            onClick={() => (menu === 'react' ? setMenu(null) : open('react'))}
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-full transition-opacity',
              menu === 'react' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            )}
            style={{ background: 'var(--wa-date-pill)', color: 'var(--wa-meta)', boxShadow: '0 1px 2px var(--wa-shadow)' }}
          >
            <Smile className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {message.status === 'failed' && (
        <p className="mt-0.5 max-w-[80%] text-[11.5px] text-feedback-error">
          Not delivered{message.errorDetail ? ` — ${message.errorDetail}` : ''}
        </p>
      )}

      {menu && (
        <Popover
          anchor={bubble}
          mine={mine}
          onClose={() => setMenu(null)}
        >
          <ReactionRow
            current={message.ourReaction}
            disabled={!canReact}
            onPick={(e) => {
              setMenu(null);
              handlers.onReact(message, e === message.ourReaction ? null : e);
            }}
            onMore={() => {
              setMenu(null);
              handlers.onMoreReactions(message);
            }}
          />
          {menu === 'menu' && (
            <MenuList
              message={message}
              mine={mine}
              canReact={canReact}
              media={media}
              close={() => setMenu(null)}
              handlers={handlers}
            />
          )}
        </Popover>
      )}
    </li>
  );
}

function Stamp({ message, tone }: { message: CrmMessage; tone: 'plain' | 'light' }) {
  const mine = message.direction === 'outbound';
  const pending = message.id.startsWith('pending-');
  return (
    <span className="flex items-center gap-[3px] text-[11px] leading-[15px]" style={{ color: tone === 'light' ? '#fff' : 'var(--wa-meta)' }}>
      {message.starred && <Star className="size-3" fill="currentColor" aria-label="Starred" />}
      {message.pinnedAt && <Pin className="size-3" aria-label="Pinned" />}
      <span className="tabular-nums">{timeOf(message.occurredAt)}</span>
      {mine && !message.hiddenAt && (
        pending || message.status === null ? (
          <Clock3 className="size-3.5" aria-label="Sending" />
        ) : message.status === 'read' ? (
          <CheckCheck className="size-4" style={{ color: 'var(--wa-tick-read)' }} aria-label="Read" />
        ) : message.status === 'delivered' ? (
          <CheckCheck className="size-4" aria-label="Delivered" />
        ) : message.status === 'failed' ? (
          <CircleAlert className="size-4 text-feedback-error" aria-label="Not delivered" />
        ) : (
          <Check className="size-4" aria-label="Sent" />
        )
      )}
    </span>
  );
}

/* ── The menu ─────────────────────────────────────────────────────────────── */

/**
 * The menu, floating over the whole page.
 *
 * ⚠️ NOT INSIDE THE CHAT'S SCROLL BOX. Placed inside it, a menu opened near the
 * bottom was cut off at the top — the reaction row, Reply and Copy simply were
 * not there (found in the running app, 2026-09-17). It is portalled to <body>
 * and positioned against the bubble, flipping above it when there is no room
 * below and clamped to the window.
 *
 * ⚠️ AND CORRECTED FOR THE PAGE ZOOM. `body` carries `zoom: 0.9` (tokens.css):
 * a rectangle is measured in on-screen pixels, but a `top` written into the
 * zoomed body is multiplied by 0.9 when drawn. So on-screen positions are divided
 * by the element's own `currentCSSZoom` before they are written.
 *
 * It closes on an outside click, Escape, or any scroll — a menu left hanging
 * where its message used to be is worse than one that closes.
 */
function Popover({
  anchor,
  mine,
  onClose,
  children,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  mine: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const a = anchor.current;
    const m = ref.current;
    if (!a || !m) return;
    const zoom = (m as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom || 1;
    const ar = a.getBoundingClientRect();
    const mr = m.getBoundingClientRect();
    const gap = 6 * zoom;
    let top = ar.bottom + gap;
    if (top + mr.height > window.innerHeight - 8) top = Math.max(8, ar.top - gap - mr.height);
    let left = mine ? ar.right - mr.width : ar.left;
    left = Math.max(8, Math.min(left, window.innerWidth - mr.width - 8));
    m.style.top = `${top / zoom}px`;
    m.style.left = `${left / zoom}px`;
    m.style.visibility = 'visible';
  }, [anchor, mine]);

  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('scroll', onScroll, true);
    }, 0);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="fixed left-0 top-0 z-[70] flex w-60 flex-col gap-1.5" style={{ visibility: 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}

function ReactionRow({
  current,
  disabled,
  onPick,
  onMore,
}: {
  current: string | null;
  disabled: boolean;
  onPick: (emoji: string) => void;
  onMore: () => void;
}) {
  if (disabled) return null;
  return (
    <div className="flex items-center justify-between rounded-full border border-border-subtle bg-bg-surface px-1.5 py-1 shadow-lg" style={{ fontFamily: EMOJI_FONT }}>
      {QUICK_REACTIONS.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onPick(e)}
          aria-label={`React ${e}`}
          aria-pressed={current === e}
          className={cn(
            'grid size-8 place-items-center rounded-full text-[21px] leading-none transition-transform hover:scale-125',
            current === e && 'bg-bg-subtle',
          )}
        >
          {e}
        </button>
      ))}
      <button type="button" onClick={onMore} aria-label="More reactions" className="grid size-8 place-items-center rounded-full bg-bg-subtle text-text-secondary hover:text-text-primary">
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function MenuList({
  message,
  mine,
  canReact,
  media,
  close,
  handlers,
}: {
  message: CrmMessage;
  mine: boolean;
  canReact: boolean;
  media: boolean;
  close: () => void;
  handlers: ThreadHandlers;
}) {
  const item = (label: string, Icon: React.ComponentType<{ className?: string }>, run: () => void, danger = false) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      onClick={() => {
        close();
        run();
      }}
      className={cn(
        'flex w-full items-center gap-3 px-3.5 py-2 text-left text-body-sm transition-colors hover:bg-bg-subtle',
        danger ? 'text-feedback-error' : 'text-text-primary',
      )}
    >
      <Icon className={cn('size-4 shrink-0', !danger && 'text-text-secondary')} />
      {label}
    </button>
  );
  const replyable = Boolean(message.waMessageId);

  return (
    <div role="menu" className="overflow-hidden rounded-xl border border-border-subtle bg-bg-surface py-1.5 shadow-xl">
      {mine && message.channel === 'whatsapp' && item('Message info', Info, () => handlers.onInfo(message))}
      {replyable && item('Reply', Reply, () => handlers.onReply(message))}
      {message.body && item('Copy', Copy, () => handlers.onCopy(message))}
      {canReact && item('React', SmilePlus, () => handlers.onMoreReactions(message))}
      {media && item('Download', Download, () => window.location.assign(mediaUrl(message.id, true)))}
      {item('Forward', Forward, () => handlers.onForward(message))}
      {item(message.pinnedAt ? 'Unpin' : 'Pin', message.pinnedAt ? PinOff : Pin, () => handlers.onPin(message, !message.pinnedAt))}
      {item(message.starred ? 'Unstar' : 'Star', message.starred ? StarOff : Star, () => handlers.onStar(message, !message.starred))}
      {!mine && item('Ask AI', Sparkles, () => handlers.onAskAI(message))}
      <div className="my-1 border-t border-border-subtle" />
      {item('Delete', Trash2, () => handlers.onDelete(message), true)}
    </div>
  );
}

/* ── Pinned messages ──────────────────────────────────────────────────────── */

export function PinnedBar({
  pinned,
  onJump,
  onUnpin,
}: {
  pinned: readonly CrmMessage[];
  onJump: (m: CrmMessage) => void;
  onUnpin: (m: CrmMessage) => void;
}) {
  const [index, setIndex] = React.useState(0);
  if (pinned.length === 0) return null;
  const at = Math.min(index, pinned.length - 1);
  const m = pinned[at];
  return (
    <div className="flex items-center gap-2 border-b border-border-subtle bg-bg-surface px-3 py-1.5">
      <button
        type="button"
        onClick={() => {
          onJump(m);
          setIndex((at + 1) % pinned.length);
        }}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        {pinned.length > 1 && (
          <span className="flex flex-col gap-0.5" aria-hidden="true">
            {pinned.map((p, i) => (
              <span key={p.id} className="h-1.5 w-[3px] rounded-full" style={{ background: i === at ? '#00a884' : 'var(--border-default)' }} />
            ))}
          </span>
        )}
        <Pin className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        <span className="min-w-0 truncate text-caption text-text-primary">{snippet(m)}</span>
        {pinned.length > 1 && <span className="shrink-0 text-micro text-text-secondary">{at + 1}/{pinned.length}</span>}
      </button>
      <button type="button" onClick={() => onUnpin(m)} aria-label="Unpin" className="grid size-7 place-items-center rounded-md text-text-secondary hover:bg-bg-subtle">
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
