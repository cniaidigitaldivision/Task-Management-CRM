'use client';

import * as React from 'react';
import { Clapperboard, ImageIcon } from 'lucide-react';

import { PlatformIcon } from '@/components/brand/platform-icon';
import { ProgressBar } from '@/components/ui/progress';
import type { ProjectRow } from '@/lib/db/queries/types';
import { projectProgress, VERDICT_LABEL, VERDICT_TOKEN } from '@/lib/domain/project-progress';
import { IncludesPills } from './project-pills';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WHAT WENT OUT THIS MONTH, AGAINST WHAT WAS PROMISED — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"How many posts are in this project? How many posts, how many reels, and website:
 * this short information should be displayed in a grid view."*
 *
 * ── ⚠️ WHY THIS REPLACED "12 of 30 TASKS DONE" ────────────────────────────────
 * The card's progress bar measured TASK COMPLETION — how much of the to-do list was
 * ticked. That is a number about the CRM, not about the client: a project can have
 * every task closed and still have published nothing, and a project with a hundred
 * open tasks can be perfectly on target.
 *
 * The owner asked for posts and reels, and the reason that is the better question is
 * that it is the one the client is paying for. So the bar now measures published
 * assets against the agreed minimum, and the verdict comes from
 * `lib/domain/project-progress.ts` — the same function the monthly report uses, so a
 * card and the report cannot disagree.
 *
 * ── AND WHY IT CAN SAY "NO TARGET" ───────────────────────────────────────────
 * Rule 2 of that module: a project on "up to N, no floor" cannot miss anything. It
 * gets a grey label rather than a red bar, because painting it red would be reporting
 * a failure against a promise nobody made.
 * ========================================================================= */

export function ProjectDelivery({ project }: { project: ProjectRow }) {
  const progress = projectProgress({
    assetsPublished: project.assetsPublishedThisMonth,
    reelsPublished: project.reelsPublishedThisMonth,
    assetsTargetMin: project.assetsTargetMin,
    assetsTargetMax: project.assetsTargetMax,
    reelsTargetMin: project.reelsTargetMin,
  });

  const token = VERDICT_TOKEN[progress.verdict];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Count
          icon={ImageIcon}
          done={project.assetsPublishedThisMonth}
          target={project.assetsTargetMin}
          label="posts"
        />
        <Count
          icon={Clapperboard}
          done={project.reelsPublishedThisMonth}
          target={project.reelsTargetMin}
          label="reels"
        />
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <IncludesPills
            website={project.packageIncludesWebsite}
            crm={project.packageIncludesCrm}
          />
        </span>
      </div>

      {/* A bar only where there is something to measure against. An untargeted
          project gets its label instead — a bar at 0% of nothing reads as failure. */}
      {progress.assetsPercent !== null ? (
        <ProgressBar
          value={progress.assetsPercent}
          token={token}
          size="md"
          markerAt={100}
          label={`${project.name}: ${progress.summary}`}
        />
      ) : (
        <p className="text-micro text-text-tertiary">{VERDICT_LABEL[progress.verdict]}</p>
      )}
    </div>
  );
}

/**
 * "14 / 16" or just "14".
 *
 * ⚠️ The target is omitted when null rather than shown as 0. `null` is "nothing
 * agreed" and `0` is "agreed to publish nothing" — the same distinction the schema
 * and every report keep, and a card that printed "14 / 0" would be nonsense.
 */
function Count({
  icon: Icon,
  done,
  target,
  label,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  done: number;
  target: number | null;
  label: string;
}) {
  const short = target !== null && done < target;

  return (
    <span className="inline-flex items-baseline gap-1.5" title={`${label} published this month`}>
      <Icon
        className="h-3.5 w-3.5 shrink-0 self-center text-text-tertiary"
        strokeWidth={2.25}
        aria-hidden="true"
      />
      <span
        className={cn('tabular-nums text-body-sm font-semibold')}
        style={{ color: short ? 'var(--feedback-warning)' : 'var(--text-primary)' }}
      >
        {done}
      </span>
      {target !== null && (
        <span className="tabular-nums text-micro text-text-tertiary">/ {target}</span>
      )}
      <span className="text-micro text-text-secondary">{label}</span>
    </span>
  );
}

/* ----------------------------------------------------------------------------
 * WHERE IT GOES
 * ----------------------------------------------------------------------------
 * Owner: *"The platform should display proper platform icons and things like that."*
 * Icons alone, no names — six brand marks in a row are recognisable at a glance and
 * six names are a paragraph. The name travels in the tooltip and the aria-label.
 * ------------------------------------------------------------------------- */
export function PlatformStrip({
  platforms,
  size = 18,
  gap = 'gap-1',
}: {
  platforms: readonly {
    id: string;
    name: string;
    slug: string;
    /** Migration 037. When present the icon becomes a real link to the client's page. */
    pageUrl?: string | null;
    handle?: string | null;
  }[];
  size?: number;
  /** Owner, 2026-08-20: *"a little bit away from each other, not very congested."*
   *  The header passes `gap-2`; a dense table row keeps the default. */
  gap?: string;
}) {
  if (platforms.length === 0) {
    return <p className="text-micro text-text-tertiary">No platforms chosen yet</p>;
  }

  return (
    <div className={cn('flex flex-wrap items-center', gap)}>
      {platforms.map((platform) => {
        const label = platform.handle
          ? `${platform.name} · ${platform.handle}`
          : platform.name;

        /* ── ⚠️ A LINK ONLY WHEN THERE IS SOMEWHERE TO GO ────────────────────
           Owner, 2026-08-20 asked where these icons' URLs came from. They had none:
           the icons were drawn from the set of platforms ticked on the form, and
           nothing stored a page anywhere. Migration 037 added `page_url`, and this is
           the difference it makes — an icon with a recorded page is an anchor, one
           without is inert and says so on hover. An icon that LOOKS like a link and
           goes nowhere is worse than no icon. */
        if (platform.pageUrl) {
          return (
            <a
              key={platform.id}
              href={platform.pageUrl}
              target="_blank"
              /* `noreferrer` as well as `noopener`: a client's public page should not
                 receive this CRM's URL in a referrer header. */
              rel="noopener noreferrer"
              title={`${label} — open`}
              aria-label={`${label} — opens in a new tab`}
              /* Owner, 2026-08-20: *"There are no hover effects on social media
                 platform icons."* A lift plus a ring in the brand's own colour, so the
                 icon reads as pressable rather than printed on. */
              className="rounded-[28%] transition-[transform,box-shadow] duration-[140ms] hover:-translate-y-0.5 hover:shadow-[0_2px_10px_-2px_rgb(0_0_0/0.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ outlineColor: 'var(--focus-ring)' }}
            >
              <PlatformIcon slug={platform.slug} size={size} />
            </a>
          );
        }

        return (
          <span
            key={platform.id}
            title={`${label} — no page recorded yet`}
            aria-label={`${label}, no page recorded`}
            /* Still responds to the pointer, but differently: it brightens toward full
               opacity rather than lifting, which says "this is real but incomplete"
               instead of pretending to be a link. */
            className="opacity-60 transition-opacity duration-[140ms] hover:opacity-100"
          >
            <PlatformIcon slug={platform.slug} size={size} />
          </span>
        );
      })}
    </div>
  );
}
