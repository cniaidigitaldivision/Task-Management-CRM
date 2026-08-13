import {
  SkeletonBoard,
  SkeletonHeader,
  SkeletonPage,
  SkeletonToolbar,
} from '@/components/ui/skeleton';

/* Tasks opens on the BOARD, so the skeleton is columns rather than rows. A table
   placeholder here would promise the wrong screen and then replace itself, which
   is worse than no placeholder at all. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading tasks">
      <SkeletonHeader withActions />
      <SkeletonToolbar groups={3} />
      <SkeletonBoard columns={6} />
    </SkeletonPage>
  );
}
