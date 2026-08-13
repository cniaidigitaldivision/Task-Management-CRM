import {
  SkeletonHeader,
  SkeletonKpiRow,
  SkeletonList,
  SkeletonPage,
  SkeletonSection,
} from '@/components/ui/skeleton';

/* My Work: the reader's own figures, then their tasks grouped by urgency. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading your work">
      <SkeletonHeader />
      <SkeletonKpiRow />
      <SkeletonSection>
        <SkeletonList rows={6} />
      </SkeletonSection>
      <SkeletonSection>
        <SkeletonList rows={4} />
      </SkeletonSection>
    </SkeletonPage>
  );
}
