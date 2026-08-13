import {
  Skeleton,
  SkeletonHeader,
  SkeletonPage,
  SkeletonSection,
} from '@/components/ui/skeleton';

/* Profile: the details form with its avatar, then the security cards. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading your profile">
      <SkeletonHeader />

      <SkeletonSection>
        <div className="rounded-xl border border-border-default bg-bg-surface p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <Skeleton rounded="full" className="h-16 w-16 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton rounded="sm" className="h-2.5 w-56 max-w-full" />
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton rounded="sm" className="h-2.5 w-24" />
                <Skeleton rounded="lg" className="h-9 w-full" />
              </div>
            ))}
          </div>
        </div>
      </SkeletonSection>

      <SkeletonSection>
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="space-y-2 rounded-xl border border-border-default bg-bg-surface p-4 shadow-sm"
            >
              <Skeleton className="h-4 w-32" />
              <Skeleton rounded="sm" className="h-2.5 w-full" />
              <Skeleton rounded="sm" className="h-2.5 w-[70%]" />
            </div>
          ))}
        </div>
      </SkeletonSection>
    </SkeletonPage>
  );
}
