'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Play, Plus, Power, Trash2, Zap } from 'lucide-react';

import {
  createChainAction,
  deleteChainAction,
  saveNodesAction,
  setChainActiveAction,
  type NodeDraft,
} from '@/app/actions/handoff';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PRIORITIES, PROJECT_TYPE_META, PROJECT_TYPES } from '@/lib/domain/constants';
import type { ChainSummary } from '@/lib/db/queries/handoff';
import type { HandoffChain } from '@/lib/domain/handoff';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE CHAIN CANVAS — UI redesign step 11
 * ----------------------------------------------------------------------------
 * The workflow reference's look: a dot-grid canvas, node cards, connectors, a
 * breadcrumb-style header. The semantics underneath are a LIST, not a graph —
 * E-004 is a pipeline (editor → designer → ads manager), and a real graph would
 * mean branch conditions, join semantics and cycle detection for a shape nobody
 * has asked for.
 *
 * Drawing it as connected cards is honest about that: they run left to right and
 * there is exactly one path, which is what the data says.
 *
 * ── THE FIRST CARD IS NOT A STEP ─────────────────────────────────────────────
 * Position 0 is the TRIGGER. It creates nothing; it names the skill whose
 * completion starts the chain. It is drawn differently for that reason — a
 * dashed edge and a different icon — because a reader who thinks it is a step
 * will expect a task to appear for it and be confused when none does.
 * ========================================================================= */

interface SkillOption {
  readonly id: string;
  readonly label: string;
}

export function WorkflowWorkspace({
  chains,
  skills,
  openChain,
  canEdit,
}: {
  chains: readonly ChainSummary[];
  skills: readonly SkillOption[];
  openChain: HandoffChain | null;
  /**
   * Admin+ may change a chain; everybody else sees it read-only (owner,
   * 2026-08-15).
   *
   * ⚠️ Hiding the controls is a COURTESY, not the enforcement. Every server
   * action calls `requireRole('admin')` and migration 026's write policy refuses
   * a Coordinator regardless — two independent layers, per doc 16 §7. If this
   * prop were wrong the worst outcome is a button that returns a readable
   * refusal, not an unauthorised write.
   */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = async (work: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (!result.ok) setError(result.error ?? 'That did not work.');
      else router.refresh();
      return result;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <Card className="border-[color-mix(in_oklab,var(--feedback-error)_45%,transparent)]">
          <CardBody className="p-3 text-caption text-text-primary">{error}</CardBody>
        </Card>
      )}

      {skills.length === 0 ? (
        <Card>
          <CardBody className="dot-grid px-6 py-14 text-center">
            <p className="text-body-sm font-semibold text-text-primary">
              There are no skills yet
            </p>
            <p className="mx-auto mt-1 max-w-[42rem] text-caption text-text-secondary">
              A chain matches work by skill, so the skills library has to exist first. Add some
              under Settings, then come back.
            </p>
          </CardBody>
        </Card>
      ) : openChain ? (
        <ChainCanvas
          chain={openChain}
          skills={skills}
          busy={busy}
          canEdit={canEdit}
          onBack={() => router.push('/workflow')}
          onSave={(drafts) => run(() => saveNodesAction(openChain.id, drafts))}
          /* ── SWITCHING ON SAVES FIRST, AND THAT IS NOT A CONVENIENCE ────────
             `setChainActiveAction` validates what is in the DATABASE, but the
             canvas shows unsaved drafts. Clicking "Switch on" after building a
             chain therefore reported "Add a trigger step to start the chain"
             while two cards sat plainly on screen — the message was true of the
             saved chain and nonsense to the person reading it.

             Persisting first makes the button mean what it appears to mean:
             "make what I am looking at live". The server still validates, so a
             chain that should not go live still cannot. */
          onToggleActive={(drafts) =>
            run(async () => {
              if (!openChain.isActive) {
                const saved = await saveNodesAction(openChain.id, drafts);
                if (!saved.ok) return saved;
              }
              return setChainActiveAction(openChain.id, !openChain.isActive);
            })
          }
        />
      ) : (
        <ChainList
          chains={chains}
          busy={busy}
          canEdit={canEdit}
          onOpen={(id) => router.push(`/workflow?chain=${id}`)}
          onCreate={(name, projectType) =>
            run(async () => {
              const result = await createChainAction({ name, projectType });
              if (result.ok && result.chainId) router.push(`/workflow?chain=${result.chainId}`);
              return result;
            })
          }
          onDelete={(id) => run(() => deleteChainAction(id))}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ChainList({
  chains,
  busy,
  canEdit,
  onOpen,
  onCreate,
  onDelete,
}: {
  chains: readonly ChainSummary[];
  busy: boolean;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onCreate: (name: string, projectType: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<string>(PROJECT_TYPES[0]);

  return (
    <div className="space-y-4">
      {/* The create row is the one thing a reader who cannot edit should not see
          at all — an input they can fill in and a button that then refuses them
          is worse than no input. The per-chain Delete is hidden for the same
          reason; Open stays, because looking is the whole point of opening it
          to everybody. */}
      <Card lit hidden={!canEdit}>
        <CardBody className="flex flex-wrap items-end gap-3 p-4">
          <Field label="New chain" htmlFor="chain-name" className="min-w-[16rem] flex-1">
            <Input
              id="chain-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Client retainer pipeline"
            />
          </Field>
          <Field label="Project type" htmlFor="chain-type" className="w-[12rem]">
            <Select
              id="chain-type"
              label="Project type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              options={PROJECT_TYPES.map((t) => ({
                value: t,
                label: PROJECT_TYPE_META[t].label,
              }))}
            />
          </Field>
          <Button
            variant="primary"
            size="md"
            disabled={busy || name.trim() === ''}
            onClick={() => onCreate(name, type)}
          >
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Create
          </Button>
        </CardBody>
      </Card>

      {chains.length === 0 ? (
        <Card>
          <CardBody className="dot-grid px-6 py-14 text-center">
            <p className="text-body-sm font-semibold text-text-primary">No chains yet</p>
            <p className="mx-auto mt-1 max-w-[42rem] text-caption text-text-secondary">
              A chain turns a finished task into the next one. Kashif finishes the reel, and the
              edit for Meta is created and assigned without anybody remembering to do it.
            </p>
          </CardBody>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {chains.map((chain) => {
            const meta = PROJECT_TYPE_META[chain.projectType];
            return (
              <li key={chain.id}>
                <Card interactive toneToken={meta.token} className="h-full">
                  <CardBody className="flex h-full flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onOpen(chain.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate text-body-sm font-semibold text-text-primary">
                          {chain.name}
                        </span>
                        <span className="mt-0.5 block text-micro text-text-tertiary">
                          {meta.label} · {chain.stepCount === 1 ? '1 step' : `${chain.stepCount} steps`}
                        </span>
                      </button>
                      <Badge token={chain.isActive ? 'feedback-success' : 'status-backlog'} size="sm">
                        {chain.isActive ? 'Live' : 'Off'}
                      </Badge>
                    </div>
                    <div className="mt-auto flex items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={() => onOpen(chain.id)}>
                        Open
                      </Button>
                      {canEdit && (
                        <IconButton
                          label="Delete this chain"
                          icon={Trash2}
                          size="sm"
                          disabled={busy}
                          onClick={() => onDelete(chain.id)}
                          className="ml-auto"
                        />
                      )}
                    </div>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ChainCanvas({
  chain,
  skills,
  busy,
  canEdit,
  onBack,
  onSave,
  onToggleActive,
}: {
  chain: HandoffChain;
  skills: readonly SkillOption[];
  busy: boolean;
  canEdit: boolean;
  onBack: () => void;
  onSave: (drafts: readonly NodeDraft[]) => void;
  onToggleActive: (drafts: readonly NodeDraft[]) => void;
}) {
  const toDraft = React.useCallback(
    (): NodeDraft[] =>
      (chain.nodes.length > 0
        ? [...chain.nodes].sort((a, b) => a.position - b.position)
        : [
            {
              id: 'seed',
              position: 0,
              skillId: skills[0]?.id ?? '',
              title: null,
              description: null,
              effortPoints: null,
              priority: 'medium' as const,
              dueOffsetDays: null,
            },
          ]
      ).map((node) => ({
        position: node.position,
        skillId: node.skillId,
        title: node.title ?? '',
        description: node.description ?? '',
        effortPoints: node.effortPoints === null ? '' : String(node.effortPoints),
        priority: node.priority,
        dueOffsetDays: node.dueOffsetDays === null ? '' : String(node.dueOffsetDays),
      })),
    [chain.nodes, skills],
  );

  const [drafts, setDrafts] = React.useState<NodeDraft[]>(toDraft);

  /* Re-seed when a different chain is opened. Keyed on the chain id rather than
     on the array, or every save would stomp the fields being edited. */
  const chainId = chain.id;
  const lastChainId = React.useRef(chainId);
  React.useEffect(() => {
    if (lastChainId.current !== chainId) {
      lastChainId.current = chainId;
      setDrafts(toDraft());
    }
  }, [chainId, toDraft]);

  const update = (index: number, patch: Partial<NodeDraft>) =>
    setDrafts((current) => current.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  const addStep = () =>
    setDrafts((current) => [
      ...current,
      {
        position: current.length,
        skillId: skills[0]?.id ?? '',
        title: '',
        description: '',
        effortPoints: '3',
        priority: 'medium',
        dueOffsetDays: '',
      },
    ]);

  const removeStep = (index: number) =>
    setDrafts((current) =>
      /* Positions must stay 0,1,2… with no gaps — `validateChain` refuses
         otherwise and so does the unique index. Renumbering here keeps the two
         in step rather than leaving the server to reject a save the UI allowed. */
      current.filter((_, i) => i !== index).map((d, i) => ({ ...d, position: i })),
    );

  const meta = PROJECT_TYPE_META[chain.projectType];

  return (
    <div className="space-y-4">
      {/* Breadcrumb header, from the reference. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="text-caption text-text-tertiary hover:text-text-primary"
        >
          Workflow
        </button>
        <span aria-hidden="true" className="text-text-disabled">
          /
        </span>
        <h2 className="text-h3 text-text-primary">{chain.name}</h2>
        <Badge token={meta.token} size="sm">
          {meta.label}
        </Badge>
        <Badge token={chain.isActive ? 'feedback-success' : 'status-backlog'} size="sm">
          {chain.isActive ? 'Live' : 'Off'}
        </Badge>

        {canEdit ? (
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              disabled={busy}
              onClick={() => onToggleActive(drafts)}
            >
              <Power className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              {chain.isActive ? 'Switch off' : 'Save & switch on'}
            </Button>
            <Button variant="primary" size="md" disabled={busy} onClick={() => onSave(drafts)}>
              Save steps
            </Button>
          </div>
        ) : (
          /* Said plainly rather than leaving the controls absent with no
             explanation — "why can I not change this" is the question an absent
             button always raises. */
          <span className="ml-auto text-micro text-text-tertiary">
            Read-only · an Admin can change this
          </span>
        )}
      </div>

      {/* ── THE CANVAS ────────────────────────────────────────────────────────
          dot-grid is the redesign's texture for exactly this: a working surface
          with no dense text on it. The cards sit ON the grid, connected left to
          right, which is the reference's arrangement and also the truth about
          the data — one path, in order. */}
      <div className="dot-grid overflow-x-auto rounded-xl border border-border-subtle p-4">
        <div className="flex min-w-max items-stretch gap-3">
          {drafts.map((draft, index) => (
            <React.Fragment key={index}>
              {index > 0 && (
                <div className="flex shrink-0 items-center" aria-hidden="true">
                  <ArrowRight className="h-5 w-5 text-text-disabled" strokeWidth={2} />
                </div>
              )}
              <NodeCard
                draft={draft}
                index={index}
                skills={skills}
                canEdit={canEdit}
                onChange={(patch) => update(index, patch)}
                onRemove={
                  canEdit && drafts.length > 1 ? () => removeStep(index) : undefined
                }
              />
            </React.Fragment>
          ))}

          {canEdit && (
            <div className="flex shrink-0 items-center">
              <Button variant="secondary" size="md" onClick={addStep} disabled={busy}>
                <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                Add step
              </Button>
            </div>
          )}
        </div>
      </div>

      <p className="text-micro text-text-tertiary">
        The first card is the <strong className="font-semibold">trigger</strong> — it creates
        nothing. When a finished task matches its skill, the chain creates the next card&rsquo;s
        task and the assignment engine picks who gets it, respecting capacity and leave. If nobody
        is a sensible fit the task is created unassigned rather than forced on somebody.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function NodeCard({
  draft,
  index,
  skills,
  canEdit,
  onChange,
  onRemove,
}: {
  draft: NodeDraft;
  index: number;
  skills: readonly SkillOption[];
  canEdit: boolean;
  onChange: (patch: Partial<NodeDraft>) => void;
  onRemove?: () => void;
}) {
  const isTrigger = index === 0;

  return (
    <div
      className={cn(
        'w-[16rem] shrink-0 rounded-xl border bg-bg-surface p-3 shadow-sm',
        isTrigger ? 'border-dashed border-border-strong' : 'border-border-default',
      )}
    >
      <div className="flex items-center gap-1.5">
        {isTrigger ? (
          <Zap className="h-3.5 w-3.5 text-text-gold" strokeWidth={2.2} aria-hidden="true" />
        ) : (
          <Play className="h-3.5 w-3.5 text-text-brand" strokeWidth={2.2} aria-hidden="true" />
        )}
        <span className="text-micro font-semibold tracking-[0.07em] text-text-tertiary uppercase">
          {isTrigger ? 'When this is finished' : `Then create · step ${index}`}
        </span>
        {onRemove && !isTrigger && (
          <IconButton
            label={`Remove step ${index}`}
            icon={Trash2}
            size="sm"
            onClick={onRemove}
            className="ml-auto"
          />
        )}
      </div>

      <div className="mt-2 space-y-2">
        <Field label="Skill" htmlFor={`skill-${index}`}>
          <Select
            id={`skill-${index}`}
            disabled={!canEdit}
            label="Skill"
            value={draft.skillId}
            onChange={(event) => onChange({ skillId: event.target.value })}
            options={skills.map((s) => ({ value: s.id, label: s.label }))}
          />
        </Field>

        {!isTrigger && (
          <>
            <Field label="Task title" htmlFor={`title-${index}`}>
              <Input
                id={`title-${index}`}
                value={draft.title}
                onChange={(event) => onChange({ title: event.target.value })}
                disabled={!canEdit}
                placeholder="Schedule across Meta + TikTok"
              />
            </Field>
            <div className="flex gap-2">
              <Field label="Effort" htmlFor={`effort-${index}`} className="flex-1">
                <Input
                  id={`effort-${index}`}
                  value={draft.effortPoints}
                  inputMode="decimal"
                  onChange={(event) => onChange({ effortPoints: event.target.value })}
                disabled={!canEdit}
                />
              </Field>
              <Field label="Due in (days)" htmlFor={`due-${index}`} className="flex-1">
                <Input
                  id={`due-${index}`}
                  value={draft.dueOffsetDays}
                  inputMode="numeric"
                  placeholder="—"
                  onChange={(event) => onChange({ dueOffsetDays: event.target.value })}
                disabled={!canEdit}
                />
              </Field>
            </div>
            <Field label="Priority" htmlFor={`priority-${index}`}>
              <Select
                id={`priority-${index}`}
                label="Priority"
                value={draft.priority}
                onChange={(event) => onChange({ priority: event.target.value })}
                disabled={!canEdit}
                options={PRIORITIES.map((p) => ({ value: p, label: p }))}
              />
            </Field>
          </>
        )}
      </div>
    </div>
  );
}
