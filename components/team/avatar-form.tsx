'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2, Trash2, Upload } from 'lucide-react';

import {
  removeAvatarAction,
  uploadAvatarAction,
  type PeopleActionResult,
} from '@/app/actions/people';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

/* ============================================================================
 * YOUR PROFILE PICTURE — CHANGE-PLAN 2.3
 * ----------------------------------------------------------------------------
 * Owner instruction, Session 20: *"on the profiles everyone can add their
 * profile picture… and that picture is presented on every task."*
 *
 * ── IT IS RESIZED IN THE BROWSER BEFORE IT IS SENT ───────────────────────────
 * A phone photograph is three to eight megabytes and four thousand pixels wide,
 * for something drawn at 28 pixels on a board card. Sending that would blow the
 * 2 MB bucket limit on most real photographs, so people would be told to "try a
 * smaller one" with no way to make one.
 *
 * Drawing it to a canvas at 256px and exporting JPEG solves that, and has a
 * second benefit worth more than the bandwidth: **canvas output carries no EXIF**,
 * so the GPS coordinates in a phone photo are gone before it ever leaves the
 * device.
 *
 * ⚠️ This is a CONVENIENCE, not a security boundary. Anything can post anything
 * to a server action. The actual check is in lib/storage/bucket.ts, which reads
 * the file's magic bytes and refuses whatever is not a real JPEG, PNG or WebP —
 * the bucket is public, and a public bucket serves what it is given.
 * ========================================================================= */

/** Rendered at 28–56px almost everywhere; 256 covers retina and the profile. */
const MAX_EDGE = 256;

/**
 * Square-crop, resize and re-encode. Returns the original untouched if anything
 * about the process fails — the server will still validate it, and refusing to
 * upload because a canvas misbehaved would be worse than sending the original.
 */
async function shrink(file: File): Promise<File> {
  try {
    if (!file.type.startsWith('image/')) return file;

    const bitmap = await createImageBitmap(file);
    const edge = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = MAX_EDGE;
    canvas.height = MAX_EDGE;

    const context = canvas.getContext('2d');
    if (!context) return file;

    /* Centre crop to a square, then scale. Cropping in the draw call rather
       than afterwards means one operation and no intermediate canvas. */
    context.drawImage(
      bitmap,
      (bitmap.width - edge) / 2,
      (bitmap.height - edge) / 2,
      edge,
      edge,
      0,
      0,
      MAX_EDGE,
      MAX_EDGE,
    );
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.86),
    );
    if (!blob) return file;

    return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export function AvatarForm({
  name,
  currentUrl,
}: {
  name: string;
  currentUrl: string | null;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<PeopleActionResult | null>(null);
  /* Shown the instant a file is chosen, so the change is visible before the
     round trip rather than after it. */
  const [preview, setPreview] = React.useState<string | null>(null);

  React.useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const choose = async (file: File) => {
    setBusy(true);
    setResult(null);

    const prepared = await shrink(file);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(prepared);
    });

    const form = new FormData();
    form.append('avatar', prepared);
    const outcome = await uploadAvatarAction({ ok: false }, form);

    setResult(outcome);
    setBusy(false);

    if (outcome.ok) {
      router.refresh();
      return;
    }

    /* A REFUSED upload must not keep its preview. Without this, rejecting a
       file leaves the person looking at the thing that was just refused where
       their actual picture used to be — and if it is not a renderable image,
       at their initials, which reads as though the good one was deleted.
       Nothing on the server changed, so nothing on screen should either. */
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  };

  const clear = async () => {
    setBusy(true);
    const outcome = await removeAvatarAction();
    setResult(outcome);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setBusy(false);
    if (outcome.ok) router.refresh();
  };

  const shown = preview ?? currentUrl;

  return (
    <div className="space-y-3">
      {result && (
        <div
          role={result.ok ? 'status' : 'alert'}
          className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
          style={{
            backgroundColor: `color-mix(in oklab, var(--feedback-${result.ok ? 'success' : 'error'}) var(--tint-soft), var(--bg-surface))`,
            border: `1px solid color-mix(in oklab, var(--feedback-${result.ok ? 'success' : 'error'}) 32%, transparent)`,
          }}
        >
          {result.ok ? (
            <CheckCircle2
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-success)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
          ) : (
            <AlertTriangle
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-error)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
          )}
          <p className="text-caption text-text-primary">{result.note ?? result.error}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={name} src={shown} size="xl" />

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              /* Reset, so choosing the same file twice fires onChange again —
                 which somebody will do after a failed upload. */
              event.target.value = '';
              if (file) void choose(file);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            )}
            {busy ? 'Saving…' : shown ? 'Change picture' : 'Upload a picture'}
          </Button>

          {shown && (
            <Button type="button" variant="ghost" size="md" disabled={busy} onClick={clear}>
              <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              Remove
            </Button>
          )}
        </div>
      </div>

      <p className="text-micro text-text-tertiary">
        JPEG, PNG or WebP. It is cropped square and resized to 256px in your browser before it is
        sent, which also strips the location data a phone photograph carries. SVG is not accepted —
        it can contain script, and these are served from a public address.
      </p>
    </div>
  );
}
