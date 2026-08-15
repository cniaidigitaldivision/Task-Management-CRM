import { Skeleton, SkeletonHeader, SkeletonPage } from '@/components/ui/skeleton';

/* Workflow: the header, the create row, then the chain cards.
   Mirrors the real layout so nothing shifts when the data lands — the rule for
   every `loading.tsx` in this codebase (redesign step 2).

   ⚠️ This file makes the route stream, which is why `layout.tsx` beside it
   carries the `requireRole('admin')`. Without that, the 200 is committed before
   the guard runs and the refusal arrives INSIDE the stream. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading workflow chains">
      <SkeletonHeader />

      {/* The create row */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border-default bg-bg-surface p-4 shadow-sm">
        <div className="min-w-[16rem] flex-1 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton rounded="lg" className="h-9 w-full" />
        </div>
        <div className="w-[12rem] space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton rounded="lg" className="h-9 w-full" />
        </div>
        <Skeleton rounded="lg" className="h-9 w-24" />
      </div>

      {/* The chain cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="space-y-3 rounded-xl border border-border-default bg-bg-surface p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton rounded="full" className="h-5 w-12 shrink-0" />
            </div>
            <Skeleton rounded="lg" className="h-8 w-20" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
