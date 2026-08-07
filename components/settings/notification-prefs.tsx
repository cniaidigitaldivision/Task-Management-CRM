'use client';

import * as React from 'react';
import { CheckCircle2, Loader2, Lock } from 'lucide-react';

import { saveMyPrefsAction } from '@/app/actions/notification-prefs';
import { Button } from '@/components/ui/button';
import type { NotificationKind } from '@/lib/domain/constants';
import {
  PREF_DEFINITIONS,
  isLocked,
  type NotificationPrefs,
} from '@/lib/domain/notification-prefs';

/* ============================================================================
 * NOTIFICATION PREFERENCES — FR-078
 * ----------------------------------------------------------------------------
 * ── A LOCKED SWITCH IS SHOWN, DISABLED, WITH ITS REASON ──────────────────────
 * Not hidden. Somebody who cannot find "task assigned to you" in this list will
 * conclude the setting is missing and ask for it; somebody who sees it greyed
 * out with "work arriving on your plate without you knowing helps nobody" has
 * been answered. Hiding a control is how a product accumulates support
 * questions it has already answered in its own head.
 *
 * ── ONE SAVE BUTTON HERE, UNLIKE SETTINGS ────────────────────────────────────
 * The workspace settings screen saves per field because each one is a separate
 * decision with its own validation. These are one decision — "what do I want to
 * hear about" — made across thirty switches in a single sitting, and saving on
 * every toggle would be thirty writes and thirty toasts.
 * ========================================================================= */

const GROUPS = ['your work', 'reviews', 'time', 'the team', 'security'] as const;

const GROUP_HELP: Record<(typeof GROUPS)[number], string> = {
  'your work': 'Things that land on you.',
  reviews: 'Work moving between you and whoever checks it.',
  time: 'Timers, limits and requests for more of it.',
  'the team': 'What is happening around you.',
  security: 'Your account.',
};

export function NotificationPrefsPanel({ initial }: { initial: NotificationPrefs }) {
  const [prefs, setPrefs] = React.useState<NotificationPrefs>(initial);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  /* Dirty is derived rather than tracked. A separate flag set on every toggle
     is one more thing that can disagree with the data it describes. */
  const dirty = React.useMemo(
    () => JSON.stringify(prefs) !== JSON.stringify(initial),
    [prefs, initial],
  );

  const toggle = (kind: NotificationKind, channel: 'inApp' | 'email') => {
    setSaved(false);
    setPrefs((current) => ({
      ...current,
      [kind]: { ...current[kind], [channel]: !current[kind][channel] },
    }));
  };

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-border-subtle">
        <div className="grid grid-cols-[1fr_4rem_4rem] items-center gap-2 border-b border-border-subtle bg-bg-surface-sunken px-4 py-2">
          <span className="text-micro font-semibold uppercase tracking-wide text-text-tertiary">
            Tell me about
          </span>
          <span className="text-center text-micro font-semibold text-text-tertiary">In app</span>
          <span className="text-center text-micro font-semibold text-text-tertiary">Email</span>
        </div>

        {GROUPS.map((group) => {
          const rows = PREF_DEFINITIONS.filter((d) => d.group === group);
          if (rows.length === 0) return null;

          return (
            <div key={group}>
              <div className="border-b border-border-subtle bg-bg-surface px-4 py-1.5">
                <p className="text-micro font-semibold capitalize text-text-secondary">
                  {group}
                  <span className="ml-1.5 font-normal text-text-tertiary">
                    {GROUP_HELP[group]}
                  </span>
                </p>
              </div>

              {rows.map((definition) => (
                <div
                  key={definition.kind}
                  className="grid grid-cols-[1fr_4rem_4rem] items-center gap-2 border-b border-border-subtle px-4 py-2.5 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-caption text-text-primary">{definition.label}</p>
                    <p className="text-micro text-text-tertiary">
                      {definition.help}
                      {definition.lockedReason && (
                        <>
                          {' '}
                          <Lock
                            className="inline h-3 w-3 align-[-1px]"
                            strokeWidth={2}
                            aria-hidden="true"
                          />{' '}
                          {definition.lockedReason}
                        </>
                      )}
                    </p>
                  </div>

                  {(['inApp', 'email'] as const).map((channel) => {
                    const locked = isLocked(definition.kind, channel);
                    return (
                      <label
                        key={channel}
                        className="flex justify-center"
                        title={
                          locked ? definition.lockedReason : `${definition.label} — ${channel}`
                        }
                      >
                        <span className="sr-only">
                          {definition.label}, {channel === 'inApp' ? 'in app' : 'email'}
                        </span>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--accent-primary)] disabled:opacity-40"
                          checked={prefs[definition.kind][channel]}
                          disabled={locked}
                          onChange={() => toggle(definition.kind, channel)}
                        />
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          size="md"
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            await saveMyPrefsAction(prefs);
            setSaving(false);
            setSaved(true);
          }}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Save preferences
        </Button>

        {saved && !dirty && (
          <span
            className="flex items-center gap-1.5 text-caption"
            style={{ color: 'var(--feedback-success)' }}
          >
            <CheckCircle2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Saved
          </span>
        )}

        {dirty && !saving && (
          <span className="text-micro text-text-tertiary">Unsaved changes.</span>
        )}
      </div>
    </div>
  );
}
