'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { savePlatformLinksAction } from '@/app/actions/projects';
import { PlatformIcon } from '@/components/brand/platform-icon';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/* ============================================================================
 * THE CLIENT'S PAGES — owner request 2026-08-20
 * ----------------------------------------------------------------------------
 * *"Make that form also work so I can add the platform URLs if we select Facebook,
 * Instagram, or TikTok."*
 *
 * ── ⚠️ WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
 * The owner asked where the header's social icons got their URLs from. The answer was
 * that they had none: the icons came from `project_platforms` — which platforms were
 * ticked on the New Project form — and nothing stored a Facebook page or an Instagram
 * handle anywhere. They were decoration shaped like links, which is worse than no
 * icons, because somebody would eventually click one expecting the client's page.
 *
 * Migration 037 added `page_url` and `handle`. This is where they are filled in, and
 * from then on the header icons are real anchors.
 *
 * ── ONLY THE PLATFORMS THIS PROJECT MANAGES ──────────────────────────────────
 * Eleven rows would invite somebody to record a Snapchat page for a project that does
 * not use Snapchat, and the row would then be invisible everywhere — the header only
 * draws platforms the project has. So the form asks about exactly the ones ticked, and
 * says where to change that set.
 * ========================================================================= */

export interface PlatformLink {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly pageUrl: string | null;
  readonly handle: string | null;
}

export function PlatformLinksDialog({
  open,
  onClose,
  projectId,
  projectName,
  platforms,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  platforms: readonly PlatformLink[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = React.useActionState(savePlatformLinksAction, {
    ok: false as boolean,
    error: undefined as string | undefined,
  });

  const sawOk = React.useRef(false);
  React.useEffect(() => {
    if (state.ok && !sawOk.current) {
      sawOk.current = true;
      router.refresh();
      onClose();
    }
  }, [state.ok, onClose, router]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Where the pages live"
      description={`The public page or profile for ${projectName} on each platform it manages.`}
      footer={
        <>
          <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="platform-links-form"
            variant="primary"
            size="md"
            disabled={pending}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {pending ? 'Saving…' : 'Save links'}
          </Button>
        </>
      }
    >
      <form id="platform-links-form" action={formAction} className="space-y-4">
        <input type="hidden" name="projectId" value={projectId} />

        {state.error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
              border: '1px solid color-mix(in oklab, var(--feedback-error) 32%, transparent)',
            }}
          >
            <AlertTriangle
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-error)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-caption text-text-primary">{state.error}</p>
          </div>
        )}

        {platforms.length === 0 ? (
          <p className="text-caption text-text-secondary">
            This project has no platforms ticked yet. Add them by editing the project, then come
            back here to record the pages.
          </p>
        ) : (
          <div className="space-y-3">
            {platforms.map((platform) => (
              <div key={platform.id} className="flex flex-wrap items-center gap-2">
                <span className="flex w-[9rem] shrink-0 items-center gap-2">
                  <PlatformIcon slug={platform.slug} size={22} />
                  <span className="truncate text-caption font-semibold text-text-primary">
                    {platform.name}
                  </span>
                </span>

                {/* ⚠️ The platform id travels WITH each pair, as `links`, rather than
                    the field being named after the slug. A slug in a field name would
                    have to be parsed back on the server and would break the moment two
                    platforms shared a prefix. `getAll` keeps the three arrays aligned
                    by index — see the action. */}
                <input type="hidden" name="platformIds" value={platform.id} />

                <Input
                  name="pageUrls"
                  type="url"
                  inputMode="url"
                  placeholder={`https://${platform.slug === 'x' ? 'x.com' : `${platform.slug}.com`}/…`}
                  defaultValue={platform.pageUrl ?? ''}
                  aria-label={`${platform.name} page URL`}
                  className="min-w-[14rem] flex-1"
                />
                <Input
                  name="handles"
                  placeholder="@handle"
                  defaultValue={platform.handle ?? ''}
                  aria-label={`${platform.name} handle`}
                  className="w-[9rem] shrink-0"
                />
              </div>
            ))}

            <p className="text-micro text-text-tertiary">
              Leave a row empty to clear it. The header icons link to whatever is recorded here,
              so a wrong URL is a wrong link on a page a client may see.
            </p>
          </div>
        )}
      </form>
    </Dialog>
  );
}
