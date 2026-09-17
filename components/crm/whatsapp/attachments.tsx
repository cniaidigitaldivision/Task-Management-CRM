'use client';

import * as React from 'react';
import { FileText, Plus, Send, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { documentLook, formatBytes } from './shared';

/* ============================================================================
 * CHOOSING FILES TO SEND — the preview, captions, and WhatsApp's rules
 * ----------------------------------------------------------------------------
 * ⚠️ WHATSAPP'S LIMITS ARE MET HERE, BEFORE ANYTHING UPLOADS (Meta's media
 * reference, 2026): a photo is jpeg/png up to 5 MB, a video mp4/3gpp up to
 * 16 MB, audio up to 16 MB. So:
 *   · a photo that is too large, or a WebP/GIF-like still, is re-saved as JPEG
 *     in the browser — as the WhatsApp app itself does — and arrives as a photo
 *   · a MOV, HEIC or anything WhatsApp will not show as media still arrives —
 *     as a document, and the preview says so before it is sent
 *   · only what cannot go at all (a 40 MB video) is refused, with the reason
 * ========================================================================= */

export interface PreparedFile {
  readonly id: string;
  readonly file: File;
  readonly mime: string;
  readonly kind: 'image' | 'video' | 'audio' | 'document';
  readonly previewUrl: string;
  readonly note: string | null;
  caption: string;
}

const MB = 1024 * 1024;
const IMAGE_OK = ['image/jpeg', 'image/png'];
const VIDEO_OK = ['video/mp4', 'video/3gpp'];
const AUDIO_OK = ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'];

function guessMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ({
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg',
  } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

async function toJpeg(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file);
    for (const [edge, quality] of [[2560, 0.86], [2048, 0.8], [1600, 0.72]] as const) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const c2d = canvas.getContext('2d');
      if (!c2d) return null;
      c2d.fillStyle = '#fff';
      c2d.fillRect(0, 0, canvas.width, canvas.height);
      c2d.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
      if (blob && blob.size <= 5 * MB) {
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** One file, made fit for WhatsApp — or the reason it cannot go. */
export async function prepareFile(file: File): Promise<PreparedFile | { error: string }> {
  const id = `f-${Math.random().toString(36).slice(2)}`;
  const mime = guessMime(file);
  const make = (f: File, m: string, kind: PreparedFile['kind'], note: string | null): PreparedFile => ({
    id, file: f, mime: m, kind, note, caption: '', previewUrl: URL.createObjectURL(f),
  });

  if (mime.startsWith('image/')) {
    if (IMAGE_OK.includes(mime) && file.size <= 5 * MB) return make(file, mime, 'image', null);
    if (mime !== 'image/gif') {
      const jpeg = await toJpeg(file);
      if (jpeg) return make(jpeg, 'image/jpeg', 'image', null);
    }
  }
  if (VIDEO_OK.includes(mime)) {
    if (file.size <= 16 * MB) return make(file, mime, 'video', null);
    return { error: `${file.name} is ${formatBytes(file.size)} — WhatsApp takes videos up to 16 MB. Trim it, or share a link.` };
  }
  if (AUDIO_OK.includes(mime) && file.size <= 16 * MB) return make(file, mime, 'audio', null);

  if (file.size > 25 * MB) return { error: `${file.name} is ${formatBytes(file.size)} — files up to 25 MB can be sent.` };
  const asFile = mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/');
  return make(file, mime, 'document', asFile ? 'WhatsApp will not show this format inline — it is sent as a file.' : null);
}

export function AttachmentPreview({
  items,
  onChange,
  onAdd,
  onSend,
  onClose,
}: {
  items: readonly PreparedFile[];
  onChange: (items: PreparedFile[]) => void;
  onAdd: () => void;
  onSend: () => void;
  onClose: () => void;
}) {
  const [current, setCurrent] = React.useState(0);
  const at = Math.min(current, items.length - 1);
  const item = items[at];

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

  if (!item) return null;
  const look = documentLook(item.file.name, item.mime);

  const remove = (id: string) => {
    const next = items.filter((i) => i.id !== id);
    if (next.length === 0) onClose();
    else onChange(next);
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-bg-surface" role="dialog" aria-label="Send files">
      <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <button type="button" onClick={onClose} aria-label="Cancel" className="grid size-8 place-items-center rounded-md text-text-secondary hover:bg-bg-subtle">
          <X className="size-5" aria-hidden="true" />
        </button>
        <p className="min-w-0 flex-1 truncate text-body-sm font-medium text-text-primary">{item.file.name}</p>
        <p className="shrink-0 text-caption text-text-secondary">{formatBytes(item.file.size)}</p>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4" style={{ background: 'var(--wa-wallpaper)' }}>
        {item.kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local object URL
          <img src={item.previewUrl} alt="" className="max-h-full max-w-full rounded-md object-contain shadow" />
        ) : item.kind === 'video' ? (
          <video src={item.previewUrl} controls playsInline className="max-h-full max-w-full rounded-md" />
        ) : item.kind === 'audio' ? (
          <audio src={item.previewUrl} controls className="w-full max-w-sm" />
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid h-24 w-20 place-items-end rounded-md pb-2 text-body-sm font-bold text-white shadow" style={{ background: look.color }}>
              {look.label}
            </span>
            <p className="max-w-xs break-all text-body-sm text-text-primary">{item.file.name}</p>
            {item.note && <p className="max-w-xs text-caption text-text-secondary">{item.note}</p>}
          </div>
        )}
      </div>

      <div className="border-t border-border-subtle px-3 py-2">
        {item.kind !== 'audio' && (
          <input
            autoFocus
            value={item.caption}
            onChange={(e) => onChange(items.map((i) => (i.id === item.id ? { ...i, caption: e.target.value.slice(0, 1024) } : i)))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Add a caption"
            className="w-full rounded-lg bg-bg-subtle px-3 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
        )}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5">
            {items.map((i, n) => (
              <div key={i.id} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setCurrent(n)}
                  className={cn('grid size-12 place-items-center overflow-hidden rounded-md border-2 bg-bg-subtle', n === at ? 'border-[#00a884]' : 'border-transparent')}
                >
                  {i.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a local object URL
                    <img src={i.previewUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <FileText className="size-5 text-text-secondary" aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => remove(i.id)}
                  aria-label={`Remove ${i.file.name}`}
                  className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-text-primary text-bg-surface"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </div>
            ))}
            {items.length < 10 && (
              <button type="button" onClick={onAdd} aria-label="Add more" className="grid size-12 shrink-0 place-items-center rounded-md border border-dashed border-border-default text-text-secondary hover:bg-bg-subtle">
                <Plus className="size-5" aria-hidden="true" />
              </button>
            )}
          </div>
          <button type="button" onClick={onSend} aria-label={`Send ${items.length}`} className="relative grid size-12 shrink-0 place-items-center rounded-full bg-[#00a884] text-white shadow hover:brightness-95">
            <Send className="size-5 translate-x-px" aria-hidden="true" />
            {items.length > 1 && (
              <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-bg-surface text-micro font-bold text-[#00a884] shadow">
                {items.length}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
