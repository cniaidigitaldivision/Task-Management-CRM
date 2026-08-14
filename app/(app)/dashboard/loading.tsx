import {
  Skeleton,
  SkeletonHeader,
  SkeletonKpiRow,
  SkeletonList,
  SkeletonPage,
  SkeletonSection,
} from '@/components/ui/skeleton';

/* The dashboard's own shape, and it changed with the redesign: four figures, then
   a two-thirds column beside a right rail. Mirrored down to the split, because a
   skeleton that is one column wide followed by a page that is two makes everything
   jump sideways at the moment somebody starts reading it.

   Same breakpoint as the page — `xl`, not `lg`. A skeleton that splits earlier
   than the real layout is a skeleton that lies about the layout. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading your dashboard">
      <SkeletonHeader />
      <SkeletonKpiRow />

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-8 xl:col-span-2">
          {/* Where the work stands: the trend chart, then the status bar. */}
          <SkeletonSection>
            <div className="space-y-5 rounded-xl border border-border-default bg-bg-surface p-5 shadow-sm">
              <Skeleton rounded="lg" className="h-[210px] w-full" />
              <div className="space-y-3 border-t border-border-subtle pt-5">
                <Skeleton rounded="full" className="h-3.5 w-full" />
                <div className="flex flex-wrap gap-3">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Skeleton key={i} rounded="sm" className="h-2.5 w-20" />
                  ))}
                </div>
              </div>
            </div>
          </SkeletonSection>

          <SkeletonSection>
            <SkeletonList rows={5} />
          </SkeletonSection>

          <SkeletonSection>
            <SkeletonList rows={4} />
          </SkeletonSection>
        </div>

        {/* The rail: a ring, a gauge, a feed. Both round shapes are placeheld as
            circles rather than blocks — a square where a donut lands is the one
            place in this file where the shape would visibly change. */}
        <div className="min-w-0 space-y-6">
          <div className="rounded-xl border border-border-default bg-bg-surface p-5 shadow-sm">
            <Skeleton rounded="sm" className="mb-4 h-3 w-28" />
            <div className="flex items-center gap-5">
              <Skeleton rounded="full" className="h-[148px] w-[148px] shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} rounded="sm" className="h-2.5 w-full" />
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border-default bg-bg-surface p-5 shadow-sm">
            <Skeleton rounded="sm" className="mb-4 h-3 w-32" />
            <div className="grid place-items-center">
              <Skeleton rounded="full" className="h-[148px] w-[148px]" />
            </div>
          </div>

          <SkeletonList rows={6} />
        </div>
      </div>
    </SkeletonPage>
  );
}
