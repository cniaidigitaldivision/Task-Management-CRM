'use client';

import * as React from 'react';
import { Download, Loader2 } from 'lucide-react';

import { exportTasksAction, exportWorkloadAction } from '@/app/actions/export';
import { Button } from '@/components/ui/button';
import { downloadCsv } from '@/lib/download';

/* ============================================================================
 * CSV EXPORT BUTTON — FR-091
 * ----------------------------------------------------------------------------
 * ── THE FILE IS BUILT ON THE SERVER AND SAVED FROM A BLOB ────────────────────
 * Not a link to a download route. A route would need its own authorisation
 * check, and a second place that decides who may read what is a second place to
 * get it wrong — the action already runs under the caller's identity with RLS
 * live. The CSV comes back as a string and the browser saves it locally, so
 * nothing is ever written to a URL anybody could share.
 *
 * The saving itself now lives in `lib/download.ts`, shared with the report
 * exports — including the `URL.revokeObjectURL` call, without which every export
 * holds its blob for the life of the tab, and the UTF-8 BOM, which turned out not
 * to survive the server-action boundary at all.
 * ========================================================================= */

export function ExportButton({
  kind,
  label = 'Export CSV',
}: {
  kind: 'tasks' | 'workload';
  label?: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);

    const result = kind === 'tasks' ? await exportTasksAction() : await exportWorkloadAction();

    if (!result.ok || !result.csv || !result.fileName) {
      setError(result.error ?? 'The export could not be produced.');
      setBusy(false);
      return;
    }

    /* Was an inline Blob here. Moved to `lib/download.ts` when the report export
       needed the same thing — and that turned out to matter beyond tidiness: the
       UTF-8 BOM `toCsv` prepends does **not** survive being returned from a
       server action, so this export had silently been shipping without it since
       it was written. The shared helper writes the BOM as bytes, which is the
       only place it cannot be stripped. See that file. */
    downloadCsv(result.fileName, result.csv);

    setBusy(false);
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button variant="secondary" size="md" disabled={busy} onClick={() => void run()}>
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        )}
        {label}
      </Button>
      {error && (
        <span className="text-micro" style={{ color: 'var(--feedback-error)' }}>
          {error}
        </span>
      )}
    </span>
  );
}
