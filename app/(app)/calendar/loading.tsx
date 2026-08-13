import { SkeletonHeader, SkeletonMonthGrid, SkeletonPage } from '@/components/ui/skeleton';

/* Six weeks of day cells with an uneven scatter of events. Uneven on purpose: an
   even one reads as a graphic rather than as a month. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading the calendar">
      <SkeletonHeader />
      <SkeletonMonthGrid />
    </SkeletonPage>
  );
}
