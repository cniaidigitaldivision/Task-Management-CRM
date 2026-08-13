import {
  Skeleton,
  SkeletonHeader,
  SkeletonList,
  SkeletonPage,
  SkeletonToolbar,
} from '@/components/ui/skeleton';

/* Documents: the Drive connection panel, the state filter, then the queue.
   The panel is Admin+ only and a skeleton cannot know the role — it is included
   because a placeholder that disappears is a smaller jump than one that appears
   under content somebody has started reading. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading documents">
      <SkeletonHeader />
      <div className="space-y-2 rounded-xl border border-border-default bg-bg-surface p-4 shadow-sm">
        <Skeleton className="h-4 w-56" />
        <Skeleton rounded="sm" className="h-2.5 w-[70%]" />
      </div>
      <SkeletonToolbar groups={1} />
      <SkeletonList rows={5} inCard={false} />
    </SkeletonPage>
  );
}
