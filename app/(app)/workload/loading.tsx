import {
  SkeletonHeader,
  SkeletonKpiRow,
  SkeletonList,
  SkeletonPage,
  SkeletonSection,
} from '@/components/ui/skeleton';

/* Workload: the division's totals, then a row per person with their bar. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading workload">
      <SkeletonHeader />
      <SkeletonKpiRow count={3} />
      <SkeletonSection>
        <SkeletonList rows={8} />
      </SkeletonSection>
    </SkeletonPage>
  );
}
