'use client';

import * as React from 'react';
import {
  AlertTriangle,
  Check,
  Cloud,
  HardDrive,
  Loader2,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react';

import { requestDocumentAction, type DocumentResult } from '@/app/actions/documents';
import {
  DESTINATION_META,
  DEFAULT_DESTINATION,
  MAX_BYTES,
  maxLabel,
  type UploadDestination,
} from '@/lib/domain/document-storage';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/* ============================================================================
 * UPLOAD A DOCUMENT — one form, two places that open it, TWO PLACES IT CAN GO
 * ----------------------------------------------------------------------------
 * Extracted from documents-workspace.tsx on 2026-08-24. Owner, of the project
 * page: *"when I click on Upload Assets, it will not bring me to the document
 * page. It show a popup or a modal over here… I don't want to go somewhere
 * else."*
 *
 * ── ⚠️ WHY IT MOVED RATHER THAN BEING WRITTEN AGAIN ──────────────────────────
 * The size limits, the destination rule and the approval wording all depend on
 * choices made in this form, and every one of them is a sentence that has already
 * been corrected once against what the server actually does. A second copy on the
 * project page would be a second place for each to go stale — and the one that
 * goes stale is always the copy nobody is looking at.
 *
 * ── ⚠️ THE DESTINATION IS NOW ASKED, AND IT IS THE POINT OF THIS REVISION ────
 * Owner, 2026-08-24: *"When I create and want to upload something on the document
 * page, how can I manage or select whether I want to save it in Google Drive or
 * whether it is going to be saved in the Supabase bucket?"*
 *
 * It could not be managed because nothing asked. The form had a "Drive folder"
 * picker whose hint said *"leave empty and it lands wherever the project does,
 * after approval"* — which described a flow that migration 048 had already
 * removed. So the one field that looked like it chose Drive chose only a LABEL,
 * and every upload went to the bucket regardless.
 *
 * Now the destination is a first-class radio pair, and the folder picker means
 * what it says: for a Drive upload it is where the bytes are written, and it is
 * required.
 *
 * ── ⚠️ DESTINATION AND APPROVAL ARE TWO DIFFERENT QUESTIONS ──────────────────
 * Conflating them produced an inverted permission rule once already (see
 * `requestDocumentAction`). This form keeps them apart, and states both:
 *
 *   destination 'bucket'  queues for approval unless `canApprove` — RANK decides
 *   destination 'drive'   never queues, for anybody. The queue exists so a
 *                         refused file never reaches the company Drive, and a
 *                         file written there has passed the point it protected.
 *                         Which is exactly why choosing Drive requires a folder
 *                         somebody was granted access to: the permission is
 *                         checked BEFORE the write instead of after it.
 *
 * ── `lockedProjectId` / `lockedDestination` ──────────────────────────────────
 * Same convention as `TaskDialog`: opened from inside a project, the project is
 * context rather than a question. `lockedDestination` is the same idea applied to
 * the store — the project Files tab is bucket-only by the owner's instruction, so
 * there it is shown as a stated fact and posted as a hidden field, never as a
 * control somebody can set to the thing that tab promises not to do.
 * ========================================================================= */

const EMPTY: DocumentResult = { ok: false };

/** The two destination cards. Icons chosen to be distinguishable at a glance
 *  rather than to be literal: a cloud is Drive, a disc is a store we run. */
const OPTIONS: ReadonlyArray<{
  value: UploadDestination;
  icon: typeof Cloud;
}> = [
  { value: 'bucket', icon: HardDrive },
  { value: 'drive', icon: Cloud },
];


/** One file in a batch, and how it went. */
interface Job {
  readonly file: File;
  readonly status: 'waiting' | 'uploading' | 'done' | 'failed';
  readonly error?: string;
}

/** ⚠️ Decimal MB, matching `maxLabel` — the limit is stated as 50 MB and a file
 *  shown as "49.2 MB" in binary units would be refused while looking legal. */
function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function UploadDialog({
  projects,
  folders,
  initialFolderId,
  lockedProjectId,
  lockedProjectName,
  lockedDestination,
  initialDestination,
  canApprove,
  driveConnected,
  onClose,
  onDone,
}: {
  /** Set when the dialog is opened from inside a project. The project stops
   *  being a dropdown and becomes a stated fact — see the header. */
  lockedProjectId?: string;
  lockedProjectName?: string;
  /** Set to remove the choice entirely. The project Files tab passes `'bucket'`:
   *  owner, 2026-08-24 — *"the file which is uploaded over there will only be
   *  saved in the bucket. It will not be saved in Google Drive."* */
  lockedDestination?: UploadDestination;
  /** Which option starts selected, when the choice is still offered. The folder
   *  browser passes `'drive'`: pressing "upload here" inside a Google Drive folder
   *  means *there*, and defaulting that to private storage would file a file the
   *  person believes they put in Drive somewhere else entirely. Still changeable —
   *  a default, not a lock. Ignored when `driveConnected` is false. */
  initialDestination?: UploadDestination;
  projects: ReadonlyArray<{ id: string; name: string }>;
  /** Already narrowed by the caller to the folders this person may file into. The
   *  server checks it again — this only keeps the list honest.
   *
   *  ⚠️ The old `direct` flag is gone. It meant "choosing this sends the file to
   *  Drive with no approval", which stopped being true of the FOLDER when the
   *  destination became its own field: it is now true of the destination, for
   *  everybody, and saying it per-folder would contradict the picker above it. */
  folders: ReadonlyArray<{ id: string; name: string }>;
  /** Pre-chosen when the upload was started from inside a folder. */
  initialFolderId: string | null;
  /** Whether THIS person's bucket upload skips the queue. `document.approve` —
   *  Coordinator and above. Passed in rather than inferred from a role string so
   *  the button label and the server can never disagree about what happens. */
  canApprove: boolean;
  /** Whether Drive is configured AND somebody has connected it. Both are needed
   *  for a write to succeed, so the option is offered only when both hold — a
   *  radio that always fails is worse than one that explains itself. */
  driveConnected: boolean;
  onClose: () => void;
  onDone: (result: DocumentResult) => void;
}) {
  /* ── ⚠️ ONE REQUEST PER FILE, NOT ONE REQUEST WITH MANY FILES ─────────────
     Owner, 2026-09-08: *"It just lets me upload only one file at a time, which
     is not a good approach… if any client shares with me some documents,
     obviously there must be a list of documents. Uploading documents one by one
     is very hectic."*

     The obvious change — `multiple` on the input and a loop on the server —
     breaks on the first real batch. `serverActions.bodySizeLimit` is 52mb,
     sized for ONE file at the 50mb ceiling; ten client documents in a single
     POST exceed it and the whole batch fails with a message about the request
     rather than about any file. Worse, one refused file would take the other
     nine down with it.

     So the batch is a client-side loop over the SAME server action, unchanged:
     each file is its own request, each gets its own verdict, and a file that is
     too large or of a refused type does not cost the others. `requestDocumentAction`
     is not touched by this feature at all — which is also why the Documents page,
     which shares this dialog, keeps working exactly as before.

     ⚠️ SEQUENTIAL, NOT `Promise.all`. Ten parallel 50mb uploads from an office
     connection is how every one of them times out; and the queue reads as
     progress, which a scatter of spinners does not. */
  const [state, setState] = React.useState<DocumentResult>(EMPTY);
  const [pending, setPending] = React.useState(false);
  const [queue, setQueue] = React.useState<readonly Job[]>([]);
  const formRef = React.useRef<HTMLFormElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const seen = React.useRef(false);
  const [folderId, setFolderId] = React.useState(initialFolderId ?? '');
  const [destination, setDestination] = React.useState<UploadDestination>(
    /* ⚠️ `driveConnected` gates the initial value as well as the radio, or the
       form would open pre-set to an option it also renders as unavailable — and
       the person would have to notice and change it to get anywhere. */
    lockedDestination ??
      (initialDestination === 'drive' && driveConnected ? 'drive' : DEFAULT_DESTINATION),
  );

  const toDrive = destination === 'drive';
  /* Drive needs a folder to write into and this person may have access to none.
     Said before they choose, not after they press the button. */
  const noDriveFolders = folders.length === 0;

  React.useEffect(() => {
    if (state.ok && !seen.current) {
      seen.current = true;
      onDone(state);
    }
  }, [state, onDone]);

  /* What the person picked, with each file's fate beside it. Rebuilt on every
     selection so choosing a new set clears the previous run's verdicts. */
  const chooseFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    setQueue(picked.map((file) => ({ file, status: 'waiting' as const })));
    setState(EMPTY);
    seen.current = false;
  };

  const limit = MAX_BYTES[destination];
  const tooBig = queue.filter((job) => job.file.size > limit);

  /* ⚠️ THE FILES STILL WORTH SENDING. On a retry that is the ones that failed;
     on a first run it is everything picked. A file already accepted is never
     sent again — the server would file a second copy, and the person pressed
     the button to fix the failures, not to duplicate the successes. */
  const failedOnce = queue.some((job) => job.status === 'failed');
  const outstanding = queue.filter((job) =>
    failedOnce ? job.status === 'failed' : job.status !== 'done',
  );

  const upload = async () => {
    const form = formRef.current;
    if (!form || pending || outstanding.length === 0) return;

    /* ⚠️ READ ONCE, BEFORE THE LOOP. The other fields — destination, project,
       folder, note — are the same for every file in the batch, and reading them
       from the DOM inside the loop would let a re-render between two uploads
       change what the rest of the batch is filed as. */
    const shared = new FormData(form);
    const single = outstanding.length === 1;

    setPending(true);
    setState(EMPTY);

    let uploaded = 0;
    const failures: string[] = [];

    for (const job of outstanding) {
      setQueue((prev) =>
        prev.map((q) => (q.file === job.file ? { ...q, status: 'uploading', error: undefined } : q)),
      );

      const body = new FormData();
      for (const [key, value] of shared.entries()) {
        /* The file input's own entries are dropped — this loop supplies them
           one at a time — and so is the typed name unless there is exactly one
           file left to send. One name across ten documents would file ten rows
           under the same title, which is worse than the filenames they came
           with. */
        if (key === 'file') continue;
        if (key === 'name' && !single) continue;
        body.append(key, value);
      }
      body.set('file', job.file);

      let result: DocumentResult;
      try {
        result = await requestDocumentAction(EMPTY, body);
      } catch {
        result = { ok: false, error: 'The upload did not reach the server.' };
      }

      if (result.ok) uploaded += 1;
      else failures.push(job.file.name);

      setQueue((prev) =>
        prev.map((q) =>
          q.file === job.file
            ? { ...q, status: result.ok ? 'done' : 'failed', error: result.error }
            : q,
        ),
      );
    }

    setPending(false);

    /* ⚠️ THE DIALOG ONLY CLOSES WHEN EVERYTHING LANDED. A partial batch that
       closed itself would report "3 of 5 uploaded" in a toast and leave nobody
       able to say WHICH two — the list stays on screen with the reasons, and
       the button becomes a retry for exactly those. */
    if (failures.length === 0) {
      setState({
        ok: true,
        message:
          uploaded === 1
            ? 'The file was uploaded.'
            : `${uploaded} files were uploaded.`,
      });
      return;
    }

    setState({
      ok: false,
      error:
        uploaded > 0
          ? `${uploaded} uploaded, ${failures.length} refused. The ones below say why.`
          : 'Nothing was uploaded. Each file below says why.',
    });
  };

  /** What pressing the button will do, in the fewest words that stay true. */
  const submitLabel = (() => {
    /* A retry names the failures, because after a partial batch that is the
       only thing the button still does. */
    if (failedOnce) {
      return outstanding.length === 1 ? 'Retry that file' : `Retry ${outstanding.length} files`;
    }
    const many = outstanding.length > 1 ? ` ${outstanding.length} files` : '';
    if (toDrive) return `Upload${many} to Drive`;
    return canApprove ? `Upload${many} and file` : `Send${many} for approval`;
  })();

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={queue.length > 1 ? `Upload ${queue.length} documents` : 'Upload a document'}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="upload-form"
            disabled={pending || outstanding.length === 0 || (toDrive && noDriveFolders)}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id="upload-form"
        ref={formRef}
        /* Submitting runs the batch. `preventDefault` because there is no single
           request to make — see `upload`. */
        onSubmit={(event) => {
          event.preventDefault();
          void upload();
        }}
        className="space-y-4"
      >
        {!state.ok && state.error && (
          <p
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-error)' }}
          >
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            {state.error}
          </p>
        )}

        {/* ══ WHERE IT GOES — FIRST, BECAUSE EVERYTHING BELOW DEPENDS ON IT ═══
            The size limit, whether the folder is required, and whether there is
            an approval step all follow from this answer, so asking it after those
            fields would mean re-reading them. */}
        {lockedDestination ? (
          <Field
            label="Where it goes"
            hint="This tab files into private storage only, by design."
          >
            <div className="flex h-9 items-center gap-2 rounded-lg border border-border-subtle bg-bg-subtle px-3">
              <Lock className="size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
              <span className="truncate text-body-sm text-text-primary">
                {DESTINATION_META[lockedDestination].label}
              </span>
              <span className="truncate text-micro text-text-tertiary">
                {DESTINATION_META[lockedDestination].consequence}
              </span>
            </div>
            <input type="hidden" name="destination" value={lockedDestination} />
          </Field>
        ) : (
          <fieldset className="space-y-1.5">
            {/* A `legend` rather than a `Field` label: this is a group of radios,
                and a `<label for>` pointing at one of two inputs would announce
                the group's name as belonging to the first option. */}
            <legend className="block text-caption font-semibold text-text-primary">
              Where it goes
            </legend>

            <div className="grid gap-2 sm:grid-cols-2">
              {OPTIONS.map((option) => {
                const meta = DESTINATION_META[option.value];
                /* Only Drive can be unavailable, and for one reason: nobody has
                   connected it. Disabling it silently would read as a bug. */
                const blocked = option.value === 'drive' && !driveConnected;
                const active = destination === option.value;
                const Icon = option.icon;

                return (
                  <label
                    key={option.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-xl border p-3',
                      'transition-[border-color,background-color] duration-[140ms]',
                      active
                        ? 'border-border-brand bg-bg-selected'
                        : 'border-border-subtle hover:border-border-strong',
                      blocked && 'cursor-not-allowed opacity-55',
                    )}
                  >
                    <input
                      type="radio"
                      name="destination"
                      value={option.value}
                      checked={active}
                      disabled={blocked}
                      onChange={() => setDestination(option.value)}
                      className="mt-0.5 size-3.5 shrink-0 accent-[var(--accent-primary)]"
                    />
                    <span className="min-w-0 space-y-0.5">
                      <span className="flex items-center gap-1.5 text-body-sm font-semibold text-text-primary">
                        <Icon
                          className={cn('size-3.5 shrink-0', active && 'text-text-brand')}
                          strokeWidth={2.25}
                          aria-hidden="true"
                        />
                        {meta.label}
                      </span>
                      <span className="block text-micro leading-snug text-text-secondary">
                        {blocked
                          ? 'Not connected. An Admin connects it in Drive settings.'
                          : meta.consequence}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {/* The hint follows the destination, because the limit genuinely differs:
            a file going to Drive never passes through this system's storage or its
            50 MB project ceiling. Both numbers come from the same module the
            server enforces them from — see lib/domain/document-storage.ts. */}
        <Field
          label={queue.length > 1 ? `Files — ${queue.length} chosen` : 'Files'}
          htmlFor="file"
          hint={
            toDrive
              ? `Pick as many as you like. Up to ${maxLabel('drive')} each, written straight into the Drive folder.`
              : `Pick as many as you like. Up to ${maxLabel('bucket')} each — anything larger has to go to Google Drive instead.`
          }
        >
          <input
            id="file"
            name="file"
            type="file"
            /* ⚠️ THE WHOLE FEATURE IS THIS ATTRIBUTE PLUS THE LOOP THAT READS
               IT. Every file still travels in its own request — see the note on
               `upload` — so nothing about the server or its size limit changes. */
            multiple
            required={queue.length === 0}
            ref={fileRef}
            onChange={(event) => chooseFiles(event.target.files)}
            className="w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-caption text-text-primary"
          />
        </Field>

        {queue.length > 0 && (
          <ul className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border-subtle p-1.5">
            {queue.map((job) => {
              const over = job.file.size > MAX_BYTES[destination];
              return (
                <li
                  key={`${job.file.name}-${job.file.size}-${job.file.lastModified}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5"
                >
                  {job.status === 'uploading' ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-text-tertiary" aria-hidden="true" />
                  ) : job.status === 'done' ? (
                    <Check
                      className="size-3.5 shrink-0"
                      style={{ color: 'var(--feedback-success)' }}
                      strokeWidth={2.5}
                      aria-hidden="true"
                    />
                  ) : job.status === 'failed' || over ? (
                    <X
                      className="size-3.5 shrink-0"
                      style={{ color: 'var(--feedback-error)' }}
                      strokeWidth={2.5}
                      aria-hidden="true"
                    />
                  ) : (
                    <span className="size-3.5 shrink-0" aria-hidden="true" />
                  )}

                  <span className="min-w-0 flex-1 truncate text-caption text-text-primary">
                    {job.file.name}
                  </span>

                  <span className="shrink-0 text-micro tabular-nums text-text-tertiary">
                    {sizeLabel(job.file.size)}
                  </span>

                  {/* The reason, on the row it belongs to. A batch's failures in
                      one banner at the top cannot say which file each refers to. */}
                  {(job.error || over) && (
                    <span
                      className="w-full shrink-0 pl-5 text-micro"
                      style={{ color: 'var(--feedback-error)' }}
                    >
                      {job.error ?? `Larger than ${maxLabel(destination)}.`}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* ⚠️ CHECKED BEFORE ANYTHING IS SENT. The server refuses an oversize
            file too, but only after it has been uploaded — on an office
            connection that is minutes spent to be told no. */}
        {tooBig.length > 0 && (
          <p
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-warning)' }}
          >
            <AlertTriangle className="mt-px size-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            {tooBig.length === 1
              ? `One file is larger than ${maxLabel(destination)} and will be refused.`
              : `${tooBig.length} files are larger than ${maxLabel(destination)} and will be refused.`}
          </p>
        )}

        {/* ⚠️ ONE NAME ONLY MAKES SENSE FOR ONE FILE. With a batch it would
            file every row under the same title, so the field goes and each
            document keeps the name it arrived with. */}
        {queue.length <= 1 && (
          <Field label="Name" htmlFor="name" hint="Leave empty to use the file's own name.">
            <Input id="name" name="name" placeholder="ABC Traders — signed contract" />
          </Field>
        )}

        {/* ⚠️ Locked, not merely pre-selected. Owner, 2026-08-24: *"make sure
            that the task, upload assets, and everything will be assigned by
            default to that specific project… If I'm in AI Digital Dividend, by
            default these things will all go there."* A pre-selected dropdown
            still lets somebody file a client's asset against the wrong project
            from a page titled with the right one, which is the mistake worth
            making impossible rather than merely unlikely. */}
        {lockedProjectId ? (
          <Field label="Project" hint="Where you opened this from. It files here.">
            <div className="flex h-9 items-center gap-2 rounded-lg border border-border-subtle bg-bg-subtle px-3">
              <Lock className="size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
              <span className="truncate text-body-sm text-text-primary">
                {lockedProjectName ?? 'This project'}
              </span>
            </div>
            <input type="hidden" name="projectId" value={lockedProjectId} />
          </Field>
        ) : (
          <Field
            label="Project"
            htmlFor="projectId"
            hint="Filing it against a project is what lets that project's people see it."
          >
            <Select
              id="projectId"
              name="projectId"
              options={[
                { value: '', label: 'Not tied to a project' },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </Field>
        )}

        {/* ── ⚠️ THE SAME PICKER MEANS TWO DIFFERENT THINGS, SO IT SAYS WHICH ──
            For a Drive upload it is the folder the bytes are WRITTEN INTO, and it
            is required — the server refuses without one rather than dropping the
            file at the top of somebody's My Drive, where a file goes to be lost.
            For a bucket upload nothing is written to Drive at all, so it is
            filing metadata: which registry folder this belongs under.

            Hidden entirely when there are no folders to offer, which is the case
            on the project page. */}
        {toDrive && noDriveFolders ? (
          <p
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-warning)' }}
          >
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            There is no Drive folder you can write into, so nothing can be sent there. Ask a Team
            Coordinator for upload access to a folder, or keep the file in this system&rsquo;s
            storage.
          </p>
        ) : (
          folders.length > 0 && (
            <Field
              label={toDrive ? 'Drive folder' : 'File it under'}
              htmlFor="folderId"
              hint={
                toDrive
                  ? 'Required. This is the folder the file is written into.'
                  : 'Optional, and only a label — nothing is written to Drive on this route.'
              }
            >
              <Select
                id="folderId"
                name="folderId"
                required={toDrive}
                value={folderId}
                onChange={(event) => setFolderId(event.target.value)}
                options={[
                  {
                    value: '',
                    label: toDrive ? 'Choose a folder…' : 'No folder',
                  },
                  ...folders.map((f) => ({ value: f.id, label: f.name })),
                ]}
              />
            </Field>
          )
        )}

        <Field label="Note" htmlFor="description" hint="Anything the approver should know.">
          <Input id="description" name="description" />
        </Field>

        {/* ── ⚠️ THE FOOTNOTE FOLLOWS BOTH CHOICES, NOT ONE ─────────────────
            It has been wrong twice. "Nothing reaches Google Drive before
            approval" was true when every upload queued; then it became "you have
            upload access to that folder, so this goes into Google Drive
            immediately", which described a Drive write the code had stopped
            doing. It now reads off the destination AND the rank, which are the
            only two things that decide what happens. */}
        <p className="flex items-start gap-2 border-t border-border-subtle pt-3 text-micro leading-relaxed text-text-tertiary">
          <ShieldCheck className="mt-px size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          <span>
            {toDrive
              ? 'This goes into the company Google Drive as soon as you press the button. There is no approval step and no undo here — the file is owned by the connected Drive account afterwards.'
              : canApprove
                ? "It is filed immediately in this system's private storage — your rank means it needs no approval. Nothing is sent to Google Drive."
                : "It is held in this system's private storage until a Team Coordinator or Admin accepts it. Accepting it does not move it, and nothing is sent to Google Drive."}
          </span>
        </p>
      </form>
    </Dialog>
  );
}
