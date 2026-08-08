'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { EFFORT_POINTS, STATUS_META, TASK_STATUSES, type TaskStatus } from '@/lib/domain/constants';
import type { TaskView } from '@/lib/view/task-view';
import { cn } from '@/lib/utils';

import { TaskCard } from './task-card';

/* ============================================================================
 * TASK BOARD — Kanban, doc 10 §3
 * ----------------------------------------------------------------------------
 * Eight columns in status order, drag between them to change status.
 *
 * ── WHY THIS NO LONGER USES HTML5 DRAG-AND-DROP ──────────────────────────────
 * Owner instruction, Session 17: *"if I drag and drop it, it should fit into the
 * next column… it should push the other ones down… like a magnet is pulling it
 * towards it. I don't want it flickering around, I don't know where it is going.
 * And I don't want it to blur — I want the task to remain as it is."*
 *
 * Every one of those is impossible with the native `draggable` API, and not
 * because it was used badly:
 *
 *   · the browser renders its own translucent drag image from a snapshot of the
 *     element and there is no way to style it — that IS the "blur"
 *   · `dragover` fires on a coarse timer, not per frame, so the feedback lags
 *     the pointer, which is the "flickering around"
 *   · there is no drop position, only a drop TARGET — so the card can be told
 *     which column it is going to and never where in it
 *   · nothing about it is animatable, so cards cannot make room
 *
 * So this is pointer events, and the three pieces that make it feel physical:
 *
 *   1. THE CARD IN YOUR HAND is a fixed-position copy following the pointer at
 *      full opacity. It is the real card, lifted — not a ghost of it.
 *   2. THE GAP is a real element in the column at the exact index it will land,
 *      so the cards below genuinely move out of the way.
 *   3. FLIP makes that movement smooth. Measure every card before the gap moves,
 *      measure again after, apply the inverse transform, then release it to
 *      zero. The browser animates the difference. Without this the cards jump.
 *
 * On release the floating card animates to the gap rather than vanishing from
 * one place and appearing in another — that is the magnet.
 *
 * ── WHAT IS PERSISTED, AND WHAT IS NOT ───────────────────────────────────────
 * The STATUS is. `onMove` writes it, exactly as before.
 *
 * The position WITHIN a column is not, and cannot be yet: there is no ordering
 * column on `tasks` (only `checklist_items.sort_order` exists). `onReorder`
 * hands the new order to the workspace, which already holds the task array in
 * client state — so the card stays where it was dropped for the session and
 * returns to its natural order on reload. Making that survive a reload is a
 * migration, and migrations are not started without permission (rule R1).
 *
 * ── ACCESSIBILITY ────────────────────────────────────────────────────────────
 * Native drag-and-drop was never keyboard-operable either, so this is not a
 * regression — but it is still a gap, and it is recorded as one rather than
 * quietly left. Cards remain focusable and Enter still opens the detail drawer,
 * where the status can be changed from a real `<select>`.
 * ========================================================================= */

/** How far the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 5;
/** A touch must be held this long first, or the board could never be scrolled. */
const TOUCH_HOLD_MS = 220;
/** Shared by the gap opening, the FLIP shuffle and the drop flight. */
const MOTION_MS = 200;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

interface DragState {
  readonly taskId: string;
  readonly from: TaskStatus;
  /** Pointer offset inside the card, so it does not jump to its own corner. */
  readonly grabX: number;
  readonly grabY: number;
  readonly width: number;
  readonly height: number;
  /** Where the card started, for the flight home when a drop is refused. */
  readonly originX: number;
  readonly originY: number;
  readonly x: number;
  readonly y: number;
}

interface DropTarget {
  readonly status: TaskStatus;
  readonly index: number;
}

export function TaskBoard({
  tasks,
  onMove,
  onReorder,
  canMove,
  onOpen,
  selectedIds,
  onToggleSelect,
}: {
  tasks: readonly TaskView[];
  onMove: (taskId: string, to: TaskStatus) => void;
  /** Optional. Given the visible task IDs in their new order after a drop.
   *
   *  IDs and not tasks, deliberately. `onMove` owns the status and rolls it back
   *  if the server refuses; if this handed back whole task objects built from
   *  this render's `tasks`, applying them would resurrect the pre-move status
   *  and undo that rollback. A permutation of IDs cannot. */
  onReorder?: (orderedIds: readonly string[]) => void;
  /** Returns null when the move is allowed, or the reason it is refused. */
  canMove: (task: TaskView, to: TaskStatus) => string | null;
  onOpen?: (taskId: string) => void;
  /** Selection is optional: omit both and the board has no checkboxes at all. */
  selectedIds?: readonly string[];
  onToggleSelect?: (taskId: string) => void;
}) {
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [target, setTarget] = React.useState<DropTarget | null>(null);
  /** Set for the duration of the flight, so the card animates instead of cutting. */
  const [landing, setLanding] = React.useState<{ x: number; y: number } | null>(null);

  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const columnRefs = React.useRef(new Map<TaskStatus, HTMLElement>());
  const cardRefs = React.useRef(new Map<string, HTMLElement>());
  const gapRef = React.useRef<HTMLDivElement>(null);
  /** Card rects captured immediately before the gap moves — the "First" of FLIP. */
  const priorRects = React.useRef(new Map<string, DOMRect>());

  /* Mirrors of the two pieces of drag state, written synchronously beside every
     setState. The pointer handlers run outside React's render cycle and need
     the CURRENT value — reading it from an effect-synced ref would be one frame
     behind, and reading it inside a state updater would mean doing side effects
     in an updater, which React may run twice. */
  const dragRef = React.useRef<DragState | null>(null);
  const targetRef = React.useRef<DropTarget | null>(null);

  const dragged = drag ? tasks.find((t) => t.id === drag.taskId) : undefined;

  /* ── FLIP: make the cards that moved slide instead of jump ──────────────────
     Runs after every render in which the gap changed position. `useLayoutEffect`
     and not `useEffect`, because the inverse transform has to be applied in the
     same frame the browser lays the new positions out — one frame later and the
     jump has already been painted. */
  React.useLayoutEffect(() => {
    if (!drag) return;
    const frames: number[] = [];

    cardRefs.current.forEach((element, id) => {
      const prior = priorRects.current.get(id);
      if (!prior) return;

      const now = element.getBoundingClientRect();
      const dx = prior.left - now.left;
      const dy = prior.top - now.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

      element.style.transition = 'none';
      element.style.transform = `translate(${dx}px, ${dy}px)`;

      frames.push(
        requestAnimationFrame(() => {
          element.style.transition = `transform ${MOTION_MS}ms ${EASE}`;
          element.style.transform = '';
        }),
      );
    });

    return () => frames.forEach(cancelAnimationFrame);
  }, [target?.status, target?.index, drag]);

  /** The "First" half of FLIP. Call before any state change that moves cards. */
  const captureRects = React.useCallback(() => {
    const captured = new Map<string, DOMRect>();
    cardRefs.current.forEach((element, id) => {
      captured.set(id, element.getBoundingClientRect());
    });
    priorRects.current = captured;
  }, []);

  /* ── Where would it land, given where the pointer is? ───────────────────────
     The column is whichever one the pointer is horizontally inside. The index
     is found by comparing against each card's vertical MIDPOINT — the standard
     rule, and the one that makes a card make room as soon as you are past half
     of it rather than all of it. */
  const resolveTarget = React.useCallback(
    (clientX: number, clientY: number, state: DragState): DropTarget | null => {
      const task = tasks.find((t) => t.id === state.taskId);
      if (!task) return null;

      for (const status of TASK_STATUSES) {
        const column = columnRefs.current.get(status);
        if (!column) continue;

        const box = column.getBoundingClientRect();
        if (clientX < box.left || clientX > box.right) continue;

        /* A column that refuses this card is not a target at all — the card
           will not follow the pointer into it, which is doc 10 §3's "simply
           won't drop there" made visible rather than merely enforced. */
        if (status !== state.from && canMove(task, status)) return null;

        const siblings = tasks.filter((t) => t.status === status && t.id !== state.taskId);

        let index = siblings.length;
        for (let i = 0; i < siblings.length; i += 1) {
          const element = cardRefs.current.get(siblings[i].id);
          if (!element) continue;
          const rect = element.getBoundingClientRect();
          if (clientY < rect.top + rect.height / 2) {
            index = i;
            break;
          }
        }
        return { status, index };
      }
      return null;
    },
    [tasks, canMove],
  );

  /* ── Auto-scroll ───────────────────────────────────────────────────────────
     Eight columns do not fit on a laptop, so a card has to be draggable to a
     column that is off-screen. Without this the drag simply stops at the edge
     and the only way across is to drop, scroll, and pick it up again. */
  const autoScroll = React.useCallback((clientX: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const margin = 90;
    if (clientX > box.right - margin) {
      scroller.scrollLeft += Math.min(18, (clientX - (box.right - margin)) / 4);
    } else if (clientX < box.left + margin) {
      scroller.scrollLeft -= Math.min(18, (box.left + margin - clientX) / 4);
    }
  }, []);

  const commit = React.useCallback(
    (taskId: string, from: TaskStatus, chosen: DropTarget) => {
      if (chosen.status !== from) onMove(taskId, chosen.status);

      if (!onReorder) return;
      if (!tasks.some((t) => t.id === taskId)) return;

      /* Take the card out, then put it back immediately before whichever card
         currently occupies the chosen index in the destination column — or at
         the end if it was dropped past the last one. */
      const others = tasks.filter((t) => t.id !== taskId);
      const inColumn = others.filter((t) => t.status === chosen.status);
      const anchor = inColumn[chosen.index];
      const at = anchor ? others.indexOf(anchor) : others.length;

      const ids = others.map((t) => t.id);
      ids.splice(at, 0, taskId);
      onReorder(ids);
    },
    [tasks, onMove, onReorder],
  );

  /* ── The landing ───────────────────────────────────────────────────────────
     The card flies to the gap it has been holding open. Cutting straight to the
     committed state instead is what makes a board feel like it is teleporting
     things around — you lose track of the card you were just holding. */
  const finish = React.useCallback(() => {
    const state = dragRef.current;
    if (!state) return;

    const chosen = targetRef.current;
    const gap = gapRef.current?.getBoundingClientRect();
    const destination = gap
      ? { x: gap.left, y: gap.top }
      : { x: state.originX, y: state.originY };

    setLanding(destination);

    window.setTimeout(() => {
      if (chosen) commit(state.taskId, state.from, chosen);
      dragRef.current = null;
      targetRef.current = null;
      priorRects.current.clear();
      setLanding(null);
      setDrag(null);
      setTarget(null);
    }, MOTION_MS);
  }, [commit]);

  /* ── The gesture ───────────────────────────────────────────────────────────
     Window listeners rather than pointer capture. Capture would swallow the
     click the browser fires at the end of a press, and TaskCard needs that click
     to open the detail drawer — it does its own travel check to tell a click
     from a drag. */
  const beginGesture = React.useCallback(
    (event: React.PointerEvent, task: TaskView) => {
      /* Ignore presses that landed on the checkbox or any other control. */
      if ((event.target as HTMLElement).closest('label,input,button,a')) return;
      if (event.button !== 0 && event.pointerType === 'mouse') return;

      const element = cardRefs.current.get(task.id);
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const template: DragState = {
        taskId: task.id,
        from: task.status,
        grabX: startX - rect.left,
        grabY: startY - rect.top,
        width: rect.width,
        height: rect.height,
        originX: rect.left,
        originY: rect.top,
        x: startX,
        y: startY,
      };

      let started = false;
      let holdTimer: number | undefined;

      /* Touch has to wait: the same gesture that drags a card is the one that
         scrolls the board, and there is no way to tell them apart at the moment
         the finger lands. A short hold disambiguates, which is what every touch
         board does. Mouse and pen start on travel alone. */
      const needsHold = event.pointerType === 'touch';

      const lift = (atX: number, atY: number) => {
        started = true;
        captureRects();
        const state = { ...template, x: atX, y: atY };
        dragRef.current = state;
        setDrag(state);
        const first = resolveTarget(atX, atY, template);
        targetRef.current = first;
        setTarget(first);
      };

      if (needsHold) {
        holdTimer = window.setTimeout(() => lift(startX, startY), TOUCH_HOLD_MS);
      }

      const onMoveEvent = (move: PointerEvent) => {
        if (!started) {
          if (needsHold) {
            /* Moved before the hold elapsed — they are scrolling, not dragging. */
            if (Math.hypot(move.clientX - startX, move.clientY - startY) > DRAG_THRESHOLD) {
              window.clearTimeout(holdTimer);
              cleanup();
            }
            return;
          }
          if (Math.hypot(move.clientX - startX, move.clientY - startY) <= DRAG_THRESHOLD) return;
          lift(move.clientX, move.clientY);
          return;
        }

        move.preventDefault();
        autoScroll(move.clientX);

        const moved = { ...template, x: move.clientX, y: move.clientY };
        dragRef.current = moved;
        setDrag(moved);

        const next = resolveTarget(move.clientX, move.clientY, template);
        const current = targetRef.current;
        if (current?.status !== next?.status || current?.index !== next?.index) {
          /* Only capture when the gap is actually about to move, or every
             pointermove would reset the FLIP baseline mid-animation. */
          captureRects();
          targetRef.current = next;
          setTarget(next);
        }
      };

      const onUp = () => {
        window.clearTimeout(holdTimer);
        if (started) finish();
        cleanup();
      };

      function cleanup() {
        window.removeEventListener('pointermove', onMoveEvent);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      }

      window.addEventListener('pointermove', onMoveEvent, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [autoScroll, captureRects, resolveTarget, finish],
  );

  const registerCard = React.useCallback((id: string, element: HTMLElement | null) => {
    if (element) cardRefs.current.set(id, element);
    else cardRefs.current.delete(id);
  }, []);

  return (
    <div
      ref={scrollerRef}
      className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6"
      /* While a card is in the air the board must not also pan under it. */
      style={drag ? { overscrollBehaviorX: 'contain' } : undefined}
    >
      <div className="flex min-w-max gap-3">
        {TASK_STATUSES.map((status) => {
          const meta = STATUS_META[status];
          const columnTasks = tasks.filter((t) => t.status === status);
          const points = columnTasks.reduce((sum, t) => sum + EFFORT_POINTS[t.effort], 0);

          const refusal = dragged ? canMove(dragged, status) : null;
          const isSameColumn = dragged?.status === status;
          const isDropTarget = target?.status === status;
          const isRefused = !!dragged && !!refusal && !isSameColumn;

          /* The dragged card leaves the flow entirely — it is in the air. */
          const visible = drag ? columnTasks.filter((t) => t.id !== drag.taskId) : columnTasks;

          return (
            <section
              key={status}
              ref={(element) => {
                if (element) columnRefs.current.set(status, element);
                else columnRefs.current.delete(status);
              }}
              aria-label={`${meta.label} — ${columnTasks.length} tasks`}
              className={cn(
                'flex w-[286px] shrink-0 flex-col rounded-xl border',
                'transition-[border-color,background-color] duration-[140ms]',
                isDropTarget
                  ? 'border-border-brand bg-bg-selected'
                  : 'border-border-subtle bg-bg-subtle',
              )}
              style={
                isRefused
                  ? { borderColor: 'color-mix(in oklab, var(--feedback-error) 45%, transparent)' }
                  : undefined
              }
              title={isRefused ? refusal : undefined}
            >
              {/* ---- Column header ---- */}
              <header className="flex items-center gap-2 px-3 pt-3 pb-2">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(--${meta.token})` }}
                />
                <h3 className="flex-1 truncate text-caption font-semibold text-text-primary">
                  {meta.label}
                </h3>
                <span className="tabular shrink-0 text-micro font-semibold text-text-tertiary">
                  {columnTasks.length}
                  {points > 0 && <span className="font-normal"> · {points}p</span>}
                </span>
              </header>

              {/* A hairline in the status colour, so a long board stays
                  navigable by colour as you scroll sideways. */}
              <span
                aria-hidden="true"
                className="mx-3 h-[2px] shrink-0 rounded-full"
                style={{
                  background: `linear-gradient(90deg, var(--${meta.token}), color-mix(in oklab, var(--${meta.token}) 20%, transparent))`,
                }}
              />

              {/* ---- Cards ---- */}
              <div className="flex-1 space-y-2 p-2.5">
                {visible.map((task, position) => (
                  <React.Fragment key={task.id}>
                    {isDropTarget && target.index === position && (
                      <Gap ref={gapRef} height={drag?.height ?? 0} />
                    )}

                    <div
                      ref={(element) => registerCard(task.id, element)}
                      className="group/card relative"
                      style={{ touchAction: 'pan-x' }}
                      onPointerDown={(event) => beginGesture(event, task)}
                    >
                      {onToggleSelect && (
                        /* The checkbox stays hidden until the card is hovered or
                           something is already selected. A permanent checkbox on
                           every card turns a board into a spreadsheet. */
                        <label
                          className={cn(
                            'absolute top-1.5 left-1.5 z-10 cursor-pointer rounded-md border',
                            'border-border-default bg-bg-surface p-1 shadow-xs transition-opacity',
                            selectedIds?.includes(task.id)
                              ? 'opacity-100'
                              : 'opacity-0 group-hover/card:opacity-100 focus-within:opacity-100',
                          )}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <span className="sr-only">Select {task.reference}</span>
                          <input
                            type="checkbox"
                            className="block h-3.5 w-3.5 cursor-pointer accent-[var(--accent-primary)]"
                            checked={selectedIds?.includes(task.id) ?? false}
                            onChange={() => onToggleSelect(task.id)}
                          />
                        </label>
                      )}
                      <TaskCard task={task} onOpen={onOpen} />
                    </div>
                  </React.Fragment>
                ))}

                {isDropTarget && target.index >= visible.length && (
                  <Gap ref={gapRef} height={drag?.height ?? 0} />
                )}

                {visible.length === 0 && !isDropTarget && (
                  <p className="rounded-lg border border-dashed border-border-default px-3 py-6 text-center text-micro text-text-tertiary">
                    {isRefused ? refusal : 'Nothing here'}
                  </p>
                )}

                {isRefused && visible.length > 0 && (
                  <p
                    className="rounded-lg px-2.5 py-2 text-micro font-medium"
                    style={{
                      backgroundColor:
                        'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
                      color: 'color-mix(in oklab, var(--feedback-error) 74%, var(--text-primary))',
                    }}
                  >
                    {refusal}
                  </p>
                )}
              </div>

              {/* ---- Add ---- */}
              <footer className="p-2.5 pt-0">
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-transparent px-2 py-1.5 text-micro font-semibold text-text-tertiary transition-colors duration-[140ms] hover:border-border-default hover:bg-bg-surface hover:text-text-primary focus-visible:outline-none"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                  Add task
                </button>
              </footer>
            </section>
          );
        })}
      </div>

      {/* ---- The card in the air ----
          Rendered last so it stacks above every column without a z-index race.
          `pointer-events-none` is essential: it sits under the cursor, and if it
          took hits, `resolveTarget` would be measuring against the card being
          dragged rather than the column behind it. */}
      {drag && dragged && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[70] top-0 left-0"
          style={{
            width: drag.width,
            transform: landing
              ? `translate3d(${landing.x}px, ${landing.y}px, 0)`
              : `translate3d(${drag.x - drag.grabX}px, ${drag.y - drag.grabY}px, 0)`,
            transition: landing ? `transform ${MOTION_MS}ms ${EASE}` : 'none',
          }}
        >
          <TaskCard task={dragged} dragging />
        </div>
      )}

      {/* Legend — the board is wide, and colour alone must never be the signal */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-micro font-semibold tracking-[0.07em] text-text-tertiary uppercase">
          Statuses
        </span>
        {TASK_STATUSES.map((status) => (
          <Badge key={status} token={STATUS_META[status].token} size="sm" variant="outline">
            {STATUS_META[status].label}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/* ============================================================================
 * THE GAP
 * ----------------------------------------------------------------------------
 * A real element in the column's flow, exactly as tall as the card in the air.
 * That is what makes the cards below it move — they are not being animated out
 * of the way, they are being laid out around something that is genuinely there.
 * FLIP then makes that relayout smooth.
 * ========================================================================= */
const Gap = React.forwardRef<HTMLDivElement, { height: number }>(function Gap({ height }, ref) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="rounded-lg border-2 border-dashed border-border-brand bg-bg-selected/60"
      style={{ height }}
    />
  );
});
