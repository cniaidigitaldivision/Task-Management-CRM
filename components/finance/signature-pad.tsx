'use client';

import * as React from 'react';
import { Eraser, PenLine } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/* ============================================================================
 * A SIGNATURE PAD — owner request 2026-08-29
 * ----------------------------------------------------------------------------
 * *"Also give me some signature pads where I can draw my signature. That
 * signature will be attached to the PDF of this invoice."*
 *
 * ── ⚠️ POINTER EVENTS, NOT MOUSE EVENTS ────────────────────────────────────
 * `pointerdown/move/up` is one code path for a mouse, a finger and a stylus.
 * The mouse-plus-touch pair is two paths that drift, and on a tablet — which is
 * where somebody would actually sign with their hand — the touch path is the
 * one nobody tests. `setPointerCapture` is what keeps the stroke alive when the
 * pen leaves the canvas mid-flourish, which is most signatures.
 *
 * ── ⚠️ THE CANVAS IS DRAWN AT DEVICE RESOLUTION ────────────────────────────
 * A canvas has two sizes: its CSS box and its pixel buffer. Left equal, a
 * signature on a 2× display is drawn at half resolution and lands in the PDF
 * visibly soft — and a soft signature reads as a scan of a scan. The buffer is
 * `devicePixelRatio` times the box, and the context is scaled to match so the
 * drawing code can keep thinking in CSS pixels.
 *
 * ⚠️ WHICH IS ALSO WHY THE SIZE IS READ FROM THE ELEMENT, NOT HARD-CODED. The
 * pad is inside a dialogue that is narrower on a phone; a fixed 600px buffer on
 * a 320px box stretches every stroke horizontally, and a stretched signature is
 * somebody else's handwriting.
 *
 * ── ⚠️ IT EXPORTS A PNG, AND ONLY A PNG ────────────────────────────────────
 * `toDataURL('image/png')`. Not JPEG — a signature is line art on transparency
 * and JPEG has neither; it would arrive with a white box around it and haloed
 * edges. Not SVG — `lib/domain/invoice.ts:decodeSignature` refuses anything but
 * PNG on purpose, because an SVG is a document that can carry script and this
 * one is stored in a bucket and drawn into a PDF.
 * ========================================================================= */

export interface SignaturePadHandle {
  /** The drawing as a PNG data URL, or null if nothing has been drawn. */
  toDataUrl: () => string | null;
  clear: () => void;
}

export function SignaturePad({
  ref,
  label = 'Sign here',
  hint,
  height = 150,
  onChange,
}: {
  ref?: React.Ref<SignaturePadHandle>;
  label?: string;
  hint?: string;
  height?: number;
  /** Fires when the pad goes from empty to drawn or back. */
  onChange?: (hasInk: boolean) => void;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [hasInk, setHasInk] = React.useState(false);
  const drawing = React.useRef(false);
  const last = React.useRef<{ x: number; y: number } | null>(null);

  /** Match the pixel buffer to the box, at device resolution. */
  const resize = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.round(rect.width * ratio);
    const heightPx = Math.round(rect.height * ratio);

    /* ⚠️ Only when it actually changed. Assigning `canvas.width` CLEARS the
       canvas even when the value is identical, so an unconditional resize on
       every render wipes a signature somebody is halfway through drawing. */
    if (canvas.width === width && canvas.height === heightPx) return;

    canvas.width = width;
    canvas.height = heightPx;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2.2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    /* Near-black rather than pure black: it sits on white paper in the PDF and
       reads as ink rather than as a printed rule. */
    context.strokeStyle = '#12222a';
  }, []);

  React.useEffect(() => {
    resize();
    /* The dialogue animates open, so the box has no width on the first frame.
       A ResizeObserver catches it whenever it settles, and catches a phone
       being rotated too. */
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [resize]);

  const positionOf = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    /* Keeps the stroke alive when the pen leaves the canvas mid-flourish, which
       is what the tail of most signatures does. */
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    last.current = positionOf(event);

    /* A dot, so a full stop or a tittle registers on a tap with no movement. */
    const context = canvasRef.current?.getContext('2d');
    if (context && last.current) {
      context.beginPath();
      context.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2);
      context.fillStyle = '#12222a';
      context.fill();
    }

    if (!hasInk) {
      setHasInk(true);
      onChange?.(true);
    }
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    event.preventDefault();

    const context = canvasRef.current?.getContext('2d');
    const from = last.current;
    if (!context || !from) return;

    const to = positionOf(event);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    last.current = to;
  };

  const end = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = false;
    last.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const clear = React.useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange?.(false);
  }, [onChange]);

  React.useImperativeHandle(
    ref,
    () => ({
      toDataUrl: () => {
        if (!hasInk) return null;
        return canvasRef.current?.toDataURL('image/png') ?? null;
      },
      clear,
    }),
    [hasInk, clear],
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-caption font-semibold text-text-primary">
          <PenLine className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
          {label}
        </span>
        <Button variant="ghost" size="sm" onClick={clear} disabled={!hasInk}>
          <Eraser className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
          Clear
        </Button>
      </div>

      <div
        className={cn(
          'relative overflow-hidden rounded-xl border bg-bg-surface',
          hasInk ? 'border-border-brand' : 'border-dashed border-border-default',
        )}
        style={{ height }}
      >
        {/* The guide line and prompt, under the canvas so a stroke covers them. */}
        {!hasInk && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-7 flex flex-col items-center gap-2"
          >
            <span className="h-px w-3/4 bg-border-default" />
            <span className="text-micro text-text-tertiary">Draw with a mouse, finger or stylus</span>
          </span>
        )}

        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          /* ⚠️ `touch-none` is load-bearing on a phone. Without it the browser
             claims the gesture for scrolling and the stroke stops after a few
             pixels — which reads as a broken pad rather than as a scroll. */
          className="relative h-full w-full cursor-crosshair touch-none"
          /* Not focusable and not labelled as an input: a canvas cannot be
             signed with a keyboard, so announcing it as one would be a lie. The
             fallback for somebody who cannot draw is the saved signature, or
             leaving the invoice with the printed name alone. */
          aria-hidden="true"
        />
      </div>

      {hint && <p className="text-micro text-text-tertiary">{hint}</p>}
    </div>
  );
}
