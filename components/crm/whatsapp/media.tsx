'use client';

import * as React from 'react';
import { Download, FileText, Headphones, Mic, Pause, Play, X } from 'lucide-react';

import type { CrmMessage } from '@/lib/db/queries/crm-leads';
import { cn } from '@/lib/utils';
import { documentLook, formatBytes, formatDuration, mediaShape, mediaUrl } from './shared';

/* ============================================================================
 * WHAT A MESSAGE CARRIES — photos, video, voice notes, files
 * ----------------------------------------------------------------------------
 * Every src is `/api/whatsapp/media/[id]`, which answers with a short-lived link
 * to our stored copy (184) — RLS-checked per person, and never a public URL.
 * A message still uploading draws from the browser's own copy (`localUrl`), so a
 * photo appears the instant it is chosen rather than after the upload.
 * ========================================================================= */

export interface LocalMedia {
  /** An object URL of the file in the browser. */
  readonly url: string;
  /** 0–1 while uploading; null once handed to WhatsApp. */
  readonly progress: number | null;
  /** Seconds, for a voice note recorded here. */
  readonly seconds?: number;
}

export function MessageMedia({
  message,
  local,
  mine,
  onOpen,
}: {
  message: CrmMessage;
  local?: LocalMedia;
  mine: boolean;
  onOpen: (kind: 'image' | 'video', src: string, message: CrmMessage) => void;
}) {
  const shape = mediaShape(message);
  const src = local?.url ?? mediaUrl(message.id);

  if (shape === 'image' || shape === 'sticker') {
    return (
      <button
        type="button"
        onClick={() => onOpen('image', src, message)}
        className={cn(
          'relative block overflow-hidden rounded-md',
          shape === 'sticker' ? 'size-32 bg-transparent' : 'w-[16.5rem] max-w-full bg-black/5',
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed, per-person redirect; next/image cannot optimise it */}
        <img
          src={src}
          alt={message.body ?? 'Photo'}
          loading="lazy"
          className={cn('block w-full', shape === 'sticker' ? 'h-full object-contain' : 'max-h-[20rem] min-h-24 object-cover')}
        />
        <Progress value={local?.progress ?? null} />
      </button>
    );
  }

  if (shape === 'video') {
    return (
      <button
        type="button"
        onClick={() => onOpen('video', src, message)}
        className="relative block w-[16.5rem] max-w-full overflow-hidden rounded-md bg-black"
      >
        <video src={`${src}#t=0.1`} preload="metadata" muted playsInline className="block max-h-[20rem] w-full object-cover" />
        {local?.progress == null && (
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid size-12 place-items-center rounded-full bg-black/55 text-white">
              <Play className="size-6 translate-x-0.5" fill="currentColor" aria-hidden="true" />
            </span>
          </span>
        )}
        <Progress value={local?.progress ?? null} />
      </button>
    );
  }

  if (shape === 'voice' || shape === 'audio') {
    return (
      <VoiceNote
        id={message.id}
        src={src}
        voice={shape === 'voice'}
        mine={mine}
        played={Boolean(message.playedAt)}
        filename={message.mediaFilename}
        secondsHint={local?.seconds ?? null}
        progress={local?.progress ?? null}
      />
    );
  }

  if (shape === 'document') {
    const look = documentLook(message.mediaFilename, message.mediaMime);
    return (
      <a
        href={local ? local.url : mediaUrl(message.id, true)}
        download={local ? message.mediaFilename ?? true : undefined}
        className="relative flex w-[16.5rem] max-w-full items-center gap-3 rounded-md px-2.5 py-2.5 transition-colors"
        style={{ background: 'color-mix(in oklab, var(--wa-ink) 6%, transparent)' }}
      >
        <span className="relative grid h-10 w-8 shrink-0 place-items-end rounded-[3px] pb-1 text-[8px] font-bold text-white" style={{ background: look.color }}>
          <FileText className="absolute left-1/2 top-1.5 size-3.5 -translate-x-1/2 opacity-80" aria-hidden="true" />
          <span className="w-full text-center">{look.label}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] leading-5" style={{ color: 'var(--wa-ink)' }}>
            {message.mediaFilename ?? 'Document'}
          </span>
          <span className="block text-[11.5px]" style={{ color: 'var(--wa-meta)' }}>
            {[look.label, formatBytes(message.mediaSize)].filter(Boolean).join(' · ')}
          </span>
        </span>
        {local?.progress == null ? (
          <span className="grid size-8 shrink-0 place-items-center rounded-full border" style={{ borderColor: 'var(--wa-meta)', color: 'var(--wa-meta)' }}>
            <Download className="size-4" aria-hidden="true" />
          </span>
        ) : (
          <Ring value={local.progress} />
        )}
      </a>
    );
  }
  return null;
}

/* ── Upload progress ──────────────────────────────────────────────────────── */

function Ring({ value }: { value: number }) {
  const c = 2 * Math.PI * 13;
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0 -rotate-90" aria-label={`Uploading ${Math.round(value * 100)}%`}>
      <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <circle cx="16" cy="16" r="13" fill="none" stroke="#00a884" strokeWidth="3" strokeDasharray={c} strokeDashoffset={c * (1 - value)} strokeLinecap="round" />
    </svg>
  );
}

function Progress({ value }: { value: number | null }) {
  if (value == null) return null;
  return (
    <span className="absolute inset-0 grid place-items-center bg-black/35 text-white">
      <Ring value={value} />
    </span>
  );
}

/* ── Voice notes ──────────────────────────────────────────────────────────── */

interface Decoded {
  readonly peaks: readonly number[];
  readonly seconds: number;
  readonly url: string;
}

/* ⚠️ DECODED ONCE PER MESSAGE, kept for the session — scrolling past the same
   voice note twice must not download it twice. */
const decoded = new Map<string, Promise<Decoded | null>>();
const BARS = 38;

function decodeVoice(id: string, src: string): Promise<Decoded | null> {
  let job = decoded.get(id);
  if (!job) {
    job = (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) return null;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        try {
          const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
          const data = audio.getChannelData(0);
          const step = Math.max(1, Math.floor(data.length / BARS));
          const peaks: number[] = [];
          for (let b = 0; b < BARS; b++) {
            let sum = 0;
            for (let i = b * step; i < Math.min(data.length, (b + 1) * step); i++) sum += data[i] * data[i];
            peaks.push(Math.sqrt(sum / step));
          }
          const max = Math.max(...peaks, 0.001);
          return { peaks: peaks.map((p) => Math.max(0.12, p / max)), seconds: audio.duration, url };
        } catch {
          return { peaks: [], seconds: NaN, url };
        } finally {
          void ctx.close();
        }
      } catch {
        return null;
      }
    })();
    decoded.set(id, job);
  }
  return job;
}

const SPEEDS = [1, 1.5, 2] as const;

function VoiceNote({
  id,
  src,
  voice,
  mine,
  played,
  filename,
  secondsHint,
  progress,
}: {
  id: string;
  src: string;
  voice: boolean;
  mine: boolean;
  played: boolean;
  filename: string | null;
  secondsHint: number | null;
  progress: number | null;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const [data, setData] = React.useState<Decoded | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [position, setPosition] = React.useState(0);
  const [speed, setSpeed] = React.useState<(typeof SPEEDS)[number]>(1);

  /* Decode when it scrolls into view — not for every voice note in a long chat. */
  React.useEffect(() => {
    if (progress != null) return;
    const el = box.current;
    if (!el) return;
    let live = true;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        void decodeVoice(id, src).then((d) => {
          if (!live) return;
          if (d) setData(d);
          else setFailed(true);
        });
      }
    });
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [id, src, progress]);

  React.useEffect(() => () => audio.current?.pause(), []);

  const seconds = Number.isFinite(data?.seconds) ? data!.seconds : (secondsHint ?? 0);

  const toggle = async () => {
    if (progress != null) return;
    let a = audio.current;
    if (!a) {
      const d = data ?? (await decodeVoice(id, src));
      a = new Audio(d?.url ?? src);
      a.ontimeupdate = () => setPosition(a!.currentTime);
      a.onended = () => {
        setPlaying(false);
        setPosition(0);
      };
      a.onpause = () => setPlaying(false);
      a.onplay = () => setPlaying(true);
      audio.current = a;
    }
    a.playbackRate = speed;
    if (a.paused) void a.play().catch(() => setFailed(true));
    else a.pause();
  };

  const seek = (ratio: number) => {
    const a = audio.current;
    if (!a || !seconds) return;
    a.currentTime = Math.max(0, Math.min(seconds, ratio * seconds));
    setPosition(a.currentTime);
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  };

  const done = seconds ? position / seconds : 0;
  const peaks = data?.peaks.length ? data.peaks : Array.from({ length: BARS }, (_, i) => 0.25 + 0.2 * Math.abs(Math.sin(i * 1.7)));

  return (
    <div ref={box} className="flex w-[16.5rem] max-w-full items-center gap-2.5 py-1">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={progress != null}
        aria-label={playing ? 'Pause' : 'Play'}
        className="grid size-9 shrink-0 place-items-center rounded-full"
        style={{ color: 'var(--wa-meta)' }}
      >
        {progress != null ? (
          <Ring value={progress} />
        ) : playing ? (
          <Pause className="size-6" fill="currentColor" aria-hidden="true" />
        ) : (
          <Play className="size-6 translate-x-0.5" fill="currentColor" aria-hidden="true" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          className="flex h-7 cursor-pointer items-center gap-[2px]"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek((e.clientX - r.left) / r.width);
          }}
          role="slider"
          aria-label="Position"
          aria-valuemin={0}
          aria-valuemax={Math.round(seconds)}
          aria-valuenow={Math.round(position)}
          tabIndex={0}
        >
          {peaks.map((p, i) => (
            <span
              key={i}
              className="w-[3px] shrink-0 rounded-full"
              style={{
                height: `${Math.round(p * 100)}%`,
                background: i / peaks.length < done ? '#00a884' : 'color-mix(in oklab, var(--wa-meta) 55%, transparent)',
              }}
            />
          ))}
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[11px] tabular-nums" style={{ color: 'var(--wa-meta)' }}>
          <span>{failed && !data ? 'Cannot play here' : formatDuration(playing || position ? position : seconds)}</span>
          {!voice && filename && <span className="ml-2 truncate">{filename}</span>}
          {(playing || position > 0) && (
            <button type="button" onClick={cycleSpeed} className="rounded-full bg-black/10 px-1.5 font-semibold">
              {speed}×
            </button>
          )}
        </div>
      </div>

      <span
        className="relative grid size-10 shrink-0 place-items-center rounded-full text-white"
        style={{ background: voice ? '#7a8b95' : '#f59e0b' }}
      >
        {voice ? <Mic className="size-5" aria-hidden="true" /> : <Headphones className="size-5" aria-hidden="true" />}
        {voice && (
          <span
            className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full"
            style={{ background: mine ? 'var(--wa-bubble-out)' : 'var(--wa-bubble-in)' }}
          >
            <Mic className="size-3" style={{ color: mine && played ? 'var(--wa-tick-read)' : '#00a884' }} aria-hidden="true" />
          </span>
        )}
      </span>
    </div>
  );
}

/* ── Full screen ──────────────────────────────────────────────────────────── */

export function Lightbox({
  kind,
  src,
  message,
  onClose,
}: {
  kind: 'image' | 'video';
  src: string;
  message: CrmMessage;
  onClose: () => void;
}) {
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

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/90" role="dialog" aria-label="Media" onClick={onClose}>
      <div className="flex items-center gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <p className="min-w-0 flex-1 truncate text-body-sm">{message.body ?? message.mediaFilename ?? ''}</p>
        {!src.startsWith('blob:') && (
          <a href={mediaUrl(message.id, true)} aria-label="Download" className="grid size-9 place-items-center rounded-full hover:bg-white/10">
            <Download className="size-5" aria-hidden="true" />
          </a>
        )}
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full hover:bg-white/10">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
        {kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed redirect, see MessageMedia
          <img src={src} alt={message.body ?? 'Photo'} className="max-h-full max-w-full object-contain" />
        ) : (
          <video src={src} controls autoPlay playsInline className="max-h-full max-w-full" />
        )}
      </div>
    </div>
  );
}
