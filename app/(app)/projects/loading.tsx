import {
  SkeletonCardGrid,
  SkeletonHeader,
  SkeletonPage,
  SkeletonToolbar,
} from '@/components/ui/skeleton';

/* Projects defaults to the grid view (CHANGE-PLAN 6.3), so cards rather than rows. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading projects">
      <SkeletonHeader />
      <SkeletonToolbar groups={2} />
      <SkeletonCardGrid count={6} />
    </SkeletonPage>
  );
}
