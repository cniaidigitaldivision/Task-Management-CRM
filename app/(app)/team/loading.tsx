import {
  SkeletonHeader,
  SkeletonKpiRow,
  SkeletonList,
  SkeletonPage,
  SkeletonToolbar,
} from '@/components/ui/skeleton';

/* Team: four counts, the Active / Inactive / Deactivated switches, then people. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading the team">
      <SkeletonHeader withActions />
      <SkeletonKpiRow />
      <SkeletonToolbar groups={1} />
      <SkeletonList rows={8} />
    </SkeletonPage>
  );
}
