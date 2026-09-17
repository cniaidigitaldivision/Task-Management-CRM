'use client';

import * as React from 'react';
import { Clock, Coffee, Flag, Heart, Lightbulb, Plane, Search, Smile, Trophy, Users, Leaf, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { EmojiGroup } from './emoji-data';

/* ============================================================================
 * EVERY EMOJI — the "+" beside the quick reactions, and the composer's smiley
 * ----------------------------------------------------------------------------
 * ⚠️ THE DATA LOADS ON FIRST OPEN, NOT WITH THE PAGE. 1,870 emoji and their
 * search words are ~150 KB; the drawer should not pay that to show a lead. And
 * it is warmed the moment the chat mounts (`preloadEmoji`), so the first open is
 * normally instant anyway.
 * ========================================================================= */

let cache: readonly EmojiGroup[] | null = null;
let loading: Promise<readonly EmojiGroup[]> | null = null;

export function preloadEmoji(): Promise<readonly EmojiGroup[]> {
  if (cache) return Promise.resolve(cache);
  loading ??= import('./emoji-data').then((m) => (cache = m.EMOJI_GROUPS));
  return loading;
}

const RECENT_KEY = 'crm.emoji.recent';
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
export const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

function readRecent(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 24) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string) {
  try {
    const next = [emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, 24);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode — recents are a nicety */
  }
}

const GROUP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  smileys_emotion: Smile,
  people_body: Users,
  animals_nature: Leaf,
  food_drink: Coffee,
  travel_places: Plane,
  activities: Trophy,
  objects: Lightbulb,
  symbols: Heart,
  flags: Flag,
};

export function EmojiPicker({
  onPick,
  onClose,
  className,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  className?: string;
}) {
  const [groups, setGroups] = React.useState<readonly EmojiGroup[] | null>(cache);
  const [query, setQuery] = React.useState('');
  const [recent] = React.useState(readRecent);
  const [active, setActive] = React.useState('recent');
  const grid = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (groups) return;
    let live = true;
    void preloadEmoji().then((g) => live && setGroups(g));
    return () => {
      live = false;
    };
  }, [groups]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const results = React.useMemo(() => {
    if (!groups || !q) return null;
    const words = q.split(/\s+/);
    const found: string[] = [];
    for (const g of groups) {
      for (const [e, w] of g.emojis) {
        if (words.every((word) => w.includes(word))) found.push(e);
        if (found.length >= 160) return found;
      }
    }
    return found;
  }, [groups, q]);

  const pick = (e: string) => {
    rememberEmoji(e);
    onPick(e);
  };

  const jump = (key: string) => {
    setActive(key);
    grid.current?.querySelector(`[data-group="${key}"]`)?.scrollIntoView({ block: 'start' });
  };

  const cell = (e: string) => (
    <button
      key={e}
      type="button"
      onClick={() => pick(e)}
      className="grid size-9 place-items-center rounded-md text-[22px] leading-none transition-colors hover:bg-bg-subtle"
      style={{ fontFamily: EMOJI_FONT }}
      aria-label={e}
    >
      {e}
    </button>
  );

  return (
    <div
      role="dialog"
      aria-label="Emoji"
      className={cn(
        'flex h-[22rem] w-[21rem] max-w-full flex-col overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-xl',
        className,
      )}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-bg-subtle px-2.5 py-1.5">
          <Search className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emoji"
            className="min-w-0 flex-1 bg-transparent text-body-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
        </label>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-7 place-items-center rounded-md text-text-secondary hover:bg-bg-subtle">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {!q && (
        <div className="flex items-center justify-between border-b border-border-subtle px-1.5">
          {[{ key: 'recent', Icon: Clock }, ...(groups ?? []).map((g) => ({ key: g.key, Icon: GROUP_ICON[g.key] ?? Smile }))].map(
            ({ key, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => jump(key)}
                aria-label={key}
                className={cn(
                  'grid h-9 flex-1 place-items-center border-b-2 transition-colors',
                  active === key ? 'border-accent-primary text-accent-primary' : 'border-transparent text-text-secondary hover:text-text-primary',
                )}
              >
                <Icon className="size-4" />
              </button>
            ),
          )}
        </div>
      )}

      <div ref={grid} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!groups ? (
          <p className="py-10 text-center text-caption text-text-secondary">Loading emoji…</p>
        ) : results ? (
          results.length === 0 ? (
            <p className="py-10 text-center text-caption text-text-secondary">No emoji match “{query}”.</p>
          ) : (
            <div className="grid grid-cols-8 pt-2">{results.map(cell)}</div>
          )
        ) : (
          <>
            <section data-group="recent">
              <h4 className="sticky top-0 z-10 bg-bg-surface px-1 pb-1 pt-2 text-micro font-semibold uppercase tracking-wide text-text-secondary">
                Recent
              </h4>
              <div className="grid grid-cols-8">{(recent.length ? recent : QUICK_REACTIONS).map(cell)}</div>
            </section>
            {groups.map((g) => (
              <section key={g.key} data-group={g.key}>
                <h4 className="sticky top-0 z-10 bg-bg-surface px-1 pb-1 pt-2 text-micro font-semibold uppercase tracking-wide text-text-secondary">
                  {g.label}
                </h4>
                <div className="grid grid-cols-8">{g.emojis.map(([e]) => cell(e))}</div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
