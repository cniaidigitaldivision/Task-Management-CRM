import { NextResponse } from 'next/server';

import { runDueFollowUps } from '@/lib/crm/followup-sender';
import { cronRequestIsAuthorised } from '@/lib/cron-auth';

/* ============================================================================
 * THE FOLLOW-UP SENDER — called on a timetable
 * ----------------------------------------------------------------------------
 * `vercel.json` calls this every fifteen minutes. It advances every sequence
 * that is due (the same function `pg_cron` runs) and then delivers whatever may
 * go out right now.
 *
 * ⚠️ IT REQUIRES `CRON_SECRET`, like every other scheduled route here. An open
 * endpoint that sends WhatsApp messages to clients under the business's own
 * number is not a cron job, it is a loaded gun.
 *
 * ⚠️ AND IT ANSWERS WITH WHAT IT DID, per row. "ok: true" with no detail would
 * hide the case this most needs to surface: Meta accepting nothing because a
 * template has variables nobody filled, twenty times in a row.
 * ========================================================================= */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/* Sending is network-bound and serial on purpose — one client is never messaged
   twice because two rows raced. 25 sends fit comfortably inside this. */
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronRequestIsAuthorised(request)) {
    return NextResponse.json(
      { error: process.env.CRON_SECRET ? 'Not authorised.' : 'CRON_SECRET is not configured, so the sender is disabled.' },
      { status: process.env.CRON_SECRET ? 401 : 503 },
    );
  }

  try {
    const results = await runDueFollowUps(25);
    return NextResponse.json({
      ok: true,
      due: results.length,
      sent: results.filter((r) => r.outcome === 'sent').length,
      failed: results.filter((r) => r.outcome === 'failed').length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The follow-up sender could not run.' },
      { status: 500 },
    );
  }
}
