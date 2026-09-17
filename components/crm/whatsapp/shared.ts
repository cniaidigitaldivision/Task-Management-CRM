import type { CrmMessage } from '@/lib/db/queries/crm-leads';

/* ============================================================================
 * THE WHATSAPP CHAT — small shared rules
 * ----------------------------------------------------------------------------
 * Time in Karachi, file sizes, which icon a file wears, the 24-hour window, and
 * saved-reply placeholders. Pure, so the bubble, the composer and the menus can
 * never disagree about any of them.
 * ========================================================================= */

const TZ = 'Asia/Karachi';

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
}

export function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}

/** "Today", "Yesterday", a weekday within the week, then the full date — as WhatsApp does. */
export function dayLabel(iso: string, nowMs = Date.now()): string {
  const days = Math.round((Date.parse(dayKey(new Date(nowMs).toISOString())) - Date.parse(dayKey(iso))) / 86_400_000);
  const at = new Date(iso);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return at.toLocaleDateString('en-GB', { weekday: 'long', timeZone: TZ });
  const part = (o: Intl.DateTimeFormatOptions, locale = 'en-GB') => at.toLocaleDateString(locale, { ...o, timeZone: TZ });
  return `${part({ day: 'numeric' })} ${part({ month: 'long' }, 'en-US')} ${part({ year: 'numeric' })}`;
}

/** "Today at 4:22 PM" / "12 Sep at 4:22 PM" — Message info's form. */
export function momentLabel(iso: string, nowMs = Date.now()): string {
  const d = dayLabel(iso, nowMs);
  return `${d === 'Today' || d === 'Yesterday' ? d : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: TZ })} at ${timeOf(iso)}`;
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type MediaShape = 'image' | 'video' | 'voice' | 'audio' | 'document' | 'sticker' | 'none';

export function mediaShape(m: Pick<CrmMessage, 'kind' | 'mediaMime' | 'mediaVoice' | 'mediaId' | 'mediaFilename'>): MediaShape {
  const mime = (m.mediaMime ?? '').split(';')[0].toLowerCase();
  if (m.kind === 'sticker') return 'sticker';
  if (m.kind === 'image' || mime === 'image/jpeg' || mime === 'image/png') return 'image';
  if (m.kind === 'video' || mime === 'video/mp4' || mime === 'video/3gpp') return 'video';
  if (m.kind === 'audio' || mime.startsWith('audio/')) {
    return m.mediaVoice || mime === 'audio/ogg' ? 'voice' : 'audio';
  }
  if (m.kind === 'document' || m.mediaId || m.mediaFilename) return 'document';
  return 'none';
}

/** Which colour and label a document card wears. */
export function documentLook(filename: string | null, mime: string | null): { label: string; color: string } {
  const ext = (filename?.split('.').pop() ?? '').toLowerCase();
  const m = (mime ?? '').toLowerCase();
  if (ext === 'pdf' || m === 'application/pdf') return { label: 'PDF', color: '#e5252a' };
  if (['doc', 'docx'].includes(ext) || m.includes('word')) return { label: 'DOC', color: '#2b579a' };
  if (['xls', 'xlsx', 'csv'].includes(ext) || m.includes('sheet') || m.includes('excel')) return { label: ext === 'csv' ? 'CSV' : 'XLS', color: '#217346' };
  if (['ppt', 'pptx'].includes(ext) || m.includes('presentation') || m.includes('powerpoint')) return { label: 'PPT', color: '#d24726' };
  if (['zip', 'rar', '7z'].includes(ext)) return { label: ext.toUpperCase(), color: '#7c6f64' };
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(ext)) return { label: ext.toUpperCase(), color: '#0e7490' };
  if (['mp4', 'mov', 'webm', '3gp'].includes(ext)) return { label: ext.toUpperCase(), color: '#7c3aed' };
  if (ext === 'txt') return { label: 'TXT', color: '#64748b' };
  return { label: (ext || 'FILE').slice(0, 4).toUpperCase(), color: '#64748b' };
}

export function mediaUrl(messageId: string, download = false): string {
  return `/api/whatsapp/media/${messageId}${download ? '?download=1' : ''}`;
}

/** One line for a message, used in quotes, the pinned bar and the All view. */
export function snippet(m: Pick<CrmMessage, 'body' | 'kind' | 'mediaMime' | 'mediaVoice' | 'mediaId' | 'mediaFilename' | 'hiddenAt'>): string {
  if (m.hiddenAt) return 'This message was deleted';
  const shape = mediaShape(m);
  const body = m.body?.trim();
  if (shape === 'image') return body ? `📷 ${body}` : '📷 Photo';
  if (shape === 'video') return body ? `🎥 ${body}` : '🎥 Video';
  if (shape === 'voice') return '🎤 Voice message';
  if (shape === 'audio') return `🎵 ${m.mediaFilename ?? 'Audio'}`;
  if (shape === 'sticker') return 'Sticker';
  if (shape === 'document') return `📄 ${m.mediaFilename ?? 'Document'}`;
  if (m.kind === 'location') return '📍 Location';
  if (m.kind === 'contacts') return '👤 Contact';
  return body || 'Message';
}

/**
 * The 24-hour window — WhatsApp's rule, from our own records.
 *
 * ⚠️ FROM THE CLIENT'S LAST MESSAGE, NEVER OURS, and never inferred from whether
 * Meta accepted the last send: the test number accepts free text a day and a half
 * late, and a real number does not (see memory "the WhatsApp test number lies").
 */
export function whatsAppWindow(thread: readonly CrmMessage[], nowMs: number): { open: boolean; closesAt: number | null } {
  let last = 0;
  for (const m of thread) {
    if (m.channel === 'whatsapp' && m.direction === 'inbound') last = Math.max(last, Date.parse(m.occurredAt));
  }
  if (!last) return { open: false, closesAt: null };
  const closesAt = last + 24 * 3_600_000;
  return { open: closesAt > nowMs, closesAt };
}

export interface ReplyVariables {
  readonly myName: string;
  readonly leadName: string | null;
  readonly company: string;
  readonly project: string;
}

export const PLACEHOLDERS: ReadonlyArray<{ token: string; label: string }> = [
  { token: '{{my_first_name}}', label: 'My first name' },
  { token: '{{my_name}}', label: 'My full name' },
  { token: '{{lead_first_name}}', label: "Client's first name" },
  { token: '{{lead_name}}', label: "Client's full name" },
  { token: '{{company}}', label: 'Business name' },
  { token: '{{project}}', label: 'Project' },
];

/** Fill a saved reply for the person using it and the client it goes to. */
export function fillReply(body: string, v: ReplyVariables): string {
  const first = (s: string | null) => (s ?? '').trim().split(/\s+/)[0] ?? '';
  const values: Record<string, string> = {
    my_first_name: first(v.myName) || v.myName,
    my_name: v.myName,
    lead_first_name: first(v.leadName) || 'Sir/Madam',
    lead_name: v.leadName?.trim() || 'Sir/Madam',
    company: v.company,
    project: v.project,
  };
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, key: string) => values[key] ?? all);
}
