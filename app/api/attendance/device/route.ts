import { withAppRole } from '@/lib/db/client';
import { eventsFrom, parseScan } from '@/lib/domain/hikvision';
import { isStaleScan, STALE_SCAN_DAYS, type ScanOutcome } from '@/lib/domain/attendance-device';

/* ============================================================================
 * WHERE THE WALL POSTS — owner request 2026-08-29
 * ----------------------------------------------------------------------------
 * A Hikvision DS-K1T320MFWX in the Wah office posts here every time somebody
 * scans. This is the one endpoint in the application reachable without signing
 * in, because a terminal has no account and cannot be given one.
 *
 * The URL the terminal is configured with:
 *
 *   https://taskly.aidigitaldivision.com/api/attendance/device
 *       ?serial=GB4571046&k=<the terminal's secret>
 *
 * ── ⚠️ THE SECRET IS IN THE QUERY STRING, AND THAT IS A CHOICE ──────────────
 * A header would be better — query strings end up in access logs and in
 * screenshots. But Hikvision's HTTP-listening form has fields for host, port and
 * URL, and no way to add a custom header on this firmware. A header that cannot
 * be set is not security, it is an endpoint that never works.
 *
 * So: the query string, with the consequences stated rather than hidden.
 *   · The secret is 32 random bytes, not a password, and is per-terminal.
 *   · It buys exactly one thing — the ability to file a scan — and every scan
 *     it files is recorded with its device and visible to an Admin.
 *   · It is rotatable from the admin screen without touching this code.
 * `x-device-secret` is also accepted, for a bridge, which can set headers.
 *
 * ── ⚠️ WHY THIS ALWAYS ANSWERS 200 ─────────────────────────────────────────
 * A Hikvision terminal treats a non-2xx as a failed push and, on some firmware,
 * retries in a tight loop that fills its own log and hammers this route. It does
 * NOT usefully replay a genuinely lost event either way (see the Wi-Fi note in
 * the plan), so a 500 buys nothing and costs stability.
 *
 * Every refusal is therefore a 200 carrying the reason, and the reason is what
 * gets written to `attendance_scans` — where an Admin can see it. The two
 * exceptions are a bad secret and an unknown terminal, which answer 401: those
 * are not a scan going wrong, they are somebody who should not be here.
 * ========================================================================= */

export const dynamic = 'force-dynamic';
/* Node, not Edge: `withAppRole` opens a Postgres connection. */
export const runtime = 'nodejs';

/** What a terminal is allowed to send us in one request. A real scan is under a
 *  kilobyte; a batch after an outage is larger, and a photo larger still. Past
 *  this it is not a terminal. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

interface Applied {
  readonly employeeNo: string;
  readonly outcome: ScanOutcome | 'unreadable' | 'stale';
  readonly reason?: string;
}

/**
 * ⚠️ A liveness check that needs no secret and returns no data.
 *
 * This exists to be opened in a browser from the office while somebody is
 * standing at the terminal: it answers the one question that matters first —
 * can anything on this network reach Taskly over HTTPS at all — without them
 * having to get the secret right at the same time. It says nothing about which
 * terminals are registered, so there is nothing here to learn.
 */
export async function GET(): Promise<Response> {
  return Response.json(
    { ok: true, service: 'attendance-terminal', expects: 'POST' },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const secret = (url.searchParams.get('k') ?? request.headers.get('x-device-secret') ?? '').trim();
  const serialFromUrl = (url.searchParams.get('serial') ?? '').trim();

  if (!secret) {
    return Response.json({ ok: false, error: 'No terminal secret.' }, { status: 401 });
  }

  /* ── Read the body ───────────────────────────────────────────────────────
     ⚠️ TWO CONTENT TYPES, AND THE SECOND IS THE COMMON ONE. Hikvision posts
     `application/json` for a plain event and `multipart/form-data` when it also
     attaches the photograph it captured — which is the default on a face
     terminal. Handling only JSON means it works on the bench and not on a wall. */
  let body: unknown;
  try {
    const type = request.headers.get('content-type') ?? '';

    if (type.includes('multipart/form-data')) {
      const form = await request.formData();
      /* The JSON part is named `event_log` on current firmware; older builds use
         `AccessControllerEvent`. The photograph is deliberately ignored — we do
         not need it, and storing somebody's face on every arrival is a decision
         nobody has asked for. */
      const part =
        form.get('event_log') ?? form.get('AccessControllerEvent') ?? form.get('data');
      body = typeof part === 'string' ? JSON.parse(part) : null;
    } else {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) {
        return Response.json({ ok: false, error: 'Too large.' }, { status: 413 });
      }
      body = text ? JSON.parse(text) : null;
    }
  } catch {
    /* Malformed JSON is not worth a 400 to a device that cannot read one. */
    return Response.json({ ok: true, applied: 0, note: 'Unreadable body.' }, { status: 200 });
  }

  const events = eventsFrom(body);
  if (events.length === 0) {
    return Response.json({ ok: true, applied: 0, note: 'No events.' }, { status: 200 });
  }

  const results: Applied[] = [];
  let unauthorised = false;
  /* One clock reading for the whole batch. Reading it per event would let a
     slow batch straddle the boundary and treat two identical scans differently. */
  const nowMs = Date.now();

  try {
    await withAppRole(async (tx) => {
      for (const event of events) {
        const parsed = parseScan(event);

        if (!parsed.ok) {
          /* Not attendance — a door-open, a tamper alarm, a failed recognition.
             Counted so the response is honest about what arrived, but there is
             nobody to file it against so nothing is stored. */
          results.push({ employeeNo: '—', outcome: 'unreadable', reason: parsed.reason });
          continue;
        }

        /* ── ⚠️ TOO OLD TO MATTER — SKIPPED BEFORE THE DATABASE IS TOUCHED ──
           Added 2026-08-30, minutes after the terminal was first connected: it
           immediately began replaying seven months of stored events, ~45,000 of
           them, each costing a round trip to Singapore. The database refuses
           anything over a week old anyway (`out_of_range`), so every one of
           those writes was provably pointless — and they were queued ahead of
           the scans that mattered.

           Acknowledged rather than refused, because the terminal treats a
           non-2xx as a failure worth retrying. See `STALE_SCAN_DAYS`. */
        if (isStaleScan(parsed.scan.scannedAt, nowMs)) {
          results.push({
            employeeNo: parsed.scan.employeeNo,
            outcome: 'stale',
            reason: `Older than ${STALE_SCAN_DAYS} days — too old to become attendance.`,
          });
          continue;
        }

        const serial = serialFromUrl || parsed.scan.serialNo || '';
        if (!serial) {
          results.push({
            employeeNo: parsed.scan.employeeNo,
            outcome: 'unreadable',
            reason: 'No terminal serial in the URL or the message.',
          });
          continue;
        }

        /* ⚠️ THE DATABASE VERIFIES THE SECRET, not this route. It is checked
           there because a rule enforced only in application code is one refactor
           from being enforced nowhere — see the function's own note. This route
           reads the outcome and turns a refusal into a 401. */
        const rows = await tx`
          select outcome, on_date, user_id
            from app.record_device_scan(
              ${serial},
              ${secret},
              ${parsed.scan.employeeNo},
              ${parsed.scan.scannedAt}::timestamptz,
              ${parsed.scan.dedupKey},
              ${parsed.scan.method}::public.scan_method,
              ${tx.json(event as never)}
            )
        `;

        const outcome = (rows as Array<Record<string, unknown>>)[0]?.outcome as ScanOutcome;
        results.push({ employeeNo: parsed.scan.employeeNo, outcome });
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    /* The two refusals that are about the CALLER rather than the scan. Both are
       raised as `insufficient_privilege` by `record_device_scan`. */
    if (/terminal secret is wrong|No active terminal/i.test(message)) {
      unauthorised = true;
    } else {
      /* ⚠️ Logged, not returned. The message can quote a database error, and
         this response goes to a device on a network we do not control. */
      console.error('[attendance-device] scan failed', message);
      return Response.json({ ok: false, error: 'Could not record that.' }, { status: 200 });
    }
  }

  if (unauthorised) {
    return Response.json({ ok: false, error: 'Not a known terminal.' }, { status: 401 });
  }

  /* ⚠️ The response is READ BY A PERSON, not by the device — the terminal
     ignores the body entirely. It is written for whoever is standing at the wall
     tomorrow with this open in a browser tab, which is why it names what
     happened to each scan rather than answering a bare `{ok:true}`. */
  return Response.json(
    {
      ok: true,
      received: events.length,
      applied: results.filter((r) => r.outcome === 'opened_day' || r.outcome === 'closed_day').length,
      stale: results.filter((r) => r.outcome === 'stale').length,
      results,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
