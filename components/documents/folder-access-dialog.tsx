'use client';

import * as React from 'react';
import { Loader2, UserPlus, X } from 'lucide-react';

import {
  listFolderGrantsAction,
  setPersonAccessAction,
  setFolderAccessAction,
} from '@/app/actions/folders';
import type { DocumentResult } from '@/app/actions/documents';
import type { DriveFolderRow } from '@/lib/db/queries/drive-folders';
import { ACCESS_META, FOLDER_ACCESS } from '@/lib/domain/folder-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

/* ============================================================================
 * WHO CAN SEE THIS FOLDER — owner request 2026-08-18
 * ----------------------------------------------------------------------------
 * *"I don't want to assign access member by member. That's fine for that but when
 * I want that specifically I can select any team member. For example Yusra, I want
 * this access, for example Rafi, I want some other access. The list of team members
 * should be displayed in some organized way."*
 *
 * Two halves, in that order, because that is the order the decision is made in:
 *
 *   EVERYONE   one level for the whole team. The common case, one control.
 *   NAMED      exceptions, added by name. The precise case, a list.
 *
 * ── GRANTS ONLY ADD, AND THE SCREEN SAYS SO ──────────────────────────────────
 * The owner chose this when asked. A named person's level is the GREATER of their
 * grant and the everyone level, so naming somebody can raise them and never lower
 * them. That is invisible in a dropdown, so when a grant is at or below the
 * everyone level the row says it is having no effect — otherwise somebody sets
 * "Yusra: can view" on a folder everyone can already view and believes they have
 * restricted her to viewing.
 * ========================================================================= */

type Person = { id: string; fullName: string; role: string };
type Grant = {
  userId: string;
  fullName: string;
  role: string;
  access: string;
  grantedByName: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  member: 'Member',
  team_coordinator: 'Team Coordinator',
  admin: 'Admin',
  super_admin: 'Super Admin',
};

export function FolderAccessDialog({
  folder,
  onClose,
  onDone,
}: {
  folder: DriveFolderRow;
  onClose: () => void;
  onDone: (result: DocumentResult) => void;
}) {
  const [grants, setGrants] = React.useState<Grant[]>([]);
  const [people, setPeople] = React.useState<Person[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState('');
  const [everyone, setEveryone] = React.useState(folder.memberAccess);

  /* Reading who has access, used on open and again after every change.
     ⚠️ Not a `useCallback` called from the effect: the React Compiler lint reads
     that as setState-inside-an-effect and refuses it, because it cannot see that
     every write here happens after an await. The effect below owns its own
     fetch and this stays a plain function for the mutation path. */
  async function refresh() {
    const result = await listFolderGrantsAction(folder.id);
    if (result.ok) {
      setGrants(result.grants);
      setPeople(result.people);
    }
  }

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await listFolderGrantsAction(folder.id);
      /* The dialog can be closed while Drive is still answering. */
      if (cancelled) return;
      if (result.ok) {
        setGrants(result.grants);
        setPeople(result.people);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [folder.id]);

  /* Somebody already named is not offered again — changing them is what the row
     is for, and a second entry would contradict the first. */
  const named = new Set(grants.map((g) => g.userId));
  const addable = people.filter((p) => !named.has(p.id));

  const run = async (key: string, fn: () => Promise<DocumentResult>) => {
    setBusy(key);
    try {
      const result = await fn();
      onDone(result);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Who can see ${folder.name}`}
      footer={
        <Button variant="ghost" size="md" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-5">
        {/* ---- Everyone ------------------------------------------------- */}
        <section className="space-y-2">
          <Field
            label="Everyone on the team"
            htmlFor="everyoneAccess"
            hint="The level every Member gets on this folder without being named below."
          >
            <Select
              id="everyoneAccess"
              value={everyone}
              disabled={busy !== null}
              options={FOLDER_ACCESS.map((level) => ({
                value: level,
                label: ACCESS_META[level].label,
              }))}
              onChange={(event) => {
                const next = event.target.value;
                setEveryone(next as typeof everyone);
                void run('everyone', () => setFolderAccessAction(folder.id, next));
              }}
            />
          </Field>
        </section>

        {/* ---- Named people --------------------------------------------- */}
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-caption font-semibold text-text-primary">Specific people</p>
            <p className="text-micro text-text-tertiary">
              {grants.length === 0 ? 'Nobody named yet' : `${grants.length} named`}
            </p>
          </div>

          <p className="text-micro text-text-tertiary">
            Naming somebody can only give them <span className="font-semibold">more</span> than
            everyone gets — never less. To keep one person out, lower the level above and name the
            people who should keep access.
          </p>

          {loading ? (
            <p className="flex items-center gap-2 py-2 text-caption text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Reading who has access…
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {grants.map((grant) => {
                /* The grant is at or below what everyone already gets, so it is
                   currently doing nothing. Said out loud — see the header. */
                const redundant =
                  FOLDER_ACCESS.indexOf(grant.access as never) <=
                  FOLDER_ACCESS.indexOf(everyone);

                return (
                  <li
                    key={grant.userId}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-body-sm text-text-primary">{grant.fullName}</p>
                      <p className="text-micro text-text-tertiary">
                        {ROLE_LABEL[grant.role] ?? grant.role}
                        {grant.grantedByName ? ` · named by ${grant.grantedByName}` : ''}
                        {redundant && (
                          <span style={{ color: 'var(--feedback-warning)' }}>
                            {' '}
                            · no effect while everyone gets this much
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Select
                        aria-label={`Access for ${grant.fullName}`}
                        value={grant.access}
                        disabled={busy !== null}
                        options={FOLDER_ACCESS.map((level) => ({
                          value: level,
                          label: level === 'none' ? 'Remove' : ACCESS_META[level].label,
                        }))}
                        onChange={(event) =>
                          void run(grant.userId, () =>
                            setPersonAccessAction(folder.id, grant.userId, event.target.value),
                          )
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        title={`Remove ${grant.fullName}`}
                        onClick={() =>
                          void run(grant.userId, () =>
                            setPersonAccessAction(folder.id, grant.userId, 'none'),
                          )
                        }
                      >
                        {busy === grant.userId ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <X className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                        )}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* ---- Add somebody ------------------------------------------- */}
          {addable.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Select
                aria-label="Add a person"
                value={adding}
                disabled={busy !== null}
                className="basis-56 grow"
                options={[
                  { value: '', label: 'Add a person…' },
                  ...addable.map((p) => ({
                    value: p.id,
                    label: `${p.fullName} · ${ROLE_LABEL[p.role] ?? p.role}`,
                  })),
                ]}
                onChange={(event) => setAdding(event.target.value)}
              />
              <Button
                variant="secondary"
                size="md"
                disabled={busy !== null || !adding}
                onClick={() => {
                  const personId = adding;
                  setAdding('');
                  /* `view` to begin with, deliberately. The dropdown on the new
                     row raises it — starting at the lowest level means a
                     mis-click adds a reader, not somebody who can delete. */
                  void run(personId, () =>
                    setPersonAccessAction(folder.id, personId, 'view'),
                  );
                }}
              >
                {busy === adding && adding ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <UserPlus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                )}
                Give access
              </Button>
            </div>
          )}
        </section>

        <p className="text-micro text-text-tertiary">
          Coordinators, Admins and the Super Admin can always see every folder, so they are not
          listed here.{' '}
          <Badge token="feedback-warning" size="sm" variant="outline">
            Access does not reach folders inside this one
          </Badge>
        </p>
      </div>
    </Dialog>
  );
}
