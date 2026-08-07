'use client';

import * as React from 'react';
import { Download, Loader2 } from 'lucide-react';

import { exportTasksAction, exportWorkloadAction } from '@/app/actions/export';
import { Button } from '@/components/ui/button';

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
 * `URL.revokeObjectURL` matters more than it looks: without it every export
 * holds its blob in memory for the life of the tab, and somebody exporting
 * repeatedly through an afternoon leaks all of them.
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

    const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

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
