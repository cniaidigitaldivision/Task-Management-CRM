import 'server-only';

import { withUser } from '../client';

/* ============================================================================
 * THE WHATSAPP CONVERSATION — reads and writes behind the chat's menus
 * ----------------------------------------------------------------------------
 * Every one runs as the person, so 138's policy decides: a message on a lead the
 * caller cannot see matches no row, and the answer is "not found" rather than an
 * error that says which ids exist. Who reacted, pinned or deleted is stamped by
 * the database from the session (184's trigger), never passed in.
 * ========================================================================= */

export interface LeadForSending {
  readonly id: string;
  readonly phoneE164: string | null;
  readonly projectId: string;
  readonly projectName: string;
}

/** The four facts a send needs — without the notes, timeline and siblings. */
export async function leadForSending(actorId: string, leadId: string): Promise<LeadForSending | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select l.id, l.phone_e164, l.project_id, app.crm_project_name(l.project_id) as project_name
      from public.crm_leads l
     where l.id = ${leadId}::uuid
  `);
  const r = (rows as Array<Record<string, unknown>>)[0];
  return r
    ? {
        id: String(r.id),
        phoneE164: (r.phone_e164 as string | null) ?? null,
        projectId: String(r.project_id),
        projectName: String(r.project_name ?? 'this project'),
      }
    : null;
}

export interface MessageForAction {
  readonly id: string;
  readonly leadId: string;
  readonly waMessageId: string | null;
  readonly direction: 'inbound' | 'outbound';
  readonly kind: string;
  readonly body: string | null;
  readonly mediaId: string | null;
  readonly mediaPath: string | null;
  readonly mediaMime: string | null;
  readonly mediaFilename: string | null;
  readonly mediaVoice: boolean;
  readonly occurredAt: string;
  readonly hidden: boolean;
  readonly channel: string;
}

export async function messageForAction(actorId: string, messageId: string): Promise<MessageForAction | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select m.id, m.lead_id, m.wa_message_id, m.direction::text, m.kind::text, m.body,
           m.media_id, m.media_path, m.media_mime, m.media_filename, m.media_voice,
           m.occurred_at, (m.hidden_at is not null) as hidden, m.channel::text
      from public.crm_lead_messages m
     where m.id = ${messageId}::uuid
  `);
  const r = (rows as Array<Record<string, unknown>>)[0];
  if (!r) return null;
  return {
    id: String(r.id),
    leadId: String(r.lead_id),
    waMessageId: (r.wa_message_id as string | null) ?? null,
    direction: r.direction === 'inbound' ? 'inbound' : 'outbound',
    kind: String(r.kind),
    body: (r.body as string | null) ?? null,
    mediaId: (r.media_id as string | null) ?? null,
    mediaPath: (r.media_path as string | null) ?? null,
    mediaMime: (r.media_mime as string | null) ?? null,
    mediaFilename: (r.media_filename as string | null) ?? null,
    mediaVoice: r.media_voice === true,
    occurredAt: new Date(r.occurred_at as string).toISOString(),
    hidden: r.hidden === true,
    channel: String(r.channel),
  };
}

export async function recordOutboundMessage(
  actorId: string,
  input: {
    leadId: string;
    wamid: string | null;
    kind: 'text' | 'image' | 'video' | 'audio' | 'document';
    body: string | null;
    mediaId?: string | null;
    mediaPath?: string | null;
    mediaMime?: string | null;
    mediaFilename?: string | null;
    mediaSize?: number | null;
    mediaVoice?: boolean;
    replyToWamid?: string | null;
    forwarded?: boolean;
    error?: string | null;
  },
): Promise<string | null> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.crm_lead_messages
      (lead_id, wa_message_id, direction, kind, body, media_id, media_path, media_mime,
       media_filename, media_size, media_voice, reply_to_wamid, forwarded,
       status, status_at, error_detail, sent_by_id, occurred_at)
    values (
      ${input.leadId}::uuid, ${input.wamid}, 'outbound', ${input.kind}::public.crm_message_kind,
      ${input.body}, ${input.mediaId ?? null}, ${input.mediaPath ?? null}, ${input.mediaMime ?? null},
      ${input.mediaFilename ?? null}, ${input.mediaSize ?? null}, ${input.mediaVoice ?? false},
      ${input.replyToWamid ?? null}, ${input.forwarded ?? false},
      /* ── ⚠️ NO WAMID MEANS IT DID NOT GO, WHATEVER ELSE WE WERE TOLD ───────
         Found on 2026-09-18 in the Lareeb Testing thread: a row with status
         'sent', no error, and **no WhatsApp message id**. Meta returns an id on
         every accepted message, so a row without one never reached a handset —
         and this table said it had.

         The path in: the error arrives as an EMPTY STRING rather than null (??
         does not catch it, so a refusal Meta described with a blank detail fell
         through both guards), and an empty string is falsy, so the row was
         written 'sent'. The status now depends on the id as well, which is the
         fact that cannot be faked.

         ⚠️ NO BACKTICKS IN THIS COMMENT: the query is a JS template literal and
         one would end the string. Third time today. */
      ${input.error || !input.wamid ? 'failed' : 'sent'}::public.crm_message_status, now(),
      ${input.error?.trim() || (input.wamid ? null : 'WhatsApp returned no message id, so it was not delivered.')},
      ${actorId}::uuid, now()
    )
    on conflict (wa_message_id) do nothing
    returning id
  `);
  return ((rows as unknown as Array<{ id: string }>)[0]?.id) ?? null;
}

/** One column at a time; RLS and 184's trigger decide the rest. */
export async function setOurReaction(actorId: string, messageId: string, emoji: string | null): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_lead_messages set our_reaction = ${emoji}
     where id = ${messageId}::uuid and hidden_at is null
    returning id
  `);
  return (rows as unknown[]).length === 1;
}

export async function setPinned(actorId: string, messageId: string, pinned: boolean): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_lead_messages set pinned_at = case when ${pinned} then now() else null end
     where id = ${messageId}::uuid and hidden_at is null
    returning id
  `);
  return (rows as unknown[]).length === 1;
}

export async function hideMessage(actorId: string, messageId: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_lead_messages set hidden_at = now(), pinned_at = null
     where id = ${messageId}::uuid and hidden_at is null
    returning id
  `);
  return (rows as unknown[]).length === 1;
}

export async function setStar(actorId: string, messageId: string, starred: boolean): Promise<boolean> {
  return withUser(actorId, async (tx) => {
    if (starred) {
      const rows = await tx`
        insert into public.crm_message_stars (message_id, user_id)
        select m.id, ${actorId}::uuid from public.crm_lead_messages m
         where m.id = ${messageId}::uuid and m.hidden_at is null
        on conflict do nothing
        returning message_id
      `;
      const exists = await tx`select 1 from public.crm_message_stars where message_id = ${messageId}::uuid and user_id = ${actorId}::uuid`;
      return (rows as unknown[]).length === 1 || (exists as unknown[]).length === 1;
    }
    await tx`delete from public.crm_message_stars where message_id = ${messageId}::uuid and user_id = ${actorId}::uuid`;
    return true;
  });
}

/* ── Forward targets ────────────────────────────────────────────────────── */

export interface ForwardTarget {
  readonly id: string;
  readonly name: string;
  readonly projectName: string;
  readonly phone: string | null;
  /** The client wrote within 24 hours, so free text and media will be delivered. */
  readonly windowOpen: boolean;
}

export async function forwardTargets(actorId: string, query: string, excludeLeadId: string): Promise<ForwardTarget[]> {
  const q = query.trim();
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await withUser(actorId, (tx) => tx`
    select l.id, l.full_name, l.phone_e164, app.crm_project_name(l.project_id) as project_name,
           exists (select 1 from public.crm_lead_messages m
                    where m.lead_id = l.id and m.direction = 'inbound'
                      and m.created_at > now() - interval '24 hours') as window_open,
           (select max(m.occurred_at) from public.crm_lead_messages m where m.lead_id = l.id) as last_at
      from public.crm_leads l
     where l.id <> ${excludeLeadId}::uuid
       and l.phone_e164 is not null
       and l.stage not in ('won', 'lost')
       and (${q} = '' or l.full_name ilike ${like} or l.phone_e164 ilike ${like})
     order by last_at desc nulls last, l.submitted_at desc
     limit 20
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.full_name ?? 'Name not given'),
    projectName: String(r.project_name ?? ''),
    phone: (r.phone_e164 as string | null) ?? null,
    windowOpen: r.window_open === true,
  }));
}

/* ── Saved replies ──────────────────────────────────────────────────────── */

export interface SavedReply {
  readonly id: string;
  readonly scope: 'team' | 'personal';
  readonly title: string;
  readonly shortcut: string | null;
  readonly body: string;
  /** May this person change it? A team reply is a manager's. */
  readonly editable: boolean;
}

export interface SavedReplies {
  readonly replies: readonly SavedReply[];
  readonly canWriteTeam: boolean;
}

export async function listSavedReplies(actorId: string): Promise<SavedReplies> {
  return withUser(actorId, async (tx) => {
    const [rows, team] = await Promise.all([
      tx`
        select id, scope, title, shortcut, body, created_by_id
          from public.crm_saved_replies
         order by (scope = 'personal') desc, sort_order, title
      `,
      tx`select app.crm_writes_team_replies() as ok`,
    ]);
    const canWriteTeam = (team as unknown as Array<{ ok: boolean }>)[0]?.ok === true;
    return {
      canWriteTeam,
      replies: (rows as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id),
        scope: r.scope === 'team' ? 'team' : 'personal',
        title: String(r.title),
        shortcut: (r.shortcut as string | null) ?? null,
        body: String(r.body),
        editable: r.scope === 'team' ? canWriteTeam : String(r.created_by_id) === actorId,
      })),
    };
  });
}

export async function saveSavedReply(
  actorId: string,
  input: { id: string | null; scope: 'team' | 'personal'; title: string; shortcut: string | null; body: string },
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) =>
    input.id
      ? tx`
          update public.crm_saved_replies
             set scope = ${input.scope}, title = ${input.title}, shortcut = ${input.shortcut},
                 body = ${input.body}, updated_at = now()
           where id = ${input.id}::uuid
          returning id
        `
      : tx`
          insert into public.crm_saved_replies (scope, title, shortcut, body, created_by_id)
          values (${input.scope}, ${input.title}, ${input.shortcut}, ${input.body}, ${actorId}::uuid)
          returning id
        `,
  );
  return (rows as unknown[]).length === 1;
}

export async function deleteSavedReply(actorId: string, id: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    delete from public.crm_saved_replies where id = ${id}::uuid returning id
  `);
  return (rows as unknown[]).length === 1;
}
