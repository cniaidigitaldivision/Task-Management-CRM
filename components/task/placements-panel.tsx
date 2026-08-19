'use client';

import * as React from 'react';
import { ExternalLink, Link2, Loader2, Plus, Send, Trash2 } from 'lucide-react';

import {
  listPlacementsAction,
  removePlacementAction,
  savePlacementAction,
} from '@/app/actions/placements';
import type { PlacementRow } from '@/lib/db/queries/placements';
import type { PlatformRow } from '@/lib/db/queries/catalogue';
import { CONTENT_KIND_LABEL, CONTENT_KINDS, type ContentKind } from '@/lib/domain/constants';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

/* ============================================================================
 * WHERE IT WENT — the sheet's per-platform link columns, as rows
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-19: the coordinator's sheet carries a Facebook post link, a
 * Facebook reel link, an Instagram post link, an Instagram reel link, a TikTok
 * link and a YouTube link — *"so when I give a report to a super admin, he can
 * click on that link and directly go to that page or that exact post."*
 *
 * ── WHY THIS IS ROWS AND NOT SIX FIXED FIELDS ────────────────────────────────
 * Six columns is what a spreadsheet has to do. It is wrong here for three
 * reasons: adding TikTok Stories next month would be a schema change and a form
 * change; most tasks use two of the six, so four boxes sit empty forever; and
 * nothing could ever be counted per platform because "which column is filled in"
 * is not a query. A row per destination fixes all three.
 *
 * ── ONE DELIVERABLE, MANY DESTINATIONS, STILL ONE ASSET ──────────────────────
 * Confirmed by the owner: a video cross-posted to four platforms is ONE asset.
 * So nothing on this panel counts toward the package target — the task does that.
 * This panel is the evidence trail.
 * ========================================================================= */

/** The formats worth offering for a published destination. `website`, `report`
 *  and `ad` are real content kinds but nobody publishes them *to a platform*, so
 *  offering them here would only invite a nonsense row. */
const PLACEMENT_KINDS: readonly ContentKind[] = CONTENT_KINDS.filter(
  (k): k is ContentKind => k === 'static' || k === 'reel' || k === 'carousel' || k === 'story' || k === 'video',
);

export function PlacementsPanel({ taskId }: { taskId: string }) {
  const [placements, setPlacements] = React.useState<PlacementRow[]>([]);
  const [platforms, setPlatforms] = React.useState<PlatformRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const result = await listPlacementsAction(taskId);
    if (result.ok) {
      setPlacements(result.placements);
      setPlatforms(result.platforms);
    }
  }, [taskId]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listPlacementsAction(taskId);
      if (cancelled) return;
      if (result.ok) {
        setPlacements(result.placements);
        setPlatforms(result.platforms);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const live = placements.filter((p) => p.url).length;

  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-caption font-semibold text-text-primary">
          Published to
          {placements.length > 0 && (
            <span className="ml-2 font-normal text-text-tertiary">
              {live} of {placements.length} live
            </span>
          )}
        </h3>
        {!adding && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            Add a destination
          </Button>
        )}
      </div>

      {note && <p className="text-micro text-text-tertiary">{note}</p>}

      {loading ? (
        <p className="flex items-center gap-2 py-2 text-caption text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Reading destinations…
        </p>
      ) : placements.length === 0 && !adding ? (
        <p className="text-caption text-text-secondary">
          Nowhere yet. Add a destination as each post goes live — those links are what a report
          gives the CEO to click.
        </p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {placements.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
              <Badge token="accent-primary" size="sm" variant="outline">
                {p.platformName}
              </Badge>
              <span className="text-micro text-text-tertiary">
                {CONTENT_KIND_LABEL[p.contentKind]}
              </span>

              {p.url ? (
                /* The whole point. `noopener` because it leaves our origin. */
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 text-caption text-text-brand hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                  <span className="truncate">Open the post</span>
                </a>
              ) : (
                <span
                  className="inline-flex items-center gap-1 text-caption"
                  style={{ color: 'var(--feedback-warning)' }}
                >
                  <Link2 className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
                  no link yet
                </span>
              )}

              {p.publishedOn && (
                <span className="text-micro text-text-tertiary">{p.publishedOn}</span>
              )}

              <IconButton
                variant="deleteGhost"
                size="sm"
                label={`Remove the ${p.platformName} ${CONTENT_KIND_LABEL[p.contentKind]}`}
                icon={Trash2}
                disabled={busy !== null}
                className="ml-auto"
                onClick={async () => {
                  setBusy(p.id);
                  try {
                    const result = await removePlacementAction(p.id);
                    setNote(result.ok ? null : (result.error ?? null));
                    if (result.ok) await load();
                  } finally {
                    setBusy(null);
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AddPlacement
          taskId={taskId}
          platforms={platforms}
          onCancel={() => setAdding(false)}
          onSaved={async (message) => {
            setNote(message);
            setAdding(false);
            await load();
          }}
        />
      )}
    </section>
  );
}

/* ---- Adding one -----------------------------------------------------------
   A form rather than inline state, so the server action is the single validator.
   The URL rule lives in `savePlacementAction` and in a database constraint; a
   third copy here would be the one that drifts. */

function AddPlacement({
  taskId,
  platforms,
  onCancel,
  onSaved,
}: {
  taskId: string;
  platforms: readonly PlatformRow[];
  onCancel: () => void;
  onSaved: (message: string | null) => void;
}) {
  const [state, formAction, pending] = React.useActionState(savePlacementAction, {
    ok: false,
  });
  const seen = React.useRef(false);

  React.useEffect(() => {
    if (state.ok && !seen.current) {
      seen.current = true;
      onSaved(state.warning ?? null);
    }
  }, [state, onSaved]);

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg border border-border-subtle bg-bg-subtle p-3"
    >
      <input type="hidden" name="taskId" value={taskId} />

      {!state.ok && state.error && (
        <p className="text-caption" style={{ color: 'var(--feedback-error)' }}>
          {state.error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Platform" htmlFor="platformId">
          <Select
            size="md"
            id="platformId"
            name="platformId"
            required
            options={platforms.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>

        <Field
          label="Published as"
          htmlFor="placementKind"
          hint="The same video can be a post and a reel — that is two destinations."
        >
          <Select
            size="md"
            id="placementKind"
            name="contentKind"
            required
            defaultValue="reel"
            options={PLACEMENT_KINDS.map((k) => ({ value: k, label: CONTENT_KIND_LABEL[k] }))}
          />
        </Field>
      </div>

      <Field
        label="Link"
        htmlFor="placementUrl"
        hint="Leave blank until it is live — the row can wait for its link."
      >
        <Input id="placementUrl" name="url" type="url" placeholder="https://…" />
      </Field>

      <Field label="Date it went live" htmlFor="placementDate">
        <Input id="placementDate" name="publishedOn" type="date" />
      </Field>

      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" type="submit" disabled={pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
          )}
          Save
        </Button>
        <Button variant="ghost" size="sm" type="button" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
