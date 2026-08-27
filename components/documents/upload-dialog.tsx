'use client';

import * as React from 'react';
import { AlertTriangle, Cloud, HardDrive, Loader2, Lock, ShieldCheck } from 'lucide-react';

import { requestDocumentAction, type DocumentResult } from '@/app/actions/documents';
import {
  DESTINATION_META,
  DEFAULT_DESTINATION,
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
  const [state, formAction, pending] = React.useActionState(requestDocumentAction, EMPTY);
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

  /** What pressing the button will do, in the fewest words that stay true. */
  const submitLabel = toDrive
    ? 'Upload to Drive'
    : canApprove
      ? 'Upload and file it'
      : 'Send for approval';

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="Upload a document"
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
            disabled={pending || (toDrive && noDriveFolders)}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id="upload-form" action={formAction} className="space-y-4">
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
          label="File"
          htmlFor="file"
          hint={
            toDrive
              ? `Up to ${maxLabel('drive')}, written straight into the Drive folder.`
              : `Up to ${maxLabel('bucket')}. Anything larger has to go to Google Drive instead.`
          }
        >
          <input
            id="file"
            name="file"
            type="file"
            required
            className="w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-caption text-text-primary"
          />
        </Field>

        <Field label="Name" htmlFor="name" hint="Leave empty to use the file's own name.">
          <Input id="name" name="name" placeholder="ABC Traders — signed contract" />
        </Field>

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
