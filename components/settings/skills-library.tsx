'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Archive, CheckCircle2, Loader2, Pencil, Plus, RotateCcw } from 'lucide-react';

import {
  createSkillAction,
  renameSkillAction,
  setSkillActiveAction,
  type SettingsActionResult,
} from '@/app/actions/settings';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';

/* ============================================================================
 * SKILLS LIBRARY — FR-017
 * ----------------------------------------------------------------------------
 * ── RETIRED, NEVER DELETED, AND THE COUNT IS WHY ─────────────────────────────
 * Each row shows how many people hold the skill. That number is the argument:
 * deleting a skill six people are rated on would erase the ratings with it, and
 * those ratings are the history the assignment engine's matching reads. The
 * database refuses it anyway — `user_skills` references `skills` with ON DELETE
 * RESTRICT — so offering a delete button would be offering an action that fails.
 *
 * Retiring stops it being offered on new work and leaves every existing rating
 * intact.
 *
 * ── THE SLUG IS NOT EDITABLE ─────────────────────────────────────────────────
 * It is the stable identifier the keyword matcher keys off. The label — the part
 * anybody actually reads — is free to change.
 * ========================================================================= */

export interface SkillRow {
  id: string;
  slug: string;
  label: string;
  category: string | null;
  keywords: string[];
  isActive: boolean;
  holders: number;
}

const EMPTY: SettingsActionResult = { ok: false };

export function SkillsLibrary({
  skills,
  canEdit,
}: {
  skills: readonly SkillRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<SkillRow | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<SettingsActionResult | null>(null);

  const active = skills.filter((s) => s.isActive);
  const retired = skills.filter((s) => !s.isActive);

  const run = async (id: string, fn: () => Promise<SettingsActionResult>) => {
    setBusyId(id);
    const result = await fn();
    setNote(result);
    if (result.ok) router.refresh();
    setBusyId(null);
  };

  const byCategory = new Map<string, SkillRow[]>();
  for (const skill of active) {
    const key = skill.category ?? 'Uncategorised';
    byCategory.set(key, [...(byCategory.get(key) ?? []), skill]);
  }

  return (
    <div className="space-y-4">
      {note && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border px-4 py-3"
          style={
            note.ok
              ? {
                  borderColor: 'color-mix(in oklab, var(--feedback-success) 35%, transparent)',
                  backgroundColor:
                    'color-mix(in oklab, var(--feedback-success) var(--tint-soft), var(--bg-surface))',
                }
              : {
                  borderColor: 'color-mix(in oklab, var(--feedback-error) 35%, transparent)',
                  backgroundColor:
                    'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
                }
          }
        >
          {note.ok ? (
            <CheckCircle2
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-success)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
          ) : (
            <AlertTriangle
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-error)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
          )}
          <p className="text-caption text-text-primary">{note.note ?? note.error}</p>
        </div>
      )}

      {canEdit && (
        <div className="flex justify-end">
          <Button variant="primary" size="md" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            Add a skill
          </Button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[...byCategory.entries()].map(([category, list]) => (
          <Card key={category}>
            <div className="border-b border-border-subtle px-4 py-2.5">
              <p className="text-caption font-semibold text-text-primary">{category}</p>
            </div>
            <ul className="divide-y divide-border-subtle">
              {list.map((skill) => (
                <li key={skill.id} className="flex items-center gap-2 px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-caption text-text-primary">{skill.label}</p>
                    <p className="text-micro text-text-tertiary">
                      {skill.holders === 0
                        ? 'Nobody rated yet'
                        : `${skill.holders} ${skill.holders === 1 ? 'person' : 'people'} rated`}
                    </p>
                  </div>
                  {canEdit && (
                    <>
                      <IconButton
                        label={`Edit ${skill.label}`}
                        icon={Pencil}
                        size="sm"
                        disabled={busyId === skill.id}
                        onClick={() => setEditing(skill)}
                      />
                      <IconButton
                        label={`Retire ${skill.label}`}
                        icon={Archive}
                        size="sm"
                        disabled={busyId === skill.id}
                        onClick={() => void run(skill.id, () => setSkillActiveAction(skill.id, false))}
                      />
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      {retired.length > 0 && (
        <Card>
          <div className="border-b border-border-subtle px-4 py-2.5">
            <p className="text-caption font-semibold text-text-primary">
              Retired
              <span className="ml-1.5 text-micro font-normal text-text-tertiary">
                still counted on anybody already rated
              </span>
            </p>
          </div>
          <ul className="divide-y divide-border-subtle">
            {retired.map((skill) => (
              <li key={skill.id} className="flex items-center gap-2 px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-caption text-text-tertiary">
                  {skill.label}
                </span>
                <Badge token="neutral-500" size="sm" variant="outline">
                  {skill.holders} rated
                </Badge>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === skill.id}
                    onClick={() => void run(skill.id, () => setSkillActiveAction(skill.id, true))}
                  >
                    {busyId === skill.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                    )}
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AddSkillDialog open={adding} onClose={() => setAdding(false)} />
      {editing && (
        <EditSkillDialog
          skill={editing}
          onClose={() => setEditing(null)}
          onSaved={(result) => {
            setNote(result);
            setEditing(null);
            if (result.ok) router.refresh();
          }}
        />
      )}
    </div>
  );
}

function AddSkillDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = React.useActionState(createSkillAction, EMPTY);

  React.useEffect(() => {
    if (state.ok) {
      router.refresh();
      onClose();
    }
  }, [state.ok, onClose, router]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Add a skill"
      description="What somebody can be rated on, and what a task can ask for."
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="add-skill" variant="primary" size="md" disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Add it
          </Button>
        </>
      }
    >
      <form id="add-skill" action={formAction} className="space-y-4">
        {state.error && (
          <p
            role="alert"
            className="rounded-lg px-3 py-2.5 text-caption text-text-primary"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
              border: '1px solid color-mix(in oklab, var(--feedback-error) 32%, transparent)',
            }}
          >
            {state.error}
          </p>
        )}

        <Field label="Name" htmlFor="label">
          <Input id="label" name="label" placeholder="Motion Graphics" required autoFocus />
        </Field>

        <Field label="Category" htmlFor="category" hint="Groups it on this screen. Optional.">
          <Input id="category" name="category" placeholder="Creative" />
        </Field>

        <Field
          label="Keywords"
          htmlFor="keywords"
          hint="Comma separated. Used to match a task to this skill when nobody has tagged it explicitly (FR-055)."
        >
          <Input id="keywords" name="keywords" placeholder="motion, animation, after effects" />
        </Field>
      </form>
    </Dialog>
  );
}

function EditSkillDialog({
  skill,
  onClose,
  onSaved,
}: {
  skill: SkillRow;
  onClose: () => void;
  onSaved: (result: SettingsActionResult) => void;
}) {
  const [label, setLabel] = React.useState(skill.label);
  const [category, setCategory] = React.useState(skill.category ?? '');
  const [keywords, setKeywords] = React.useState(skill.keywords.join(', '));
  const [busy, setBusy] = React.useState(false);

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Edit ${skill.label}`}
      description={`${skill.holders} ${skill.holders === 1 ? 'person is' : 'people are'} rated on this.`}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={busy || !label.trim()}
            onClick={async () => {
              setBusy(true);
              onSaved(
                await renameSkillAction(skill.id, {
                  label,
                  category: category || null,
                  keywords: keywords.split(','),
                }),
              );
              setBusy(false);
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="edit-label">
          <Input
            id="edit-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            autoFocus
          />
        </Field>

        <Field label="Category" htmlFor="edit-category">
          <Input
            id="edit-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
        </Field>

        <Field label="Keywords" htmlFor="edit-keywords" hint="Comma separated.">
          <Input
            id="edit-keywords"
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
          />
        </Field>

        <p className="text-micro text-text-tertiary">
          The identifier <span className="font-mono">{skill.slug}</span> stays fixed — the matcher
          keys off it, and renaming it would orphan those references while the label you read is
          free to change.
        </p>
      </div>
    </Dialog>
  );
}
