'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { FloatingScrollbar } from '@/components/ui/floating-scrollbar';
import { EFFORT_POINTS, STATUS_META, TASK_STATUSES, type TaskStatus } from '@/lib/domain/constants';
import type { TaskView } from '@/lib/view/task-view';
import { cn } from '@/lib/utils';

import { TaskCard } from './task-card';

/* ============================================================================
 * TASK BOARD — Kanban, doc 10 §3
 * ----------------------------------------------------------------------------
 * Eight columns in status order, drag between them to change status.
 *
 * ── WHY THIS DOES NOT USE HTML5 DRAG-AND-DROP ────────────────────────────────
 * Owner instruction, Session 17. The native `draggable` API cannot do any of
 * what was asked, and not because it was used badly:
 *
 *   · the browser renders its own translucent drag image from a snapshot of the
 *     element and there is no way to style it — that IS the "blur"
 *   · `dragover` fires on a coarse timer, not per frame, so feedback lags
 *   · there is a drop TARGET but no drop POSITION, so a card can be told which
 *     column it is going to and never where in it
 *   · nothing about it is animatable, so cards cannot make room
 *
 * So: pointer events, a real gap element at the landing index, and FLIP to make
 * the reflow smooth.
 *
 * ============================================================================
 * ⚠️ THE THREE THINGS THAT MADE THE CARDS SHIVER — Session 18
 * ----------------------------------------------------------------------------
 * The first version of this did exactly what the owner then reported: *"the
 * other tasks just start flickering… they move up and down up and down… they
 * start shivering."* Three separate causes, all of which had to go. If this file
 * is ever refactored, these are the traps.
 *
 * 1. THE FLIP EFFECT WAS KEYED ON THE POINTER.
 *    Its dependency array contained the whole drag state, and that state was
 *    updated on every `pointermove`. So sixty times a second the effect
 *    re-measured cards that were still mid-transition, compared them against a
 *    `priorRects` snapshot that had not changed, slammed `transition: none` on
 *    them and re-applied an inverse transform. Every frame restarted the
 *    animation from a slightly different place. That is the shiver, exactly.
 *    → It now runs ONLY when the gap's column or index actually changes.
 *
 * 2. THE POINTER POSITION WAS REACT STATE.
 *    Every `pointermove` re-rendered eight columns and thirty cards to move one
 *    absolutely-positioned element. Even without (1) that is enough to drop
 *    frames on a full board.
 *    → The floating card is now positioned IMPERATIVELY through a ref. React
 *      re-renders only when the gap moves, which is a handful of times per drag.
 *
 * 3. THE INSERTION INDEX WAS MEASURED OFF ANIMATING ELEMENTS.
 *    `getBoundingClientRect()` includes transforms, so while cards were sliding
 *    the midpoints used to choose the index were themselves moving. Two adjacent
 *    indices could each be "correct" a frame apart, so the gap flipped between
 *    them, which re-triggered the animation, which moved the midpoints again.
 *    A feedback loop — the "disturbing each other" in the report.
 *    → The index is now computed from a SETTLED layout model built out of
 *      heights and container geometry, none of which a transform can touch. The
 *      decision boundary is fixed while the animation plays, so it cannot
 *      oscillate.
 *
 * The shared lesson: never measure something you are animating in order to
 * decide how to animate it.
 * ============================================================================
 *
 * ── WHAT IS PERSISTED, AND WHAT IS NOT ───────────────────────────────────────
 * The STATUS is. `onMove` writes it.
 *
 * The position WITHIN a column is not, and cannot be yet: there is no ordering
 * column on `tasks` (only `checklist_items.sort_order` exists). `onReorder`
 * hands the new order to the workspace, which holds the task array in client
 * state, so the card stays where it was dropped for the session and returns to
 * its natural order on reload. Making that survive a reload is a migration, and
 * migrations are not started without permission (rule R1).
 *
 * ── ACCESSIBILITY ────────────────────────────────────────────────────────────
 * Native drag-and-drop was never keyboard-operable either, so this is not a
 * regression — but it is still a gap, recorded rather than quietly left. Cards
 * remain focusable and Enter opens the detail drawer, where the status can be
 * changed from a real `<select>`.
 * ========================================================================= */

/** How far the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 5;
/** A touch must be held this long first, or the board could never be scrolled. */
const TOUCH_HOLD_MS = 220;
/** Shared by the gap opening, the FLIP shuffle and the drop flight. */
const MOTION_MS = 190;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

/** `space-y-2` between cards and `p-2.5` around the list, in pixels. Read by the
 *  settled-layout model below; change them together with the classes. */
const CARD_GAP = 8;
const LIST_PAD = 10;

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
  onAddTask,
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
  /** "Add task" at the foot of a column. Until Session 20 that button had no
   *  handler at all and did nothing when clicked. */
  onAddTask?: (status: TaskStatus) => void;
  /** Selection is optional: omit both and the board has no checkboxes at all. */
  selectedIds?: readonly string[];
  onToggleSelect?: (taskId: string) => void;
}) {
  /* Only TWO pieces of React state, and neither changes with the pointer.
     `drag` flips once on lift and once on drop; `target` changes only when the
     gap moves. See trap 2 in the header. */
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [target, setTarget] = React.useState<DropTarget | null>(null);

  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const columnRefs = React.useRef(new Map<TaskStatus, HTMLElement>());
  const listRefs = React.useRef(new Map<TaskStatus, HTMLElement>());
  const cardRefs = React.useRef(new Map<string, HTMLElement>());
  const gapRef = React.useRef<HTMLDivElement>(null);
  const floatRef = React.useRef<HTMLDivElement | null>(null);

  /** Card rects captured immediately before the gap moves — the "First" of FLIP. */
  const priorRects = React.useRef(new Map<string, DOMRect>());
  /** Card heights, measured once per drag. A translate cannot change a height,
   *  so these stay valid for the whole gesture — that is the point (trap 3). */
  const heights = React.useRef(new Map<string, number>());
  /** Latest pointer position. Not state: it drives one element, imperatively. */
  const pointer = React.useRef({ x: 0, y: 0 });

  /* Mirrors of the two states, written synchronously beside every setState. The
     pointer handlers run outside React's render cycle and need the CURRENT
     value; an effect-synced ref would be a frame behind. */
  const dragRef = React.useRef<DragState | null>(null);
  const targetRef = React.useRef<DropTarget | null>(null);

  const dragged = drag ? tasks.find((t) => t.id === drag.taskId) : undefined;
  const isDragging = drag !== null;

  /* ── FLIP: make the cards that moved slide instead of jump ──────────────────
     ⚠️ The dependency array is the whole fix for trap 1. It lists ONLY the gap's
     position and whether a drag is running. It must never contain anything that
     changes with the pointer, or every frame restarts the animation and the
     board shivers. */
  React.useLayoutEffect(() => {
    if (!isDragging) return;

    for (const [id, element] of cardRefs.current) {
      const prior = priorRects.current.get(id);
      if (!prior || !element.isConnected) continue;

      /* Clear first, then measure. `getBoundingClientRect()` includes any
         transform still in flight, so measuring before clearing would give the
         card's animated position and compound the error on the next move. */
      element.style.transition = 'none';
      element.style.transform = '';

      const now = element.getBoundingClientRect();
      const dx = prior.left - now.left;
      const dy = prior.top - now.top;

      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

      element.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      /* Forced reflow, so the browser treats the line below as a change worth
         transitioning. requestAnimationFrame is unreliable here — React may
         paint first, and the inverse position becomes briefly visible. */
      void element.offsetHeight;
      element.style.transition = `transform ${MOTION_MS}ms ${EASE}`;
      element.style.transform = 'translate3d(0, 0, 0)';
    }
  }, [target?.status, target?.index, isDragging]);

  /** The "First" half of FLIP. Call before any state change that moves cards.
   *  Also where `cardRefs` is pruned — see `registerCard`, which deliberately
   *  ignores detach, so a card that has genuinely gone is dropped here instead. */
  const captureRects = React.useCallback(() => {
    const captured = new Map<string, DOMRect>();
    for (const [id, element] of cardRefs.current) {
      if (!element.isConnected) {
        cardRefs.current.delete(id);
        continue;
      }
      captured.set(id, element.getBoundingClientRect());
    }
    priorRects.current = captured;
  }, []);

  /* ── Where would it land? ──────────────────────────────────────────────────
     ⚠️ Trap 3. This builds the column's layout AS IF THE GAP WERE NOT THERE,
     from the list container's top and the cards' heights — neither of which a
     transform affects. So the midpoints it compares against are fixed for the
     whole drag, and the chosen index cannot oscillate while cards animate.

     Measuring the live rects instead is the obvious implementation and it is
     the one that shivers. */
  const resolveTarget = React.useCallback(
    (clientX: number, clientY: number, state: DragState): DropTarget | null => {
      const task = tasks.find((t) => t.id === state.taskId);
      if (!task) return null;

      for (const status of TASK_STATUSES) {
        const column = columnRefs.current.get(status);
        const list = listRefs.current.get(status);
        if (!column || !list) continue;

        const box = column.getBoundingClientRect();
        if (clientX < box.left || clientX > box.right) continue;

        /* A column that refuses this card is not a target at all — the card will
           not follow the pointer into it. Doc 10 §3's "simply won't drop there",
           made visible rather than merely enforced. */
        if (status !== state.from && canMove(task, status)) return null;

        const siblings = tasks.filter((t) => t.status === status && t.id !== state.taskId);

        let top = list.getBoundingClientRect().top + LIST_PAD;
        for (let i = 0; i < siblings.length; i += 1) {
          const height = heights.current.get(siblings[i].id) ?? 0;
          if (clientY < top + height / 2) return { status, index: i };
          top += height + CARD_GAP;
        }
        return { status, index: siblings.length };
      }
      return null;
    },
    [tasks, canMove],
  );

  /* ── Auto-scroll ───────────────────────────────────────────────────────────
     Eight columns do not fit on a laptop, so a card has to be draggable to a
     column that is off-screen. Without this the drag stops at the edge and the
     only way across is to drop, scroll, and pick it up again. */
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

  /** Put the floating card where the pointer is. Imperative — see trap 2. */
  const positionFloat = React.useCallback(() => {
    const state = dragRef.current;
    const element = floatRef.current;
    if (!state || !element) return;
    element.style.transform =
      `translate3d(${pointer.current.x - state.grabX}px, ${pointer.current.y - state.grabY}px, 0)`;
  }, []);

  /* ── The landing ───────────────────────────────────────────────────────────
     The card flies to the gap it has been holding open. Cutting straight to the
     committed state is what makes a board feel like it teleports things — you
     lose track of the card you were just holding. */
  const finish = React.useCallback(() => {
    const state = dragRef.current;
    if (!state) return;

    const chosen = targetRef.current;
    const gap = gapRef.current?.getBoundingClientRect();
    const destination = gap
      ? { x: gap.left, y: gap.top }
      : { x: state.originX, y: state.originY };

    const element = floatRef.current;
    if (element) {
      element.style.transition = `transform ${MOTION_MS}ms ${EASE}`;
      element.style.transform = `translate3d(${destination.x}px, ${destination.y}px, 0)`;
    }

    window.setTimeout(() => {
      /* The other cards are about to close up around the landed card. Capture
         first so that reflow is a FLIP too, not a jump. */
      captureRects();
      if (chosen) commit(state.taskId, state.from, chosen);
      dragRef.current = null;
      targetRef.current = null;
      setDrag(null);
      setTarget(null);
    }, MOTION_MS);
  }, [captureRects, commit]);

  /* ── The gesture ───────────────────────────────────────────────────────────
     Window listeners rather than pointer capture. Capture would swallow the
     click the browser fires at the end of a press, and TaskCard needs that click
     to open the detail drawer — it does its own travel check to tell a click
     from a drag. */
  const beginGesture = React.useCallback(
    (event: React.PointerEvent, task: TaskView) => {
      /* Ignore presses that landed on the checkbox or any other control. */
      if ((event.target as HTMLElement).closest('label,input,button,a')) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

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
      };

      let started = false;
      let holdTimer: number | undefined;

      /* Touch has to wait: the same gesture that drags a card is the one that
         scrolls the board, and there is no telling them apart at the moment the
         finger lands. A short hold disambiguates, as every touch board does.
         Mouse and pen start on travel alone. */
      const needsHold = event.pointerType === 'touch';

      const lift = (atX: number, atY: number) => {
        started = true;

        /* Every card's height, once. A translate cannot change one, so these
           stay true for the whole gesture — which is what lets `resolveTarget`
           work off geometry that no animation can disturb (trap 3). */
        heights.current.clear();
        for (const [id, node] of cardRefs.current) {
          heights.current.set(id, node.getBoundingClientRect().height);
        }

        pointer.current = { x: atX, y: atY };
        captureRects();
        dragRef.current = template;
        setDrag(template);
        const first = resolveTarget(atX, atY, template);
        targetRef.current = first;
        setTarget(first);
      };

      const onPointerMove = (move: PointerEvent) => {
        if (!started) {
          const travelled = Math.hypot(move.clientX - startX, move.clientY - startY);
          if (needsHold) {
            /* Moved before the hold elapsed — they are scrolling, not dragging. */
            if (travelled > DRAG_THRESHOLD) {
              window.clearTimeout(holdTimer);
              cleanup();
            }
            return;
          }
          if (travelled <= DRAG_THRESHOLD) return;
          lift(move.clientX, move.clientY);
          return;
        }

        move.preventDefault();
        pointer.current = { x: move.clientX, y: move.clientY };
        positionFloat();
        autoScroll(move.clientX);

        /* React is told ONLY when the gap actually has to move. Everything else
           about this drag is a style write on one element. */
        const next = resolveTarget(move.clientX, move.clientY, template);
        const current = targetRef.current;
        if (current?.status !== next?.status || current?.index !== next?.index) {
          captureRects();
          targetRef.current = next;
          setTarget(next);
        }
      };

      const onPointerUp = () => {
        window.clearTimeout(holdTimer);
        if (started) finish();
        cleanup();
      };

      function cleanup() {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      }

      if (needsHold) holdTimer = window.setTimeout(() => lift(startX, startY), TOUCH_HOLD_MS);

      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    },
    [autoScroll, captureRects, resolveTarget, positionFloat, finish],
  );

  /* ⚠️ DETACH DOES NOTHING, AND THAT IS THE FIX FOR A SECOND SHIVER BUG.
     The `ref` prop below is an inline arrow, so it is a new function on every
     render, so React detaches the old one — calling this with `null` — and
     attaches the new one, every single render.

     The first version deleted the card's FLIP snapshot on detach. React runs ref
     callbacks during commit, BEFORE `useLayoutEffect`, so the snapshot captured
     a moment earlier was wiped in the very commit that was supposed to consume
     it. `priorRects` was always empty by the time FLIP looked, so nothing ever
     animated and the cards JUMPED to their new positions instead of sliding.

     Measured, not reasoned about: a drag that moved the gap from index 0 to 2
     produced zero style writes on any card.

     So detach is ignored. Stale entries cannot accumulate because `captureRects`
     prunes anything no longer in the document. */
  const registerCard = React.useCallback((id: string, element: HTMLElement | null) => {
    if (element) cardRefs.current.set(id, element);
  }, []);

  return (
    /* ── The wrapper is what makes the floating scrollbar work ────────────────
       It is the sticky bar's containing block, so the bar can ride the bottom of
       the viewport anywhere between the top of the board and its natural resting
       place beneath it. It must not gain an `overflow` of its own, or sticky
       stops working.

       The legend moved out of the scroller at the same time: it was drifting
       sideways whenever the board was scrolled, and it is a key to the whole
       board rather than part of its content. */
    <div className="relative">
      <div
        ref={scrollerRef}
        /* `.scrollbar-hidden` suppresses only this element's BAR, because
           FloatingScrollbar draws it at the bottom of the screen instead. Every
           other way of scrolling it — wheel, shift-wheel, trackpad, keyboard,
           and the drag auto-scroll — still drives this element. */
        className="scrollbar-hidden -mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6"
        /* While a card is in the air the board must not also pan under it. */
        style={isDragging ? { overscrollBehaviorX: 'contain' } : undefined}
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
                /* ── STEP 7: THE BOARD JOINS THE TINT LANGUAGE ────────────────
                   The calendar tints a day by its status and the KPI cards wash
                   in their metric's colour; the board had only a 2px hairline,
                   so the same idea was expressed three different ways across
                   three screens.

                   A gradient fading out over the first ~140px, so the colour is
                   at the header where the eye lands when scanning sideways and
                   gone by the time it reaches the cards — which keeps it off the
                   dense text, per the plan's rule.

                   Skipped entirely while this is a drop target: `bg-bg-selected`
                   is the feedback that the card will land HERE, and a status wash
                   layered over it would blunt the one signal that matters
                   mid-drag. */
                style={{
                  ...(isDropTarget
                    ? null
                    : {
                        backgroundImage: `linear-gradient(180deg, color-mix(in oklab, var(--${meta.token}) 8%, transparent), transparent 140px)`,
                      }),
                  ...(isRefused
                    ? {
                        borderColor:
                          'color-mix(in oklab, var(--feedback-error) 45%, transparent)',
                      }
                    : null),
                }}
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

                {/* ---- Cards ----
                    `p-2.5` and `space-y-2` are mirrored by LIST_PAD and CARD_GAP,
                    which the settled-layout model above measures with. Change
                    them together. */}
                <div
                  ref={(element) => {
                    if (element) listRefs.current.set(status, element);
                    else listRefs.current.delete(status);
                  }}
                  className="flex-1 space-y-2 p-2.5"
                >
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
                    onClick={() => onAddTask?.(status)}
                    disabled={!onAddTask}
                    aria-label={`Add a task to ${meta.label}`}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-transparent px-2 py-1.5 text-micro font-semibold text-text-tertiary transition-colors duration-[140ms] hover:border-border-default hover:bg-bg-surface hover:text-text-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                    Add task
                  </button>
                </footer>
              </section>
            );
          })}
        </div>
      </div>

      {/* ---- The bar that follows you down the page ----
          Sits directly under the board and rides the bottom of the viewport
          until the board's real end scrolls into view. The bleed classes match
          the scroller's exactly, so the two elements are the same width and the
          thumb maps one-to-one onto the real scroll range. */}
      <FloatingScrollbar targetRef={scrollerRef} className="-mx-4 sm:-mx-6" />

      {/* ---- The card in the air ----
          Rendered last so it stacks above every column without a z-index race.
          `pointer-events-none` is essential: it sits under the cursor, and if it
          took hits, `resolveTarget` would be measuring the card being dragged
          rather than the column behind it.

          The transform is NOT in the style prop. React re-renders this element
          whenever the gap moves, and a transform declared here would be reset to
          the lift position on every one of those renders — a visible snap
          backwards. The ref callback seeds it and `positionFloat` maintains it;
          React never touches a property it was not given. */}
      {drag && dragged && (
        <div
          aria-hidden="true"
          ref={(element) => {
            floatRef.current = element;
            if (element) {
              element.style.transform =
                `translate3d(${pointer.current.x - drag.grabX}px, ${pointer.current.y - drag.grabY}px, 0)`;
            }
          }}
          className="pointer-events-none fixed top-0 left-0 z-[70] will-change-transform"
          style={{ width: drag.width }}
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
 * of the way, they are being laid out around something genuinely there. FLIP
 * then makes that relayout smooth.
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
