'use client';

import * as React from 'react';
import { Info, Loader2, ShieldCheck, Trash2, UserPlus, Users, X } from 'lucide-react';

import { addProjectMemberAction, removeProjectMemberAction } from '@/app/actions/projects';
import type { ProjectMemberRow } from '@/lib/db/queries/projects';
import { PROJECT_ROLE_LABEL, ROLE_LABEL, type Role } from '@/lib/domain/constants';
import { Avatar } from '@/components/ui/avatar';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WHO IS ON THIS PROJECT
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24: *"right now only Najmullah is in this team but you can see
 * how pathetic this page is and how ugly the presentation of who is right now in
 * this project is. Show a proper UI in a sleek, presentable, and more interactive
 * way. Add one button here to add some team member over here."*
 *
 * It was a bulleted list of names with a bare `<Select>` and a bin icon on each
 * row, and — for a project with one person on it — a single line of text under a
 * heading. Nothing was wrong with it except that it looked like a form, not like
 * a team.
 *
 * ── WHAT ACTUALLY MAKES THIS READ AS PEOPLE ──────────────────────────────────
 *   · A face on every row. `Avatar` already falls back to initials, so a project
 *     with nobody's photo uploaded still gets a coloured disc per person rather
 *     than a wall of text.
 *   · BOTH roles, kept apart. Somebody's rank in the division (Team Coordinator)
 *     and their job on this project (Design) are different facts that were
 *     collapsed into one label. A Coordinator can be the Design person here and
 *     the Manager elsewhere.
 *   · The owner is marked, and cannot be removed from here.
 *   · The add control is a BUTTON that opens a row, not a form permanently parked
 *     at the bottom. An always-open form is why the old panel read as data entry.
 *
 * ── ⚠️ NAMING SOMEBODY HERE GRANTS THEM SIGHT OF THE PROJECT ─────────────────
 * `app.project_is_visible` consults this table (migration 033). So this is an
 * access-control screen wearing a friendly hat, and the copy has to say so — a
 * control that silently changes who can see a client's work is one people use
 * without realising what they did.
 *
 * ── WHO MAY USE IT ───────────────────────────────────────────────────────────
 * `canManage` is `project.edit` — Coordinator and above, Member denied, and
 * `addProjectMemberAction` re-checks it server-side. A Member sees the roster and
 * no controls, which is the right amount: knowing who else is on the work is
 * useful, changing it is not theirs.
 * ========================================================================= */

export function ProjectTeamTab({
  projectId,
  ownerId,
  members,
  people,
  canManage,
  currentUser,
  onChanged,
}: {
  projectId: string;
  /** Marked in the list and never offered a Remove button. */
  ownerId: string | null;
  members: readonly ProjectMemberRow[];
  /** Everybody active in the division. Empty for a reader without
   *  `project.edit`, which is fine — they see no add control either. */
  people: readonly { id: string; name: string; role: string }[];
  canManage: boolean;
  currentUser: { id: string; role: Role };
  /** Membership changes VISIBILITY, so the whole page's data can legitimately
   *  differ afterwards — the caller re-reads from the server rather than this
   *  component patching a local copy. */
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [pick, setPick] = React.useState('');
  const [pickRole, setPickRole] = React.useState('content');

  const run = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(id);
    setNote(null);
    try {
      const result = await fn();
      if (!result.ok) setNote(result.error ?? 'That could not be saved.');
      else onChanged();
      return result.ok;
    } finally {
      setBusy(null);
    }
  };

  /* Already-named people are excluded: changing somebody's role is what their own
     row's dropdown is for, and offering them here would look like a way to add
     the same person twice. */
  const addable = people.filter((p) => !members.some((m) => m.userId === p.id));

  /* ⚠️ Owner, 2026-08-24: *"the team coordinator can assign that project to them
     himself, plus any other member can be assigned to that project."* They could
     already — the list is everybody active — but nothing SAID so, and scrolling a
     division for your own name is not obvious. This is the shortcut. */
  const meAddable = addable.some((p) => p.id === currentUser.id);

  return (
    <Card>
      <CardBody className="space-y-3 p-3.5">
        {/* ---- Heading ---- */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-body-sm font-semibold text-text-primary">
              <Users className="size-4 text-text-tertiary" strokeWidth={2} aria-hidden="true" />
              Who is on this project
              <span className="font-normal text-text-tertiary">
                {members.length === 0
                  ? ''
                  : `· ${members.length} ${members.length === 1 ? 'person' : 'people'}`}
              </span>
            </p>
          </div>

          {canManage && !adding && (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              <UserPlus className="size-4" strokeWidth={2.25} aria-hidden="true" />
              Add someone
            </Button>
          )}
        </div>

        {/* ---- What this list actually controls ---- */}
        <p
          className="flex items-start gap-2 rounded-lg px-3 py-2 text-micro text-text-secondary"
          style={{ backgroundColor: 'var(--bg-subtle)' }}
        >
          <Info className="mt-px size-3.5 shrink-0 text-text-tertiary" strokeWidth={2.25} aria-hidden="true" />
          <span>
            Anyone named here can see this project even before they hold a task on it, and is who a
            report names when it is late.
          </span>
        </p>

        {/* ---- The add row ---- */}
        {canManage && adding && (
          <div
            className="space-y-2.5 rounded-lg border p-3"
            style={{
              borderColor: 'color-mix(in oklab, var(--accent-primary) 30%, transparent)',
              backgroundColor: 'var(--bg-brand-subtle)',
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-caption font-semibold text-text-primary">Add somebody</p>
              <IconButton
                variant="ghost"
                size="sm"
                label="Cancel"
                icon={X}
                onClick={() => {
                  setAdding(false);
                  setPick('');
                }}
              />
            </div>

            {addable.length === 0 ? (
              <p className="text-caption text-text-secondary">
                Everybody active is already on this project.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Person" htmlFor="team-pick" className="basis-56 grow">
                    <Select
                      id="team-pick"
                      value={pick}
                      disabled={busy !== null}
                      options={[
                        { value: '', label: 'Choose a person…' },
                        ...addable.map((p) => ({
                          value: p.id,
                          label:
                            p.id === currentUser.id
                              ? `${p.name} (you)`
                              : `${p.name} — ${ROLE_LABEL[p.role as Role] ?? p.role}`,
                        })),
                      ]}
                      onChange={(event) => setPick(event.target.value)}
                    />
                  </Field>

                  <Field label="On this project, as" htmlFor="team-pick-role" className="basis-44">
                    <Select
                      id="team-pick-role"
                      value={pickRole}
                      disabled={busy !== null}
                      options={Object.entries(PROJECT_ROLE_LABEL).map(([value, label]) => ({
                        value,
                        label,
                      }))}
                      onChange={(event) => setPickRole(event.target.value)}
                    />
                  </Field>

                  <Button
                    variant="primary"
                    size="md"
                    disabled={busy !== null || !pick}
                    onClick={async () => {
                      const id = pick;
                      const ok = await run(id, () =>
                        addProjectMemberAction(projectId, id, pickRole),
                      );
                      if (ok) {
                        setPick('');
                        setAdding(false);
                      }
                    }}
                  >
                    {busy === pick && pick ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <UserPlus className="size-4" strokeWidth={2.25} aria-hidden="true" />
                    )}
                    Add
                  </Button>
                </div>

                {meAddable && (
                  <button
                    type="button"
                    className="text-micro font-semibold text-text-brand hover:underline"
                    onClick={() => setPick(currentUser.id)}
                  >
                    Put me on this project
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* ---- The roster ---- */}
        {members.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <span
              className="flex size-11 items-center justify-center rounded-full"
              style={{
                backgroundColor:
                  'color-mix(in oklab, var(--accent-primary) var(--tint-soft), var(--bg-surface))',
              }}
            >
              <Users className="size-5 text-text-brand" strokeWidth={1.9} aria-hidden="true" />
            </span>
            <p className="text-body-sm font-semibold text-text-primary">Nobody named yet</p>
            <p className="max-w-[32rem] text-caption text-text-secondary">
              Until somebody is, &ldquo;who is responsible for this project&rdquo; can only be
              guessed from who happens to hold a task on it.
            </p>
            {canManage && !adding && (
              <Button variant="secondary" size="sm" className="mt-1" onClick={() => setAdding(true)}>
                <UserPlus className="size-4" strokeWidth={2.25} aria-hidden="true" />
                Add the first person
              </Button>
            )}
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {members.map((m) => {
              const isOwner = m.userId === ownerId;
              const isMe = m.userId === currentUser.id;

              return (
                <li
                  key={m.userId}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border p-3',
                    'transition-[border-color,background-color] duration-[140ms]',
                    isOwner ? 'border-border-brand bg-bg-brand-subtle' : 'border-border-subtle bg-bg-subtle',
                  )}
                >
                  <Avatar name={m.fullName} src={m.avatarUrl} size="md" />

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-body-sm font-semibold text-text-primary">
                        {m.fullName}
                      </span>
                      {isMe && <span className="text-micro text-text-tertiary">(you)</span>}
                      {isOwner && (
                        <span
                          className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 text-micro font-bold"
                          style={{
                            backgroundColor:
                              'color-mix(in oklab, var(--accent-primary) var(--tint-strong), var(--bg-surface))',
                            color: 'color-mix(in oklab, var(--accent-primary) 88%, var(--text-primary))',
                          }}
                          title="Accountable for this project"
                        >
                          <ShieldCheck className="size-3" strokeWidth={2.25} aria-hidden="true" />
                          OWNER
                        </span>
                      )}
                    </div>

                    {/* Their rank in the division — a different fact from their job
                        here, and the one that decides what they may do at all. */}
                    <p className="truncate text-micro text-text-tertiary">
                      {ROLE_LABEL[m.role as Role] ?? m.role}
                      {m.addedByName && ` · added by ${m.addedByName}`}
                    </p>

                    {canManage ? (
                      <Select
                        size="sm"
                        aria-label={`${m.fullName}'s role on this project`}
                        value={m.projectRole}
                        disabled={busy !== null}
                        options={Object.entries(PROJECT_ROLE_LABEL).map(([value, label]) => ({
                          value,
                          label,
                        }))}
                        onChange={(event) =>
                          void run(m.userId, () =>
                            addProjectMemberAction(projectId, m.userId, event.target.value),
                          )
                        }
                      />
                    ) : (
                      <p className="text-caption font-medium text-text-secondary">
                        {PROJECT_ROLE_LABEL[m.projectRole] ?? m.projectRole.replace(/_/g, ' ')}
                      </p>
                    )}
                  </div>

                  {/* ⚠️ The owner has no Remove button. Taking the accountable
                      person off the project leaves it with nobody answering for
                      it while still looking complete — the owner is changed by
                      editing the project, which is where that decision belongs. */}
                  {canManage && !isOwner && (
                    <IconButton
                      variant="deleteGhost"
                      size="sm"
                      label={`Remove ${m.fullName} from this project`}
                      icon={busy === m.userId ? Loader2 : Trash2}
                      disabled={busy !== null}
                      onClick={() =>
                        void run(m.userId, () => removeProjectMemberAction(projectId, m.userId))
                      }
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {note && (
          <p className="text-caption" style={{ color: 'var(--feedback-error)' }}>
            {note}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
