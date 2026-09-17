import { describe, expect, it } from 'vitest';

import type { CrmMessage } from '@/lib/db/queries/crm-leads';
import { dayLabel, documentLook, fillReply, mediaShape, snippet, whatsAppWindow } from '@/components/crm/whatsapp/shared';

const msg = (o: Partial<CrmMessage>): CrmMessage => ({
  id: 'm', direction: 'inbound', kind: 'text', body: 'hi', mediaId: null, mediaMime: null, mediaFilename: null,
  status: 'delivered', errorDetail: null, sentByName: null, occurredAt: '2026-09-17T05:00:00.000Z', channel: 'whatsapp',
  subject: null, waMessageId: null, replyToWamid: null, ourReaction: null, theirReaction: null, pinnedAt: null,
  pinnedByName: null, hiddenAt: null, hiddenByName: null, deliveredAt: null, readAt: null, playedAt: null,
  mediaSize: null, mediaVoice: false, forwarded: false, starred: false, ...o,
});

describe('fillReply — one saved reply, filled for whoever uses it', () => {
  const body = 'AoA Sir, welcome on behalf of {{company}}. I am {{my_first_name}}. Hi {{ lead_first_name }}!';
  it('uses the sender and the client', () => {
    expect(fillReply(body, { myName: 'Sarah Khan', leadName: 'Faisal Rehman', company: 'CNI AI & Digital Division', project: 'Demo' }))
      .toBe('AoA Sir, welcome on behalf of CNI AI & Digital Division. I am Sarah. Hi Faisal!');
    expect(fillReply(body, { myName: 'Sahad', leadName: 'Faisal Rehman', company: 'Chitral Royal Homes', project: 'Chitral' }))
      .toContain('I am Sahad');
  });
  it('never prints an empty name, and leaves an unknown placeholder visible', () => {
    expect(fillReply('Hi {{lead_first_name}} {{nope}}', { myName: 'Sarah', leadName: null, company: 'X', project: 'Y' }))
      .toBe('Hi Sir/Madam {{nope}}');
  });
});

describe('whatsAppWindow — from the client’s last message, never ours', () => {
  const now = Date.parse('2026-09-17T12:00:00.000Z');
  it('is open for 24 hours after they write', () => {
    const w = whatsAppWindow([msg({ occurredAt: '2026-09-17T02:00:00.000Z' })], now);
    expect(w.open).toBe(true);
    expect(w.closesAt).toBe(Date.parse('2026-09-18T02:00:00.000Z'));
  });
  it('does not reopen when WE write', () => {
    const w = whatsAppWindow(
      [msg({ occurredAt: '2026-09-15T02:00:00.000Z' }), msg({ direction: 'outbound', occurredAt: '2026-09-17T11:00:00.000Z' })],
      now,
    );
    expect(w.open).toBe(false);
  });
  it('ignores email', () => {
    expect(whatsAppWindow([msg({ channel: 'email', occurredAt: '2026-09-17T11:00:00.000Z' })], now).open).toBe(false);
  });
});

describe('media shapes and one-line snippets', () => {
  it('knows a voice note from an audio file', () => {
    expect(mediaShape(msg({ kind: 'audio', mediaMime: 'audio/ogg', mediaVoice: true }))).toBe('voice');
    expect(mediaShape(msg({ kind: 'audio', mediaMime: 'audio/mpeg' }))).toBe('audio');
    expect(mediaShape(msg({ kind: 'image', mediaMime: 'image/png' }))).toBe('image');
    expect(mediaShape(msg({ kind: 'document', mediaMime: 'application/pdf', mediaFilename: 'x.pdf' }))).toBe('document');
    expect(mediaShape(msg({}))).toBe('none');
  });
  it('never repeats a deleted message’s words', () => {
    expect(snippet(msg({ hiddenAt: '2026-09-17T05:00:00.000Z', body: 'secret price' }))).toBe('This message was deleted');
    expect(snippet(msg({ kind: 'audio', mediaMime: 'audio/ogg', mediaVoice: true, body: null }))).toBe('🎤 Voice message');
  });
  it('colours a PDF red and a sheet green', () => {
    expect(documentLook('Price list.pdf', null).label).toBe('PDF');
    expect(documentLook('plan.xlsx', null).color).toBe('#217346');
  });
  it('labels days the way WhatsApp does, in Karachi', () => {
    const now = Date.parse('2026-09-17T12:00:00.000Z');
    expect(dayLabel('2026-09-17T01:00:00.000Z', now)).toBe('Today');
    expect(dayLabel('2026-09-16T12:00:00.000Z', now)).toBe('Yesterday');
    expect(dayLabel('2026-09-01T12:00:00.000Z', now)).toBe('1 September 2026');
  });
});
