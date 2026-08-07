'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';

import {
  resetSettingAction,
  updateSettingAction,
  type SettingsActionResult,
} from '@/app/actions/settings';
import { StepUpDialog } from '@/components/security/step-up-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardToolbar } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { ScoreWeights } from '@/lib/domain/constants';
import {
  SETTING_DEFINITIONS,
  type SettingDefinition,
  type SettingKey,
  type SettingValue,
} from '@/lib/domain/settings';
import { cn } from '@/lib/utils';

/* ============================================================================
 * EDITABLE SETTINGS
 * ----------------------------------------------------------------------------
 * ── EACH FIELD SAVES ITSELF, AND SAYS WHETHER IT IS A DEFAULT ────────────────
 * No single Save button at the foot. These are eighteen unrelated numbers, and
 * one button implies a transaction across all of them that does not exist — a
 * rejected combination would then leave somebody guessing which field caused it.
 *
 * Each shows whether it is the shipped default or something this workspace
 * changed, with a reset beside the overridden ones. Without that, nobody can
 * tell an inherited value from a deliberate decision six months later.
 *
 * ── A REFUSAL FOR STEP-UP IS NOT AN ERROR ────────────────────────────────────
 * The server answers `stepUpRequired` rather than failing, the challenge opens,
 * and the same edit is retried on success. Making somebody find the field again
 * turns a security control into an annoyance, and annoying controls get routed
 * around.
 * ========================================================================= */

const GROUP_TITLES: Record<SettingDefinition['group'], string> = {
  capacity: 'Capacity and thresholds',
  timers: 'Timers and time limits',
  security: 'Security',
  scoring: 'Assignment scoring',
};

type Pending = { key: SettingKey; value: unknown } | null;

export function SettingsWorkspace({
  values,
  overriddenKeys,
  editableKeys,
}: {
  values: Record<SettingKey, SettingValue>;
  overriddenKeys: readonly string[];
  /** Keys this actor's role may change. The rest render read-only. */
  editableKeys: readonly string[];
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<SettingsActionResult | null>(null);
  const [pendingEdit, setPendingEdit] = React.useState<Pending>(null);
  const [stepUpFor, setStepUpFor] = React.useState<SettingDefinition | null>(null);

  const save = React.useCallback(
    async (definition: SettingDefinition, value: unknown) => {
      setBusyKey(definition.key);
      const result = await updateSettingAction(definition.key, value);

      if (result.stepUpRequired) {
        /* Hold the edit, open the challenge, replay it on success. */
        setPendingEdit({ key: definition.key, value });
        setStepUpFor(definition);
        setBusyKey(null);
        return;
      }

      setNote(result);
      if (result.ok) router.refresh();
      setBusyKey(null);
    },
    [router],
  );

  const reset = async (definition: SettingDefinition) => {
    setBusyKey(definition.key);
    const result = await resetSettingAction(definition.key);
    if (result.stepUpRequired) {
      setPendingEdit(null);
      setStepUpFor(definition);
      setBusyKey(null);
      return;
    }
    setNote(result);
    if (result.ok) router.refresh();
    setBusyKey(null);
  };

  const groups: SettingDefinition['group'][] = ['capacity', 'timers', 'security', 'scoring'];

  return (
    <div className="space-y-6">
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

      {groups.map((group) => {
        const definitions = SETTING_DEFINITIONS.filter((d) => d.group === group);
        if (definitions.length === 0) return null;

        return (
          <Card key={group}>
            <CardToolbar title={GROUP_TITLES[group]} />
            <ul className="divide-y divide-border-subtle">
              {definitions.map((definition) => (
                <li key={definition.key} className="px-5 py-3.5">
                  {definition.kind === 'weights' ? (
                    <WeightsRow
                      definition={definition}
                      value={values.scoringWeights as ScoreWeights}
                      editable={editableKeys.includes(definition.key)}
                      overridden={overriddenKeys.includes(definition.key)}
                      busy={busyKey === definition.key}
                      onSave={(next) => void save(definition, next)}
                      onReset={() => void reset(definition)}
                    />
                  ) : (
                    <ScalarRow
                      definition={definition}
                      value={values[definition.key]}
                      editable={editableKeys.includes(definition.key)}
                      overridden={overriddenKeys.includes(definition.key)}
                      busy={busyKey === definition.key}
                      onSave={(next) => void save(definition, next)}
                      onReset={() => void reset(definition)}
                    />
                  )}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}

      <StepUpDialog
        open={stepUpFor !== null}
        actionLabel={stepUpFor ? `Changing “${stepUpFor.label}”` : 'This change'}
        onClose={() => {
          setStepUpFor(null);
          setPendingEdit(null);
        }}
        onConfirmed={() => {
          const definition = stepUpFor;
          const edit = pendingEdit;
          setStepUpFor(null);
          setPendingEdit(null);
          if (!definition) return;
          if (edit) void save(definition, edit.value);
          else void reset(definition);
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * One number, or one switch
 * ------------------------------------------------------------------------- */

function ScalarRow({
  definition,
  value,
  editable,
  overridden,
  busy,
  onSave,
  onReset,
}: {
  definition: SettingDefinition;
  value: SettingValue;
  editable: boolean;
  overridden: boolean;
  busy: boolean;
  onSave: (next: unknown) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = React.useState(String(value));

  /* Adopt a fresh server value without an effect — the same pattern the task
     board uses. An effect would paint the stale number first. */
  const [lastValue, setLastValue] = React.useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(String(value));
  }

  const dirty = definition.kind === 'integer' && draft !== String(value);

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="min-w-[14rem] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-caption font-semibold text-text-primary">{definition.label}</p>
          {overridden ? (
            <Badge token="accent-gold" size="sm" variant="outline">
              Changed here
            </Badge>
          ) : (
            <Badge token="neutral-500" size="sm" variant="outline">
              Default
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-micro text-text-tertiary">{definition.help}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {definition.kind === 'boolean' ? (
          <Button
            variant={value ? 'primary' : 'secondary'}
            size="sm"
            disabled={!editable || busy}
            onClick={() => onSave(!value)}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {value ? 'On' : 'Off'}
          </Button>
        ) : (
          <>
            <Input
              type="number"
              size="sm"
              min={definition.min}
              max={definition.max}
              value={draft}
              disabled={!editable || busy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && dirty) onSave(Number(draft));
              }}
              className="w-24 text-right"
              aria-label={definition.label}
            />
            {definition.unit && (
              <span className="w-16 text-micro text-text-tertiary">{definition.unit}</span>
            )}
            <Button
              variant="secondary"
              size="sm"
              disabled={!editable || busy || !dirty}
              onClick={() => onSave(Number(draft))}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Save
            </Button>
          </>
        )}

        {overridden && editable && (
          <IconButton
            label={`Reset ${definition.label} to the shipped default`}
            icon={RotateCcw}
            size="sm"
            disabled={busy}
            onClick={onReset}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * The six weights, which must total exactly 100%
 * ------------------------------------------------------------------------- */

const WEIGHT_LABELS: Record<keyof ScoreWeights, string> = {
  skill: 'Skill match',
  availability: 'Availability',
  deadlineFit: 'Deadline fit',
  fairness: 'Fairness',
  performance: 'Past performance',
  projectFamiliarity: 'Project familiarity',
};

function WeightsRow({
  definition,
  value,
  editable,
  overridden,
  busy,
  onSave,
  onReset,
}: {
  definition: SettingDefinition;
  value: ScoreWeights;
  editable: boolean;
  overridden: boolean;
  busy: boolean;
  onSave: (next: ScoreWeights) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(Object.entries(value).map(([k, v]) => [k, Math.round(v * 100)])),
  );

  const [lastValue, setLastValue] = React.useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, Math.round(v * 100)])));
  }

  const total = Object.values(draft).reduce((sum, n) => sum + n, 0);
  const balanced = total === 100;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-caption font-semibold text-text-primary">{definition.label}</p>
        {overridden ? (
          <Badge token="accent-gold" size="sm" variant="outline">
            Changed here
          </Badge>
        ) : (
          <Badge token="neutral-500" size="sm" variant="outline">
            Default
          </Badge>
        )}
      </div>
      <p className="text-micro text-text-tertiary">{definition.help}</p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(Object.keys(WEIGHT_LABELS) as Array<keyof ScoreWeights>).map((weightKey) => (
          <label key={weightKey} className="flex items-center gap-2">
            <span className="min-w-[8.5rem] flex-1 text-micro text-text-secondary">
              {WEIGHT_LABELS[weightKey]}
            </span>
            <Input
              type="number"
              size="sm"
              min={0}
              max={100}
              value={draft[weightKey] ?? 0}
              disabled={!editable || busy}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, [weightKey]: Number(event.target.value) }))
              }
              className="w-20 text-right"
              aria-label={WEIGHT_LABELS[weightKey]}
            />
            <span className="text-micro text-text-tertiary">%</span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn('tabular text-caption font-semibold')}
          style={{ color: balanced ? 'var(--feedback-success)' : 'var(--feedback-error)' }}
        >
          Total {total}%
        </span>
        {!balanced && (
          <span className="text-micro text-text-secondary">
            Has to be exactly 100. They once totalled 105 and inflated every recommendation by 5%
            without anybody noticing (C-06).
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {overridden && editable && (
            <IconButton
              label="Reset the weights to the shipped defaults"
              icon={RotateCcw}
              size="sm"
              disabled={busy}
              onClick={onReset}
            />
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={!editable || busy || !balanced}
            onClick={() =>
              onSave(
                Object.fromEntries(
                  Object.entries(draft).map(([k, v]) => [k, v / 100]),
                ) as unknown as ScoreWeights,
              )
            }
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Save weights
          </Button>
        </div>
      </div>
    </div>
  );
}
