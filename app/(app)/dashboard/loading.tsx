import {
  SkeletonHeader,
  SkeletonKpiRow,
  SkeletonList,
  SkeletonPage,
  SkeletonPanel,
  SkeletonSection,
} from '@/components/ui/skeleton';

/* The dashboard's own shape: four figures, where the work stands, what needs a
   decision, then detail. Mirrored so the wait is spent orienting rather than
   wondering — and so nothing moves when the data lands. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading your dashboard">
      <SkeletonHeader />
      <SkeletonKpiRow />
      <SkeletonPanel height="h-24" />
      <SkeletonSection>
        <SkeletonList rows={5} />
      </SkeletonSection>
      <SkeletonSection>
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <SkeletonList rows={4} />
          </div>
          <div className="lg:col-span-2">
            <SkeletonList rows={4} />
          </div>
        </div>
      </SkeletonSection>
    </SkeletonPage>
  );
}
